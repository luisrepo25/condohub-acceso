// POST /api/visitas, /api/pases/validar y /api/accesos de punta a punta: JWT, forma, casos de uso, reglas y DynamoDB
// Local real (escrituras condicionales y transacciones). Gestión y el reloj son dobles. "Ahora" = martes 27/10/2026
// 12:00 en La Paz.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as accesos } from '@/app/api/accesos/route';
import { POST as validar } from '@/app/api/pases/validar/route';
import { POST as visitas } from '@/app/api/visitas/route';
import { GestionNoDisponible } from '@/application/errores';
import { usarDependencias } from '@/infrastructure/composicion';
import { usarVerificador } from '@/infrastructure/http/proteger';
import { crearTablaDePrueba } from './dynamo-prueba';
import { crearToken, verificadorDePrueba } from './helpers';

const RESIDENTE = '00000000-0000-0000-0000-00000000a002';
const GUARDIA = '00000000-0000-0000-0000-00000000a003';
let ahora = new Date('2026-10-27T16:00:00Z');
const gestion = { unidades: ['A-101'] as string[], caida: false, consultas: 0 };
let db: Awaited<ReturnType<typeof crearTablaDePrueba>>;

beforeAll(async () => {
  usarVerificador(verificadorDePrueba);
  db = await crearTablaDePrueba();
  process.env.DYNAMODB_TABLA = db.tabla;
  await db.poner({ PK: 'PLACA#1234ABC', SK: 'META', tipo: 'Vehiculo', placa: '1234ABC', unidadCodigo: 'A-104', activa: true });
  await db.poner({ PK: 'PLACA#9999ZZZ', SK: 'META', tipo: 'Vehiculo', placa: '9999ZZZ', unidadCodigo: 'A-105', activa: false });
});

afterAll(async () => {
  usarDependencias(undefined);
  delete process.env.DYNAMODB_TABLA;
  await db.borrar();
});

beforeEach(() => {
  ahora = new Date('2026-10-27T16:00:00Z');
  Object.assign(gestion, { unidades: ['A-101'], caida: false, consultas: 0 });
  usarDependencias({
    reloj: { ahora: () => ahora },
    unidades: {
      codigos: async () => {
        gestion.consultas++;
        if (gestion.caida) throw new GestionNoDisponible('caída');
        return gestion.unidades;
      },
    },
  });
});

async function llamar(manejador: (r: Request) => Promise<Response>, rol: string, sub: string, cuerpo: unknown, clave?: string | null) {
  const headers: Record<string, string> = { authorization: `Bearer ${await crearToken([rol], { sub })}`, 'content-type': 'application/json' };
  if (clave !== null) headers['idempotency-key'] = clave ?? randomUUID();
  const r = await manejador(new Request('http://localhost/api', { method: 'POST', headers, body: JSON.stringify(cuerpo) }));
  return { status: r.status, cuerpo: (await r.json()) as Record<string, any>, headers: r.headers };
}

const nuevaVisita = (cambios: Record<string, unknown> = {}) => ({ unidadCodigo: 'A-101', nombre: 'Ana Pérez', documento: '123', fecha: '2026-10-27', ...cambios });
const registrarVisita = (cambios = {}, clave?: string, rol = 'RESIDENTE', sub = RESIDENTE) => llamar(visitas, rol, sub, nuevaVisita(cambios), clave);
const validarPase = (codigo: string) => llamar(validar, 'GUARDIA', GUARDIA, { codigo });
const ingreso = (cambios: Record<string, unknown> = {}, clave?: string) =>
  llamar(accesos, 'GUARDIA', GUARDIA, { sentido: 'INGRESO', categoria: 'PEATON', horaDispositivo: '2026-10-27T11:59:30-04:00', ...cambios }, clave);

async function paseNuevo(): Promise<string> {
  const r = await registrarVisita();
  expect(r.status).toBe(201);
  return r.cuerpo.pase.codigo;
}

