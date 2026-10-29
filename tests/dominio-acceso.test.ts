import { describe, expect, it } from 'vitest';
import { DatoInvalido, ReglaViolada } from '@/domain/errores';
import { motivoPaseNoUsable, type Pase } from '@/domain/model/pase';
import { leerNuevoAcceso, registrarAcceso } from '@/domain/model/registro-acceso';

const contexto = { registroId: 'r-1', horaServidor: '2026-10-28T15:00:00.000Z', guardiaSub: 'guardia-1' };
const base = { sentido: 'INGRESO', categoria: 'PEATON', horaDispositivo: '2026-10-28T14:59:50.000Z', unidadCodigo: 'A-101' };
const registrar = (extra: object = {}) => registrarAcceso(leerNuevoAcceso({ ...base, ...extra }), contexto);

describe('registro de acceso', () => {
  it('O1_guarda_la_hora_del_dispositivo_aparte_de_la_del_servidor', () => {
    const r = registrar();
    expect(r.horaDispositivo).toBe(base.horaDispositivo);
    expect(r.horaServidor).toBe(contexto.horaServidor);
    expect(r.guardiaSub).toBe('guardia-1');
  });

  it('A2_sin_resultado_el_ingreso_queda_permitido', () => {
    expect(registrar().resultado).toBe('PERMITIDO');
  });

  it('A2_un_rechazo_exige_motivo', () => {
    expect(() => registrar({ resultado: 'RECHAZADO' })).toThrow(ReglaViolada);
    expect(registrar({ resultado: 'RECHAZADO', motivo: 'Pase vencido' }).motivo).toBe('Pase vencido');
  });

  it('A2_el_ingreso_manual_sin_pase_ni_placa_exige_la_unidad_que_autoriza', () => {
    expect(() => registrar({ unidadCodigo: undefined })).toThrow(ReglaViolada);
    expect(() => registrar({ unidadCodigo: undefined, paseCodigo: 'QR-1' })).not.toThrow();
  });

  it('A4_la_placa_se_guarda_en_mayusculas_y_sin_separadores', () => {
    expect(registrar({ categoria: 'VEHICULO', placa: '1001-abc', confianzaPlaca: 0.9 }).placa).toBe('1001ABC');
  });

  it('A3_un_registro_puede_corregir_a_otro_sin_editarlo', () => {
    expect(registrar({ corrigeA: 'r-0' }).corrigeA).toBe('r-0');
    expect(Object.isFrozen(registrar())).toBe(true);
  });

  it.each([
    ['sentido desconocido', { sentido: 'PASO' }],
    ['categoria desconocida', { categoria: 'BICI' }],
    ['hora ilegible', { horaDispositivo: 'ayer' }],
    ['confianza fuera de rango', { confianzaPlaca: 1.5 }],
    ['campo de texto con otro tipo', { unidadCodigo: 7 }],
  ])('rechaza la forma incorrecta: %s', (_nombre, extra) => {
    expect(() => leerNuevoAcceso({ ...base, ...extra })).toThrow(DatoInvalido);
  });

  it('rechaza un cuerpo que no es un objeto', () => {
    expect(() => leerNuevoAcceso('hola')).toThrow(DatoInvalido);
    expect(() => leerNuevoAcceso(null)).toThrow(DatoInvalido);
  });
});

describe('A2 pase usable', () => {
  const pase: Pase = {
    codigo: 'QR-1', unidadCodigo: 'A-101', estado: 'VIGENTE', usos: 0, usosMaximos: 1,
    validoDesde: '2026-10-28T07:00:00-04:00', validoHasta: '2026-10-28T23:59:59-04:00',
  };
  const dentro = new Date('2026-10-28T15:00:00Z');

  it('A2_un_pase_vigente_dentro_de_su_ventana_sirve', () => {
    expect(motivoPaseNoUsable(pase, dentro)).toBeUndefined();
  });

  it.each([
    ['NO_EXISTE', undefined, dentro],
    ['REVOCADO', { ...pase, estado: 'REVOCADO' as const }, dentro],
    ['USADO', { ...pase, estado: 'USADO' as const, usos: 1 }, dentro],
    ['VENCIDO', pase, new Date('2026-10-29T12:00:00Z')],
    ['AUN_NO_VALIDO', pase, new Date('2026-10-28T10:00:00Z')],
  ])('A2_rechaza_con_motivo_%s', (motivo, p, ahora) => {
    expect(motivoPaseNoUsable(p, ahora)).toBe(motivo);
  });
});
