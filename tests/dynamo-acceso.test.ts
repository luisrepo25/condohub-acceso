// Contra DynamoDB Local real. Uso: DYNAMODB_ENDPOINT=http://localhost:8000 npm test (la tabla la crea `npm run db:crear`).
import { randomUUID } from 'node:crypto';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { RegistrarAcceso } from '@/application/registrar-acceso';
import { ReglaViolada } from '@/domain/errores';
import type { Solicitante } from '@/domain/model/rol';
import { configDynamoDesdeEntorno, crearClienteDynamo } from '@/infrastructure/dynamodb/cliente';
import { RegistroAccesoDynamo } from '@/infrastructure/dynamodb/registro-acceso-dynamo';

const guardia: Solicitante = { sub: 'guardia-it', roles: new Set(['GUARDIA']) };
const config = configDynamoDesdeEntorno();
const doc = crearClienteDynamo(config);
const AHORA = new Date('2026-10-28T15:00:00Z');
const registrar = new RegistrarAcceso(new RegistroAccesoDynamo(doc, config.tabla, () => AHORA), () => AHORA, randomUUID);
const datos = (extra: object = {}) => ({ sentido: 'INGRESO', categoria: 'PEATON', horaDispositivo: AHORA.toISOString(), ...extra });

async function crearPase(codigo: string, estado = 'VIGENTE') {
  await doc.send(new PutCommand({
    TableName: config.tabla,
    Item: {
      PK: `PASE#${codigo}`, SK: 'META', tipo: 'Pase', codigo, unidadCodigo: 'A-101', estado, usos: 0, usosMaximos: 1,
      validoDesde: '2026-10-28T07:00:00-04:00', validoHasta: '2026-10-28T23:59:59-04:00',
    },
  }));
}

async function registrosDeLaUnidad(unidad: string) {
  const r = await doc.send(new QueryCommand({
    TableName: config.tabla, IndexName: 'GSI2', KeyConditionExpression: 'GSI2PK = :u',
    ExpressionAttributeValues: { ':u': `UNIDAD#${unidad}` },
  }));
  return r.Items ?? [];
}

describe.skipIf(!process.env.DYNAMODB_ENDPOINT)('Acceso sobre DynamoDB Local', () => {
  it('O3_la_misma_clave_dos_veces_deja_un_solo_registro_y_responde_lo_mismo', async () => {
    const unidad = `IT-${randomUUID().slice(0, 8)}`;
    const clave = randomUUID();
    const primera = await registrar.ejecutar(datos({ unidadCodigo: unidad }), clave, guardia);
    const repetida = await registrar.ejecutar(datos({ unidadCodigo: unidad }), clave, guardia);
    expect(primera.creado).toBe(true);
    expect(repetida.creado).toBe(false);
    expect(JSON.stringify(repetida.respuesta)).toBe(JSON.stringify(primera.respuesta));
    expect(await registrosDeLaUnidad(unidad)).toHaveLength(1);
  });

  it('O3_dos_envios_simultaneos_con_la_misma_clave_dejan_un_solo_registro', async () => {
    const unidad = `IT-${randomUUID().slice(0, 8)}`;
    const clave = randomUUID();
    const [a, b] = await Promise.all([
      registrar.ejecutar(datos({ unidadCodigo: unidad }), clave, guardia),
      registrar.ejecutar(datos({ unidadCodigo: unidad }), clave, guardia),
    ]);
    expect(a.respuesta).toEqual(b.respuesta);
    expect(await registrosDeLaUnidad(unidad)).toHaveLength(1);
  });

  it('A1_el_ingreso_con_pase_consume_su_unico_uso_y_el_segundo_se_rechaza', async () => {
    const codigo = `QR-IT-${randomUUID().slice(0, 8)}`;
    await crearPase(codigo);
    const ok = await registrar.ejecutar(datos({ paseCodigo: codigo }), randomUUID(), guardia);
    expect(ok.creado).toBe(true);
    const segundo = registrar.ejecutar(datos({ paseCodigo: codigo }), randomUUID(), guardia);
    await expect(segundo).rejects.toThrow(ReglaViolada);
    await expect(segundo).rejects.toMatchObject({ codigo: 'A2' });
  });

  it('A2_un_pase_revocado_o_inexistente_se_rechaza_sin_registrar', async () => {
    const codigo = `QR-IT-${randomUUID().slice(0, 8)}`;
    await crearPase(codigo, 'REVOCADO');
    await expect(registrar.ejecutar(datos({ paseCodigo: codigo }), randomUUID(), guardia)).rejects.toThrow(/revocado/);
    await expect(registrar.ejecutar(datos({ paseCodigo: 'QR-NO-EXISTE' }), randomUUID(), guardia)).rejects.toThrow(/no existe/);
  });

  it('A1_dos_guardias_con_el_mismo_pase_a_la_vez_solo_uno_entra', async () => {
    const codigo = `QR-IT-${randomUUID().slice(0, 8)}`;
    await crearPase(codigo);
    const intentos = await Promise.allSettled([
      registrar.ejecutar(datos({ paseCodigo: codigo }), randomUUID(), guardia),
      registrar.ejecutar(datos({ paseCodigo: codigo }), randomUUID(), guardia),
    ]);
    expect(intentos.filter((i) => i.status === 'fulfilled')).toHaveLength(1);
    expect(intentos.filter((i) => i.status === 'rejected')).toHaveLength(1);
  });
});