describe('POST /api/visitas (A1, F1, O3)', () => {
  it('A1 el residente registra una visita para su unidad y recibe su pase de un solo uso, 07:00–23:59 hora local', async () => {
    const r = await registrarVisita();

    expect(r.status).toBe(201);
    expect(r.cuerpo).toMatchObject({ unidadCodigo: 'A-101', nombre: 'Ana Pérez', documento: '123', fecha: '2026-10-27' });
    expect(r.cuerpo.pase).toMatchObject({
      unidadCodigo: 'A-101', estado: 'VIGENTE', usos: 0, usosMaximos: 1, origen: 'VISITA',
      validoDesde: '2026-10-27T11:00:00.000Z', validoHasta: '2026-10-28T03:59:59.000Z', visitaId: r.cuerpo.visitaId,
    });
    expect(r.cuerpo.pase.codigo).toMatch(/^QR-[A-Za-z0-9_-]{22}$/);
  });

  it('O3 repetir la misma Idempotency-Key devuelve la misma visita y el mismo pase, sin crear otro', async () => {
    const clave = randomUUID();
    const primera = await registrarVisita({}, clave);
    const repetida = await registrarVisita({ nombre: 'Otro nombre' }, clave);

    expect(repetida.status).toBe(201);
    expect(repetida.cuerpo).toEqual(primera.cuerpo);
  });

  it('O3 la clave de otra persona no devuelve su visita', async () => {
    const clave = randomUUID();
    await registrarVisita({}, clave);

    const r = await registrarVisita({}, clave, 'RESIDENTE', '00000000-0000-0000-0000-00000000ffff');
    expect(r.status).toBe(409);
    expect(r.cuerpo.code).toBe('O3');
  });

  it('F1 un residente no registra visitas para una unidad ajena; el ADMIN sí, sin consultar a Gestión', async () => {
    const ajena = await registrarVisita({ unidadCodigo: 'B-101' });
    expect(ajena.status).toBe(403);
    expect(ajena.cuerpo.code).toBe('F1');

    gestion.consultas = 0;
    const admin = await registrarVisita({ unidadCodigo: 'B-101' }, undefined, 'ADMIN', '00000000-0000-0000-0000-00000000a001');
    expect(admin.status).toBe(201);
    expect(gestion.consultas).toBe(0);
  });

  it('A1 una fecha que ya pasó se rechaza con 422', async () => {
    const r = await registrarVisita({ fecha: '2026-10-26' });
    expect(r.status).toBe(422);
    expect(r.cuerpo.code).toBe('A1');
  });

  it('sin Gestión no se sabe si la unidad es suya: 503 con Retry-After', async () => {
    gestion.caida = true;
    const r = await registrarVisita();
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('5');
  });

  it.each([
    ['sin Idempotency-Key', {}, null, 400],
    ['clave que no es UUID v4', {}, 'abc', 422],
    ['sin nombre', { nombre: undefined }, undefined, 400],
    ['fecha mal escrita', { fecha: '27/10/2026' }, undefined, 400],
    ['unidad mal escrita', { unidadCodigo: 'casa 5' }, undefined, 400],
  ])('%s responde %i en problem+json', async (_caso, cambios, clave, status) => {
    const r = await registrarVisita(cambios, clave as string | undefined);
    expect(r.status).toBe(status);
    expect(r.headers.get('content-type')).toContain('application/problem+json');
  });
});

describe('POST /api/pases/validar (A2)', () => {
  it('A2 un pase vigente es válido y validarlo varias veces no lo gasta', async () => {
    const codigo = await paseNuevo();

    for (let i = 0; i < 3; i++) {
      const r = await validarPase(codigo);
      expect(r.status).toBe(200);
      expect(r.cuerpo).toMatchObject({ valido: true, pase: { codigo, usos: 0, estado: 'VIGENTE' } });
    }
  });

  it('A2 un código que no existe, un pase de mañana o uno vencido se rechazan con su motivo', async () => {
    expect((await validarPase('QR-no-existe')).cuerpo).toEqual({ valido: false, motivo: 'NO_EXISTE' });

    const manana = (await registrarVisita({ fecha: '2026-10-28' })).cuerpo.pase.codigo;
    expect((await validarPase(manana)).cuerpo).toMatchObject({ valido: false, motivo: 'AUN_NO_VALIDO' });

    const hoy = await paseNuevo();
    ahora = new Date('2026-10-28T04:00:00Z');
    expect((await validarPase(hoy)).cuerpo).toMatchObject({ valido: false, motivo: 'VENCIDO', pase: { estado: 'VENCIDO' } });
  });

  it('sin código es 400', async () => {
    expect((await llamar(validar, 'GUARDIA', GUARDIA, {})).status).toBe(400);
  });
});

