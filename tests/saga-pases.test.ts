// Paso 3 de la saga de reserva (S3–S5) contra DynamoDB Local real, con el stream de la tabla: atender los comandos de
// Reservas, guardar los pases para la app del guardia y publicar la respuesta desde el stream (S4).
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient, waitUntilTableExists } from '@aws-sdk/client-dynamodb';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { atenderComandoSaga, type DepsPasesDeReserva } from '@/application/casos/pases-de-reserva';
import type { ComandoSaga } from '@/application/ports/saga';
import { ComandosAtendidosDynamo, idDerivado, PasesDeReservaDynamo } from '@/infrastructure/dynamodb/pases-de-reserva-dynamo';
import { PasesDynamo } from '@/infrastructure/dynamodb/repositorios';
import { RelevoStream } from '@/infrastructure/messaging/relevo-stream';

const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
const AWS = { endpoint: ENDPOINT, region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } };
const dynamo = new DynamoDBClient(AWS);
const doc = DynamoDBDocumentClient.from(dynamo, { marshallOptions: { removeUndefinedValues: true } });
const tabla = `condohub-acceso-saga-${randomUUID().slice(0, 8)}`;
const P = { zonaHoraria: 'America/La_Paz', ventanaDesde: '07:00:00', ventanaHasta: '23:59:59', confianzaPlacaMinima: 0.85 };
const SAGA = '33333333-3333-4333-8333-000000000001';

let codigos = 0;
let deps: DepsPasesDeReserva;
const publicados: { routingKey: string; cuerpo: Record<string, unknown> }[] = [];
const publicador = {
  caido: false,
  async publicar(routingKey: string, cuerpo: string) {
    if (this.caido) throw new Error('RabbitMQ caído');
    publicados.push({ routingKey, cuerpo: JSON.parse(cuerpo) as Record<string, unknown> });
  },
};

beforeAll(async () => {
  // La misma definición que db/tabla-acceso.json, con su stream (el relevo lo lee), en una tabla propia de la prueba.
  const definicion = JSON.parse(readFileSync(new URL('../db/tabla-acceso.json', import.meta.url), 'utf8'));
  await dynamo.send(new CreateTableCommand({ ...definicion, TableName: tabla }));
  await waitUntilTableExists({ client: dynamo, maxWaitTime: 30 }, { TableName: tabla });
  deps = {
    pasesDeReserva: new PasesDeReservaDynamo(doc, tabla),
    atendidos: new ComandosAtendidosDynamo(doc, tabla),
    ids: { id: () => randomUUID(), codigoPase: () => `QR-prueba-${++codigos}` },
    parametros: P,
  };
});

afterAll(async () => {
  await dynamo.send(new DeleteTableCommand({ TableName: tabla }));
});

beforeEach(() => {
  publicados.length = 0;
  publicador.caido = false;
});

function emitir(reservaId: string, invitados = 2, eventId = randomUUID()): ComandoSaga {
  return {
    tipo: 'reservas.EmitirPasesReserva',
    eventId,
    sagaId: SAGA,
    data: {
      reservaId,
      unidadId: '1c672f16-6d63-4534-8c00-3c6813468783',
      unidadCodigo: 'A-101',
      fecha: '2026-10-30',
      invitados: Array.from({ length: invitados }, (_, n) => ({ invitadoId: randomUUID(), nombre: `Invitado ${n + 1}` })),
    },
  };
}

function revocar(reservaId: string, eventId = randomUUID()): ComandoSaga {
  return { tipo: 'reservas.RevocarPasesReserva', eventId, sagaId: SAGA, data: { reservaId } };
}

async function respuestaDe(eventId: string): Promise<Record<string, unknown>> {
  const item = (await doc.send(new GetCommand({ TableName: tabla, Key: { PK: `EVT#${eventId}`, SK: 'META' } }))).Item;
  return JSON.parse(String(item?.mensaje)) as Record<string, unknown>;
}

/** Los pases del día que ve la app del guardia (GET /api/pases/guardia), solo los de esos códigos. */
async function pasesDelDia(codigos: string[]) {
  return (await new PasesDynamo(doc, tabla).delDia('2026-10-30')).filter((p) => codigos.includes(p.codigo));
}

async function codigosDe(eventId: string): Promise<string[]> {
  return ((await respuestaDe(eventId)).data as { pases: { codigo: string }[] }).pases.map((p) => p.codigo);
}

/** Lee el stream hasta el final (cada vuelta lee hasta 100 registros por fragmento). */
async function drenar(relevo: RelevoStream): Promise<number> {
  let total = 0;
  for (let i = 0; i < 30; i++) total += await relevo.vuelta();
  return total;
}

