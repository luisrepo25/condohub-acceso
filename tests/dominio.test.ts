// Reglas del dominio de Acceso sin infraestructura (A1–A4, O1). "Ahora" = martes 27/10/2026 12:00 en La Paz (UTC-4).
import { describe, expect, it } from 'vitest';
import { DatoInvalido, ReglaNegocioViolada } from '@/domain/errores';
import { Pase } from '@/domain/model/pase';
import { RegistroAcceso } from '@/domain/model/registro-acceso';
import { Visita } from '@/domain/model/visita';
import { unidadPorPlaca } from '@/domain/services/politica-placas';
import { fechaLocal, instanteLocal } from '@/domain/value-objects/hora-local';
import { idempotencyKey } from '@/domain/value-objects/idempotency-key';
import type { ParametrosAcceso } from '@/domain/value-objects/parametros';
import { normalizarPlaca } from '@/domain/value-objects/placa';

const P: ParametrosAcceso = { zonaHoraria: 'America/La_Paz', ventanaDesde: '07:00:00', ventanaHasta: '23:59:59', confianzaPlacaMinima: 0.85 };
const AHORA = new Date('2026-10-27T16:00:00Z');
const en = (iso: string) => new Date(iso);

function regla(fn: () => unknown): ReglaNegocioViolada {
  try {
    fn();
  } catch (e) {
    if (e instanceof ReglaNegocioViolada) return e;
    throw e;
  }
  throw new Error('se esperaba ReglaNegocioViolada');
}

function visita(fecha = '2026-10-27') {
  return Visita.registrar({ unidadCodigo: 'a-101', nombre: ' Ana Pérez ', documento: '123', fecha }, { visitaId: 'v1', codigoPase: 'QR-1' }, 'sub-res', AHORA, P);
}

describe('hora local del condominio', () => {
  it('A1 07:00 y 23:59:59 en La Paz son 11:00Z y 03:59:59Z del día siguiente', () => {
    expect(instanteLocal('2026-10-27', '07:00:00', 'America/La_Paz').toISOString()).toBe('2026-10-27T11:00:00.000Z');
    expect(instanteLocal('2026-10-27', '23:59:59', 'America/La_Paz').toISOString()).toBe('2026-10-28T03:59:59.000Z');
  });

  it('la fecha local de un instante cambia a medianoche local, no a medianoche UTC', () => {
    expect(fechaLocal(en('2026-10-28T03:30:00Z'), 'America/La_Paz')).toBe('2026-10-27');
    expect(fechaLocal(en('2026-10-28T04:00:00Z'), 'America/La_Paz')).toBe('2026-10-28');
  });

  it('una fecha que no existe es un dato inválido', () => {
    expect(() => instanteLocal('2026-02-30', '07:00:00', 'America/La_Paz')).toThrow(DatoInvalido);
  });
});

describe('visita y pase (A1)', () => {
  it('A1 la visita nace con un pase vigente de un solo uso para el día indicado, 07:00–23:59 hora local', () => {
    const v = visita();
    expect(v.datos).toMatchObject({ unidadCodigo: 'A-101', nombre: 'Ana Pérez', documento: '123', fecha: '2026-10-27' });
    expect(v.pase.datos).toMatchObject({ codigo: 'QR-1', visitaId: 'v1', unidadCodigo: 'A-101', estado: 'VIGENTE', usos: 0, usosMaximos: 1, origen: 'VISITA' });
    expect(v.pase.datos.validoDesde.toISOString()).toBe('2026-10-27T11:00:00.000Z');
    expect(v.pase.datos.validoHasta.toISOString()).toBe('2026-10-28T03:59:59.000Z');
  });

  it('A1 no se registra una visita para un día que ya pasó', () => {
    expect(regla(() => visita('2026-10-26')).codigo).toBe('A1');
  });

  it('A1 una visita para un día futuro es válida', () => {
    expect(visita('2026-11-15').datos.fecha).toBe('2026-11-15');
  });

  it('datos mal formados son DatoInvalido', () => {
    expect(() => Visita.registrar({ unidadCodigo: 'A-101', nombre: '  ', fecha: '2026-10-27' }, { visitaId: 'v', codigoPase: 'q' }, 's', AHORA, P)).toThrow(DatoInvalido);
    expect(() => Visita.registrar({ unidadCodigo: 'casa 5', nombre: 'Ana', fecha: '2026-10-27' }, { visitaId: 'v', codigoPase: 'q' }, 's', AHORA, P)).toThrow(DatoInvalido);
    expect(() => Visita.registrar({ unidadCodigo: 'A-101', nombre: 'Ana', fecha: '27/10/2026' }, { visitaId: 'v', codigoPase: 'q' }, 's', AHORA, P)).toThrow(DatoInvalido);
  });
});