describe('POST /api/accesos (A1–A4, O3)', () => {
  it('A1 A2 el ingreso con pase lo consume una sola vez; un segundo ingreso se rechaza con motivo USADO', async () => {
    const codigo = await paseNuevo();

    const primero = await ingreso({ paseCodigo: codigo });
    expect(primero.status).toBe(201);
    expect(primero.cuerpo).toMatchObject({
      sentido: 'INGRESO', categoria: 'PEATON', paseCodigo: codigo, unidadCodigo: 'A-101', resultado: 'PERMITIDO',
      guardiaSub: GUARDIA, horaDispositivo: '2026-10-27T15:59:30.000Z', horaServidor: '2026-10-27T16:00:00.000Z',
    });
    expect((await validarPase(codigo)).cuerpo).toMatchObject({ valido: false, motivo: 'USADO', pase: { usos: 1, estado: 'USADO' } });

    const segundo = await ingreso({ paseCodigo: codigo });
    expect(segundo.status).toBe(422);
    expect(segundo.cuerpo).toMatchObject({ code: 'A2', motivo: 'USADO' });
  });

  it('A1 A2 si dos guardias registran el mismo pase a la vez, solo uno entra', async () => {
    const codigo = await paseNuevo();

    const resultados = await Promise.all([ingreso({ paseCodigo: codigo }), ingreso({ paseCodigo: codigo }), ingreso({ paseCodigo: codigo })]);

    expect(resultados.map((r) => r.status).sort()).toEqual([201, 422, 422]);
    expect((await validarPase(codigo)).cuerpo.pase.usos).toBe(1);
  });

  it('O3 repetir el registro con la misma clave devuelve lo mismo y no gasta el pase dos veces', async () => {
    const codigo = await paseNuevo();
    const clave = randomUUID();

    const primero = await ingreso({ paseCodigo: codigo }, clave);
    const repetido = await ingreso({ paseCodigo: codigo }, clave);

    expect(repetido.status).toBe(201);
    expect(repetido.cuerpo).toEqual(primero.cuerpo);
    expect((await validarPase(codigo)).cuerpo.pase.usos).toBe(1);
  });

  it('A2 un pase vencido o inexistente no permite el ingreso', async () => {
    const codigo = await paseNuevo();
    ahora = new Date('2026-10-28T05:00:00Z');
    expect((await ingreso({ paseCodigo: codigo })).cuerpo).toMatchObject({ code: 'A2', motivo: 'VENCIDO' });
    expect((await ingreso({ paseCodigo: 'QR-no-existe' })).cuerpo).toMatchObject({ code: 'A2', motivo: 'NO_EXISTE' });
  });

  it('A1 una salida o un rechazo con pase no lo gastan', async () => {
    const codigo = await paseNuevo();

    expect((await ingreso({ sentido: 'SALIDA', paseCodigo: codigo })).status).toBe(201);
    expect((await ingreso({ paseCodigo: codigo, resultado: 'RECHAZADO', motivo: 'Documento no coincide' })).status).toBe(201);
    expect((await validarPase(codigo)).cuerpo).toMatchObject({ valido: true, pase: { usos: 0 } });
  });

  it('A2 sin pase, el ingreso necesita la unidad que lo autoriza; un rechazo necesita motivo', async () => {
    expect((await ingreso()).cuerpo.code).toBe('A2');
    expect((await ingreso({ unidadCodigo: 'b-201' })).cuerpo).toMatchObject({ resultado: 'PERMITIDO', unidadCodigo: 'B-201' });
    expect((await ingreso({ resultado: 'RECHAZADO' })).cuerpo.code).toBe('A2');
  });

  it('A4 una placa de residente bien leída autoriza por su unidad; si no, decide el guardia', async () => {
    const vehiculo = { categoria: 'VEHICULO', placa: '1234-abc' };
    expect((await ingreso({ ...vehiculo, confianzaPlaca: 0.91 })).cuerpo).toMatchObject({ unidadCodigo: 'A-104', placa: '1234ABC' });
    expect((await ingreso({ ...vehiculo, confianzaPlaca: 0.6 })).cuerpo.code).toBe('A4');
    expect((await ingreso({ categoria: 'VEHICULO', placa: '5555XYZ', confianzaPlaca: 0.99 })).cuerpo.code).toBe('A4');
    expect((await ingreso({ categoria: 'VEHICULO', placa: '9999ZZZ', confianzaPlaca: 0.99 })).cuerpo.code).toBe('A4');
    // El guardia decide: con la unidad que autoriza, entra aunque la lectura sea dudosa.
    expect((await ingreso({ ...vehiculo, confianzaPlaca: 0.6, unidadCodigo: 'A-104' })).status).toBe(201);
  });

  it('A3 una corrección referencia un registro existente; nunca se edita el anterior', async () => {
    const original = await ingreso({ unidadCodigo: 'A-101' });

    const correccion = await ingreso({ unidadCodigo: 'A-102', corrigeA: original.cuerpo.registroId });
    expect(correccion.status).toBe(201);
    expect(correccion.cuerpo.corrigeA).toBe(original.cuerpo.registroId);

    expect((await ingreso({ unidadCodigo: 'A-102', corrigeA: randomUUID() })).cuerpo.code).toBe('A3');
  });

  it.each([
    ['hora sin zona', { horaDispositivo: '2026-10-27 11:59' }],
    ['sentido inválido', { sentido: 'ENTRADA' }],
    ['confianza como texto', { placa: '1234ABC', confianzaPlaca: '0.9' }],
  ])('%s es 400', async (_caso, cambios) => {
    expect((await ingreso({ unidadCodigo: 'A-101', ...cambios })).status).toBe(400);
  });
});
