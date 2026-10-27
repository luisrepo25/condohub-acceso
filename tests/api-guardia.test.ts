// GET /api/pases/guardia (O6), POST /api/sync (O1–O4, O6) y GET /api/alertas (I4) de punta a punta con DynamoDB Local
// real. Gestión, la IA y el reloj son dobles. "Ahora" = martes 27/10/2026 12:00 en La Paz.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as accesos } from '@/app/api/accesos/route';
import { GET as alertas } from '@/app/api/alertas/route';
import { GET as pasesGuardia } from '@/app/api/pases/guardia/route';
import { POST as validar } from '@/app/api/pases/validar/route';
import { POST as sync } from '@/app/api/sync/route';
import { POST as visitas } from '@/app/api/visitas/route';
import { IaNoDisponible } from '@/application/errores';
import type { Alerta } from '@/domain/model/alerta';
import { usarDependencias } from '@/infrastructure/composicion';
import { usarVerificador } from '@/infrastructure/http/proteger';
import { crearTablaDePrueba } from './dynamo-prueba';
import { crearToken, verificadorDePrueba } from './helpers';

const GUARDIA = '00000000-0000-0000-0000-00000000a003';
const ADMIN = '00000000-0000-0000-0000-00000000a001';
let ahora = new Date('2026-10-27T16:00:00Z');
const ia = { alertas: [] as Alerta[], caida: false, token: '' };
let db: Awaited<ReturnType<typeof crearTablaDePrueba>>;

beforeAll(async () => {
  usarVerificador(verificadorDePrueba);
  db = await crearTablaDePrueba();
  process.env.DYNAMODB_TABLA = db.tabla;
});

afterAll(async () => {
  usarDependencias(undefined);
  delete process.env.DYNAMODB_TABLA;
  await db.borrar();
});

beforeEach(() => {
  ahora = new Date('2026-10-27T16:00:00Z');
  Object.assign(ia, { alertas: [], caida: false, token: '' });
  usarDependencias({
    reloj: { ahora: () => ahora },
    unidades: { codigos: async () => [] },
    visitantes: {
      alertas: async (token) => {
        ia.token = token;
        if (ia.caida) throw new IaNoDisponible('caída');
        return ia.alertas;
      },
    },
  });
});

async function pedir(manejador: (r: Request) => Promise<Response>, metodo: 'GET' | 'POST', ruta: string, rol: string, sub: string, cuerpo?: unknown, clave?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${await crearToken([rol], { sub })}`, 'content-type': 'application/json' };
  if (clave) headers['idempotency-key'] = clave;
  const r = await manejador(new Request(`http://localhost${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
  return { status: r.status, cuerpo: (await r.json()) as any, headers: r.headers };
}

/** Pase nuevo de una visita registrada por el ADMIN para A-101 el día indicado. */
async function paseDe(fecha = '2026-10-27'): Promise<string> {
  const r = await pedir(visitas, 'POST', '/api/visitas', 'ADMIN', ADMIN, { unidadCodigo: 'A-101', nombre: 'Ana', fecha }, randomUUID());
  expect(r.status).toBe(201);
  return r.cuerpo.pase.codigo;
}

const operacion = (datos: Record<string, unknown>, clave: string = randomUUID()) => ({
  idempotencyKey: clave,
  tipo: 'ACCESO',
  datos: { sentido: 'INGRESO', categoria: 'PEATON', horaDispositivo: '2026-10-27T11:30:00-04:00', ...datos },
});
const sincronizar = (operaciones: unknown[]) => pedir(sync, 'POST', '/api/sync', 'GUARDIA', GUARDIA, { operaciones });

