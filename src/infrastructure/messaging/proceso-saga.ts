// `npm run saga`: proceso del paso 3 de la saga de reserva (contenedor `acceso-saga`). Atiende los comandos de
// Reservas (cola `acceso.reservas`) y publica sus respuestas desde el stream de la tabla (S4). Si RabbitMQ o DynamoDB
// no responden, reintenta: los comandos esperan en su cola y las respuestas en el stream.
import { randomBytes, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { atenderComandoSaga, type DepsPasesDeReserva } from '@/application/casos/pases-de-reserva';
import { configDesdeEntorno } from '../config';
import { ComandosAtendidosDynamo, PasesDeReservaDynamo } from '../dynamodb/pases-de-reserva-dynamo';
import { conectar, consumirComandos, PublicadorRabbitMq, registroJson as log } from './rabbitmq';
import { RelevoStream } from './relevo-stream';

const c = configDesdeEntorno();
const conexionAws = {
  endpoint: c.dynamoEndpoint,
  region: c.dynamoRegion,
  credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local' },
};
const dynamo = new DynamoDBClient(conexionAws);
const doc = DynamoDBDocumentClient.from(dynamo, { marshallOptions: { removeUndefinedValues: true } });
const deps: DepsPasesDeReserva = {
  pasesDeReserva: new PasesDeReservaDynamo(doc, c.dynamoTabla),
  atendidos: new ComandosAtendidosDynamo(doc, c.dynamoTabla),
  // El código del pase es la credencial del QR: 128 bits aleatorios, igual que el de una visita.
  ids: { id: () => randomUUID(), codigoPase: () => `QR-${randomBytes(16).toString('base64url')}` },
  parametros: { zonaHoraria: c.zonaHoraria, ventanaDesde: c.ventanaDesde, ventanaHasta: c.ventanaHasta, confianzaPlacaMinima: c.confianzaPlacaMinima },
};

let activo = true;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function vueltaDeServicio(): Promise<void> {
  const conexion = await conectar(c.rabbitmqUrl);
  const cerrada = new Promise<void>((resolver) => {
    conexion.on('close', () => resolver());
    conexion.on('error', (e: Error) => log.warn('RabbitMQ cerró la conexión', { error: e.message }));
  });
  await consumirComandos(conexion, c.rabbitmqColaSaga, (comando) => atenderComandoSaga(deps, comando), log);
  const relevo = new RelevoStream(dynamo, new DynamoDBStreamsClient(conexionAws), doc, c.dynamoTabla, new PublicadorRabbitMq(conexion, c.rabbitmqExchange));
  log.info('Saga de Acceso escuchando', { cola: c.rabbitmqColaSaga, tabla: c.dynamoTabla });
  let abierta = true;
  void cerrada.then(() => {
    abierta = false;
  });
  while (activo && abierta) {
    try {
      const publicadas = await relevo.vuelta();
      if (publicadas > 0) log.info('Respuestas de la saga publicadas', { publicadas });
    } catch (e) {
      log.warn('El relevo no pudo publicar; se reintenta', { error: (e as Error).message });
    }
    await espera(c.relevoIntervaloMs);
  }
  if (abierta) await conexion.close();
}

async function principal(): Promise<void> {
  for (const senal of ['SIGINT', 'SIGTERM'] as const) process.on(senal, () => (activo = false));
  while (activo) {
    try {
      await vueltaDeServicio();
    } catch (e) {
      log.error('Saga de Acceso sin RabbitMQ o DynamoDB; se reintenta en 5 s', { error: (e as Error).message });
      await espera(5000);
    }
  }
}

void principal();