describe('validar y consumir un pase (A2)', () => {
  it('A2 un pase vigente dentro de su ventana es válido, y evaluarlo no lo gasta', () => {
    const pase = visita().pase;
    expect(pase.evaluar(AHORA)).toEqual({ valido: true });
    expect(pase.evaluar(AHORA)).toEqual({ valido: true });
    expect(pase.datos.usos).toBe(0);
  });

  it('A2 rechazos con motivo: aún no válido, vencido, usado y revocado', () => {
    const pase = visita().pase;
    expect(pase.evaluar(en('2026-10-27T10:59:00Z'))).toEqual({ valido: false, motivo: 'AUN_NO_VALIDO' });
    expect(pase.evaluar(en('2026-10-28T04:00:00Z'))).toEqual({ valido: false, motivo: 'VENCIDO' });
    expect(pase.estadoEn(en('2026-10-28T04:00:00Z'))).toBe('VENCIDO');
    expect(pase.consumir(AHORA).evaluar(AHORA)).toEqual({ valido: false, motivo: 'USADO' });
    expect(Pase.reconstituir({ ...pase.datos, estado: 'REVOCADO' }).evaluar(AHORA)).toEqual({ valido: false, motivo: 'REVOCADO' });
  });

  it('A1 consumir deja el pase USADO y un segundo uso se rechaza con A2 USADO', () => {
    const usado = visita().pase.consumir(AHORA);
    expect(usado.datos).toMatchObject({ usos: 1, estado: 'USADO' });
    const e = regla(() => usado.consumir(AHORA));
    expect(e.codigo).toBe('A2');
    expect(e.detalle).toEqual({ motivo: 'USADO' });
  });

  it('A2 un pase vencido no se consume', () => {
    expect(regla(() => visita().pase.consumir(en('2026-10-28T05:00:00Z'))).detalle).toEqual({ motivo: 'VENCIDO' });
  });
});

describe('registro de acceso (A2, A3)', () => {
  const extra = { registroId: 'r1', guardiaSub: 'sub-guardia', horaServidor: AHORA };
  const base = { sentido: 'INGRESO', categoria: 'PEATON', horaDispositivo: en('2026-10-27T15:59:00Z') } as const;

  it('A2 un ingreso sin pase necesita la unidad que lo autoriza', () => {
    expect(regla(() => RegistroAcceso.registrar(base, extra)).codigo).toBe('A2');
    expect(RegistroAcceso.registrar({ ...base, unidadCodigo: 'b-101' }, extra).datos.unidadCodigo).toBe('B-101');
  });

  it('A2 un rechazo se registra con su motivo', () => {
    expect(regla(() => RegistroAcceso.registrar({ ...base, resultado: 'RECHAZADO' }, extra)).codigo).toBe('A2');
    expect(RegistroAcceso.registrar({ ...base, resultado: 'RECHAZADO', motivo: 'Pase vencido' }, extra).datos.motivo).toBe('Pase vencido');
  });

  it('A3 una salida no necesita autorización y nada de un registro cambia la hora del dispositivo (O1)', () => {
    const r = RegistroAcceso.registrar({ ...base, sentido: 'SALIDA' }, extra);
    expect(r.datos.horaDispositivo.toISOString()).toBe('2026-10-27T15:59:00.000Z');
    expect(r.datos.horaServidor).toBe(AHORA);
  });

  it('A1 solo un ingreso permitido con pase lo gasta', () => {
    expect(RegistroAcceso.registrar({ ...base, paseCodigo: 'QR-1' }, extra).consumePase()).toBe(true);
    expect(RegistroAcceso.registrar({ ...base, sentido: 'SALIDA', paseCodigo: 'QR-1' }, extra).consumePase()).toBe(false);
    expect(RegistroAcceso.registrar({ ...base, paseCodigo: 'QR-1', resultado: 'RECHAZADO', motivo: 'x' }, extra).consumePase()).toBe(false);
  });

  it('A4 la confianza de la placa va entre 0 y 1 y solo con una placa', () => {
    expect(() => RegistroAcceso.registrar({ ...base, unidadCodigo: 'A-101', placa: '1234ABC', confianzaPlaca: 1.5 }, extra)).toThrow(DatoInvalido);
    expect(() => RegistroAcceso.registrar({ ...base, unidadCodigo: 'A-101', confianzaPlaca: 0.9 }, extra)).toThrow(DatoInvalido);
  });
});

describe('placas (A4)', () => {
  const vehiculo = { placa: '1234ABC', unidadCodigo: 'A-104', activa: true };

  it('A4 una placa de residente con confianza ≥ 0.85 autoriza el ingreso por su unidad', () => {
    expect(unidadPorPlaca(vehiculo, 0.85, 0.85)).toBe('A-104');
    expect(unidadPorPlaca(vehiculo, 0.97, 0.85)).toBe('A-104');
  });

  it('A4 con menos confianza, sin coincidencia o dada de baja, decide el guardia', () => {
    expect(regla(() => unidadPorPlaca(vehiculo, 0.84, 0.85)).codigo).toBe('A4');
    expect(regla(() => unidadPorPlaca(vehiculo, undefined, 0.85)).codigo).toBe('A4');
    expect(regla(() => unidadPorPlaca(null, 0.99, 0.85)).codigo).toBe('A4');
    expect(regla(() => unidadPorPlaca({ ...vehiculo, activa: false }, 0.99, 0.85)).codigo).toBe('A4');
  });

  it('A4 la placa se compara en mayúsculas y sin separadores', () => {
    expect(normalizarPlaca('1234-abc')).toBe('1234ABC');
    expect(normalizarPlaca(' 1234 abc ')).toBe('1234ABC');
  });
});

describe('Idempotency-Key (O1)', () => {
  it('O1 acepta un UUID v4; sin clave es dato inválido y otra cosa viola O1', () => {
    expect(idempotencyKey('11111111-1111-4111-8111-111111111111')).toBe('11111111-1111-4111-8111-111111111111');
    expect(() => idempotencyKey(null)).toThrow(DatoInvalido);
    expect(regla(() => idempotencyKey('no-es-uuid')).codigo).toBe('O1');
    expect(regla(() => idempotencyKey('a8098c1a-f86e-11da-bd1a-00112444be1e')).codigo).toBe('O1');
  });
});