describe('GET /api/pases/guardia (O6)', () => {
  it('O6 descarga los pases del día local con su estado; los de otro día no', async () => {
    const hoy = await paseDe('2026-10-27');
    const manana = await paseDe('2026-10-28');

    const r = await pedir(pasesGuardia, 'GET', '/api/pases/guardia', 'GUARDIA', GUARDIA);

    expect(r.status).toBe(200);
    const codigos = r.cuerpo.map((p: { codigo: string }) => p.codigo);
    expect(codigos).toContain(hoy);
    expect(codigos).not.toContain(manana);
    expect(r.cuerpo.find((p: { codigo: string }) => p.codigo === hoy)).toMatchObject({ estado: 'VIGENTE', usos: 0, unidadCodigo: 'A-101' });
  });

  it('O6 con ?desde= trae solo los pases que cambiaron, también los usados, para actualizar la copia', async () => {
    const usado = await paseDe();
    const quieto = await paseDe();
    const marca = new Date();
    await new Promise((listo) => setTimeout(listo, 5));
    await pedir(accesos, 'POST', '/api/accesos', 'GUARDIA', GUARDIA, { sentido: 'INGRESO', categoria: 'PEATON', paseCodigo: usado, horaDispositivo: '2026-10-27T11:59:00-04:00' }, randomUUID());

    const r = await pedir(pasesGuardia, 'GET', `/api/pases/guardia?desde=${marca.toISOString()}`, 'GUARDIA', GUARDIA);

    const codigos = r.cuerpo.map((p: { codigo: string }) => p.codigo);
    expect(codigos).toContain(usado);
    expect(codigos).not.toContain(quieto);
    expect(r.cuerpo.find((p: { codigo: string }) => p.codigo === usado)).toMatchObject({ estado: 'USADO', usos: 1 });
  });

  it('un desde mal escrito es 400', async () => {
    expect((await pedir(pasesGuardia, 'GET', '/api/pases/guardia?desde=ayer', 'GUARDIA', GUARDIA)).status).toBe(400);
  });
});

describe('POST /api/sync (O1–O4, O6)', () => {
  it('O1 O4 responde una entrada por operación con el código que habría tenido sola, sin frenar a las demás', async () => {
    const pase = await paseDe();
    const lote = [
      operacion({ paseCodigo: pase }),
      operacion({}), // ingreso sin pase ni unidad: A2
      operacion({ sentido: 'SALIDA' }),
      { idempotencyKey: randomUUID(), tipo: 'ACCESO', datos: { sentido: 'ENTRADA' } }, // forma inválida
      operacion({ unidadCodigo: 'A-102' }, 'no-es-uuid'), // O1
    ];

    const r = await sincronizar(lote);

    expect(r.status).toBe(200);
    expect(r.cuerpo.resultados.map((x: { codigo: number }) => x.codigo)).toEqual([201, 422, 201, 400, 422]);
    expect(r.cuerpo.resultados.map((x: { idempotencyKey: string }) => x.idempotencyKey)).toEqual(lote.map((o) => o.idempotencyKey));
    expect(r.cuerpo.resultados[1].cuerpo.code).toBe('A2');
    expect(r.cuerpo.resultados[4].cuerpo.code).toBe('O1');
  });

  it('O3 enviar el mismo lote dos veces no duplica registros y devuelve las mismas respuestas', async () => {
    const pase = await paseDe();
    const lote = [operacion({ paseCodigo: pase }), operacion({ unidadCodigo: 'A-103' })];

    const primera = await sincronizar(lote);
    const segunda = await sincronizar(lote);

    // O3: el mismo cuerpo, también en el orden de sus campos (byte a byte).
    expect(JSON.stringify(segunda.cuerpo)).toBe(JSON.stringify(primera.cuerpo));
    expect((await pedir(validar, 'POST', '/api/pases/validar', 'GUARDIA', GUARDIA, { codigo: pase })).cuerpo.pase.usos).toBe(1);
  });

  it('O6 el pase se evalúa a la hora del dispositivo: un ingreso de anoche con el pase de ayer es válido', async () => {
    const pase = await paseDe('2026-10-27');
    ahora = new Date('2026-10-28T15:00:00Z'); // se sincroniza al día siguiente

    const r = await sincronizar([operacion({ paseCodigo: pase, horaDispositivo: '2026-10-27T22:10:00-04:00' })]);

    expect(r.cuerpo.resultados[0]).toMatchObject({ codigo: 201, cuerpo: { paseCodigo: pase, unidadCodigo: 'A-101' } });
    expect(r.cuerpo.resultados[0].cuerpo.observacion).toBeUndefined();
  });

  it('O6 A3 un ingreso sin conexión con un pase que ya se usó se registra igual, sin gastarlo, con observación', async () => {
    const pase = await paseDe();
    await pedir(accesos, 'POST', '/api/accesos', 'GUARDIA', GUARDIA, { sentido: 'INGRESO', categoria: 'PEATON', paseCodigo: pase, horaDispositivo: '2026-10-27T11:00:00-04:00' }, randomUUID());

    const r = await sincronizar([operacion({ paseCodigo: pase, horaDispositivo: '2026-10-27T11:40:00-04:00' })]);

    expect(r.cuerpo.resultados[0].codigo).toBe(201);
    expect(r.cuerpo.resultados[0].cuerpo).toMatchObject({ resultado: 'PERMITIDO', unidadCodigo: 'A-101' });
    expect(r.cuerpo.resultados[0].cuerpo.observacion).toContain('USADO');
    expect((await pedir(validar, 'POST', '/api/pases/validar', 'GUARDIA', GUARDIA, { codigo: pase })).cuerpo.pase.usos).toBe(1);
  });

  it('O6 un reloj de dispositivo adelantado no se cree: se usa la hora del servidor', async () => {
    const pase = await paseDe('2026-10-27');

    const r = await sincronizar([operacion({ paseCodigo: pase, horaDispositivo: '2026-11-30T10:00:00-04:00' })]);

    expect(r.cuerpo.resultados[0].cuerpo.observacion).toBeUndefined(); // evaluado ahora (vigente), no el 30/11 (vencido)
  });

  it.each([
    ['sin operaciones', { operaciones: [] }],
    ['más de 100 operaciones', { operaciones: Array.from({ length: 101 }, () => operacion({})) }],
    ['un tipo que no es ACCESO', { operaciones: [{ idempotencyKey: randomUUID(), tipo: 'VISITA', datos: {} }] }],
  ])('un lote mal formado (%s) es 400 entero', async (_caso, cuerpo) => {
    expect((await pedir(sync, 'POST', '/api/sync', 'GUARDIA', GUARDIA, cuerpo)).status).toBe(400);
  });
});

