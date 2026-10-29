import { randomUUID } from 'node:crypto';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GET as placas } from '@/app/api/placas/route';
import { ListarPlacas } from '@/application/listar-placas';
import type { PlacaRepositorio } from '@/application/ports/placas';
import { normalizarPlaca, type PlacaRegistrada } from '@/domain/model/placa';
import { usarCasosDeUso, type CasosDeUso } from '@/infrastructure/composicion';
import { configDynamoDesdeEntorno, crearClienteDynamo } from '@/infrastructure/dynamodb/cliente';
import { PlacasDynamo } from '@/infrastructure/dynamodb/placas-dynamo';
import { usarVerificador } from '@/infrastructure/http/proteger';
import { crearToken, peticion, verificadorDePrueba } from './helpers';

const repo = (lista: PlacaRegistrada[]): PlacaRepositorio => ({ activas: async () => lista });

describe('placas registradas (A4)', () => {
  beforeAll(() => usarVerificador(verificadorDePrueba));
  afterEach(() => usarCasosDeUso(undefined));

  it('A4_la_placa_se_compara_sin_importar_mayusculas_espacios_ni_guiones', () => {
    expect(normalizarPlaca('1234-abc')).toBe('1234ABC');
    expect(normalizarPlaca(' 2602 sit ')).toBe('2602SIT');
  });

  it('A4_la_lista_sale_ordenada_por_placa', async () => {
    const lista = await new ListarPlacas(repo([{ placa: '2000BBB', unidadCodigo: 'B-1' }, { placa: '1000AAA', unidadCodigo: 'A-1' }])).ejecutar();
    expect(lista.map((p) => p.placa)).toEqual(['1000AAA', '2000BBB']);
  });

  it.each([
    ['GUARDIA', 200],
    ['ADMIN', 200],
    ['RESIDENTE', 403],
  ])('rol %s recibe %i', async (rol, esperado) => {
    usarCasosDeUso({ listarPlacas: new ListarPlacas(repo([{ placa: '1000AAA', unidadCodigo: 'A-1' }])) } as unknown as CasosDeUso);
    const r = await placas(peticion('GET', await crearToken([rol])));
    expect(r.status).toBe(esperado);
    if (esperado === 200) expect(await r.json()).toEqual([{ placa: '1000AAA', unidadCodigo: 'A-1' }]);
  });

  it('sin_token_es_401', async () => {
    expect((await placas(peticion('GET'))).status).toBe(401);
  });
});

describe.skipIf(!process.env.DYNAMODB_ENDPOINT)('placas sobre DynamoDB Local', () => {
  it('A4_solo_salen_las_placas_activas_de_vehiculos', async () => {
    const config = configDynamoDesdeEntorno();
    const doc = crearClienteDynamo(config);
    const activa = `IT${randomUUID().slice(0, 5).toUpperCase()}`;
    const inactiva = `IX${randomUUID().slice(0, 5).toUpperCase()}`;
    for (const [placa, activaFlag] of [[activa, true], [inactiva, false]] as const) {
      await doc.send(new PutCommand({ TableName: config.tabla, Item: { PK: `PLACA#${placa}`, SK: 'META', tipo: 'Vehiculo', placa, unidadCodigo: 'A-101', activa: activaFlag } }));
    }
    const lista = await new PlacasDynamo(doc, config.tabla).activas();
    expect(lista).toContainEqual({ placa: activa, unidadCodigo: 'A-101' });
    expect(lista.map((p) => p.placa)).not.toContain(inactiva);
  });
});