describe('saga, paso 3: emitir los pases de los invitados', () => {
  it('S3 A1 emite un pase por invitado, visible para la app del guardia, y deja la respuesta PaseEmitido', async () => {
    const reservaId = randomUUID();
    const comando = emitir(reservaId);

    expect(await atenderComandoSaga(deps, comando)).toBe(true);

    const respuesta = await respuestaDe(comando.eventId);
    const pases = (respuesta.data as { pases: { invitadoId: string; codigo: string }[] }).pases;
    expect(respuesta).toMatchObject({ type: 'acceso.PaseEmitido', sagaId: SAGA, version: 1, eventId: idDerivado(`acceso.PaseEmitido:${comando.eventId}`) });
    expect(pases.map((p) => p.invitadoId)).toEqual(comando.tipo === 'reservas.EmitirPasesReserva' ? comando.data.invitados.map((i) => i.invitadoId) : []);
    const delDia = await pasesDelDia(pases.map((p) => p.codigo));
    expect(delDia).toHaveLength(2);
    expect(delDia.every((p) => p.datos.origen === 'RESERVA' && p.datos.estado === 'VIGENTE' && p.datos.unidadCodigo === 'A-101')).toBe(true);
  });

  it('S5 un comando repetido se descarta sin volver a emitir', async () => {
    const reservaId = randomUUID();
    const comando = emitir(reservaId);
    await atenderComandoSaga(deps, comando);

    expect(await atenderComandoSaga(deps, comando)).toBe(false);
    expect(await pasesDelDia(await codigosDe(comando.eventId))).toHaveLength(2);
  });

  it('S3 otra emisión de la misma reserva (reenvío) devuelve los mismos pases', async () => {
    const reservaId = randomUUID();
    const primera = emitir(reservaId);
    const segunda = { ...primera, eventId: randomUUID() };
    await atenderComandoSaga(deps, primera);
    await atenderComandoSaga(deps, segunda);

    expect((await respuestaDe(segunda.eventId)).data).toEqual((await respuestaDe(primera.eventId)).data);
    expect(await pasesDelDia(await codigosDe(primera.eventId))).toHaveLength(2);
  });

  it('A1 el salón con 80 invitados emite sus 80 pases (más de lo que cabe en una transacción)', async () => {
    const reservaId = randomUUID();

    const comando = emitir(reservaId, 80);
    await atenderComandoSaga(deps, comando);

    expect(await pasesDelDia(await codigosDe(comando.eventId))).toHaveLength(80);
  });
});

describe('saga, compensación del paso 3: revocar los pases', () => {
  it('S3 A2 revoca los pases vigentes; uno ya usado queda usado (A3) y la respuesta cuenta los revocados', async () => {
    const reservaId = randomUUID();
    const emision = emitir(reservaId, 3);
    await atenderComandoSaga(deps, emision);
    const codigos = await codigosDe(emision.eventId);
    await marcarUsado(codigos[0]!);
    const comando = revocar(reservaId);

    await atenderComandoSaga(deps, comando);

    const estados = (await pasesDelDia(codigos)).map((p) => p.datos.estado).sort();
    expect(estados).toEqual(['REVOCADO', 'REVOCADO', 'USADO']);
    expect(await respuestaDe(comando.eventId)).toMatchObject({ type: 'acceso.PaseRevocado', data: { reservaId, cantidad: 2 } });
  });

  it('S3 si la revocación llega antes que la emisión, la emisión tardía ya no emite nada', async () => {
    const reservaId = randomUUID();
    await atenderComandoSaga(deps, revocar(reservaId));
    const tardia = emitir(reservaId);

    await atenderComandoSaga(deps, tardia);

    expect((await respuestaDe(tardia.eventId)).data).toEqual({ reservaId, pases: [] });
    expect(await codigosDe(tardia.eventId)).toEqual([]);
  });
});

describe('S4 relevo: las respuestas salen del stream de la tabla', () => {
  it('publica cada respuesta una sola vez, con su routing key, y sigue desde su cursor tras un reinicio', async () => {
    const relevo = () => new RelevoStream(dynamo, new DynamoDBStreamsClient(AWS), doc, tabla, publicador);
    const primero = relevo();
    await drenar(primero);
    publicados.length = 0;

    const comando = emitir(randomUUID());
    await atenderComandoSaga(deps, comando);
    await drenar(primero);

    expect(publicados).toHaveLength(1);
    expect(publicados[0]!.routingKey).toBe('acceso.PaseEmitido');
    expect(publicados[0]!.cuerpo.eventId).toBe(idDerivado(`acceso.PaseEmitido:${comando.eventId}`));

    expect(await drenar(relevo())).toBe(0);
  });

  it('si RabbitMQ no confirma, la respuesta no se pierde: sale en la vuelta siguiente', async () => {
    const relevo = new RelevoStream(dynamo, new DynamoDBStreamsClient(AWS), doc, tabla, publicador);
    await drenar(relevo);
    publicados.length = 0;
    const comando = revocar(randomUUID());
    await atenderComandoSaga(deps, comando);
    publicador.caido = true;

    await expect(relevo.vuelta()).rejects.toThrow('RabbitMQ caído');
    publicador.caido = false;
    await drenar(new RelevoStream(dynamo, new DynamoDBStreamsClient(AWS), doc, tabla, publicador));

    expect(publicados.map((p) => p.cuerpo.eventId)).toEqual([idDerivado(`acceso.PaseRevocado:${comando.eventId}`)]);
  });
});

async function marcarUsado(codigo: string): Promise<void> {
  await doc.send(new UpdateCommand({ TableName: tabla, Key: { PK: `PASE#${codigo}`, SK: 'META' }, UpdateExpression: 'SET estado = :u, usos = :uno', ExpressionAttributeValues: { ':u': 'USADO', ':uno': 1 } }));
}