describe('GET /api/alertas (I4, capa anticorrupción con IA)', () => {
  const alerta = (cluster: string, creadaEn: string): Alerta => ({
    id: `VISITANTE#${cluster}`, tipo: 'VISITANTE_RECURRENTE', clusterId: cluster, apariciones: 4, diasDistintos: 3, creadaEn: new Date(creadaEn),
  });

  it('I4 entrega las alertas de la IA con la forma de Acceso, la más reciente primero, con el token del guardia', async () => {
    ia.alertas = [alerta('c-1', '2026-10-25T06:00:00Z'), alerta('c-2', '2026-10-27T06:00:00Z')];

    const r = await pedir(alertas, 'GET', '/api/alertas', 'GUARDIA', GUARDIA);

    expect(r.status).toBe(200);
    expect(r.cuerpo).toEqual([
      { id: 'VISITANTE#c-2', tipo: 'VISITANTE_RECURRENTE', clusterId: 'c-2', apariciones: 4, diasDistintos: 3, creadaEn: '2026-10-27T06:00:00.000Z' },
      { id: 'VISITANTE#c-1', tipo: 'VISITANTE_RECURRENTE', clusterId: 'c-1', apariciones: 4, diasDistintos: 3, creadaEn: '2026-10-25T06:00:00.000Z' },
    ]);
    expect(ia.token.length).toBeGreaterThan(20);
  });

  it('I4 ?desde= filtra por la fecha de la alerta', async () => {
    ia.alertas = [alerta('c-1', '2026-10-25T06:00:00Z'), alerta('c-2', '2026-10-27T06:00:00Z')];

    const r = await pedir(alertas, 'GET', '/api/alertas?desde=2026-10-26T00:00:00Z', 'GUARDIA', GUARDIA);

    expect(r.cuerpo.map((a: { clusterId: string }) => a.clusterId)).toEqual(['c-2']);
  });

  it('sin la IA es 503 con Retry-After', async () => {
    ia.caida = true;
    const r = await pedir(alertas, 'GET', '/api/alertas', 'GUARDIA', GUARDIA);
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('5');
  });
});
