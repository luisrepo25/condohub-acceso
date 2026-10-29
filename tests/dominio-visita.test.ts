import { describe, expect, it } from 'vitest';
import { DatoInvalido } from '@/domain/errores';
import { motivoPaseNoUsable } from '@/domain/model/pase';
import { leerNuevaVisita, registrarVisita } from '@/domain/model/visita';

const contexto = {
  visitaId: 'v-1',
  codigoPase: 'CH-abc',
  creadaEn: '2026-10-28T15:00:00.000Z',
  registradaPor: 'residente-1',
  ventana: { horaDesde: '07:00:00', horaHasta: '23:59:59', offset: '-04:00' },
};
const base = { unidadCodigo: 'A-101', nombre: 'Ana Pérez', fecha: '2026-10-30' };

describe('visita y pase (A1)', () => {
  it('A1_anunciar_una_visita_emite_un_pase_vigente_de_un_solo_uso', () => {
    const v = registrarVisita(leerNuevaVisita(base), contexto);
    expect(v.pase).toMatchObject({ codigo: 'CH-abc', estado: 'VIGENTE', usos: 0, usosMaximos: 1, origen: 'VISITA', unidadCodigo: 'A-101' });
  });

  it('A1_la_ventana_por_defecto_es_el_dia_indicado_de_07_00_a_23_59', () => {
    const { pase } = registrarVisita(leerNuevaVisita(base), contexto);
    expect(pase.validoDesde).toBe('2026-10-30T07:00:00-04:00');
    expect(pase.validoHasta).toBe('2026-10-30T23:59:59-04:00');
    expect(motivoPaseNoUsable(pase, new Date('2026-10-30T15:00:00Z'))).toBeUndefined();
    expect(motivoPaseNoUsable(pase, new Date('2026-10-31T15:00:00Z'))).toBe('VENCIDO');
    expect(motivoPaseNoUsable(pase, new Date('2026-10-30T10:00:00Z'))).toBe('AUN_NO_VALIDO');
  });

  it('A1_la_ventana_sale_de_la_configuracion_no_de_una_constante', () => {
    const { pase } = registrarVisita(leerNuevaVisita(base), { ...contexto, ventana: { horaDesde: '08:00:00', horaHasta: '20:00:00', offset: '-03:00' } });
    expect(pase.validoDesde).toBe('2026-10-30T08:00:00-03:00');
  });

  it('A1_la_visita_guarda_quien_la_registro', () => {
    const v = registrarVisita(leerNuevaVisita({ ...base, documento: 'CI-1' }), contexto);
    expect(v).toMatchObject({ registradaPor: 'residente-1', documento: 'CI-1', visitaId: 'v-1' });
    expect(v.pase.visitaId).toBe('v-1');
  });

  it.each([
    ['sin nombre', { nombre: undefined }],
    ['sin unidad', { unidadCodigo: undefined }],
    ['fecha ilegible', { fecha: '30/10/2026' }],
    ['fecha imposible', { fecha: '2026-13-45' }],
    ['nombre con otro tipo', { nombre: 5 }],
    ['nombre larguisimo', { nombre: 'x'.repeat(121) }],
  ])('rechaza la forma incorrecta: %s', (_n, extra) => {
    expect(() => leerNuevaVisita({ ...base, ...extra })).toThrow(DatoInvalido);
  });
});
