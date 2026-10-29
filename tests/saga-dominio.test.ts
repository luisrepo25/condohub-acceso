// Paso 3 de la saga de reserva en el dominio, sin infraestructura (A1, A2, A3). Reserva del viernes 30/10/2026.
import { describe, expect, it } from 'vitest';
import { DatoInvalido } from '@/domain/errores';
import { Pase } from '@/domain/model/pase';
import { PasesDeReserva } from '@/domain/model/pases-de-reserva';
import type { ParametrosAcceso } from '@/domain/value-objects/parametros';

const P: ParametrosAcceso = { zonaHoraria: 'America/La_Paz', ventanaDesde: '07:00:00', ventanaHasta: '23:59:59', confianzaPlacaMinima: 0.85 };
const PEDIDO = {
  reservaId: 'r1',
  unidadCodigo: 'a-101',
  fecha: '2026-10-30',
  invitados: [
    { invitadoId: 'i1', nombre: 'Ana Pérez' },
    { invitadoId: 'i2', nombre: 'Luis Rojas' },
  ],
};

function emitida(): PasesDeReserva {
  let n = 0;
  return PasesDeReserva.emitir(PEDIDO, () => `QR-${++n}`);
}

describe('pases de los invitados de una reserva', () => {
  it('A1 cada invitado recibe un pase de un solo uso para el día de la reserva, con la ventana de una visita', () => {
    const pases = emitida().pases(P);

    expect(pases.map((p) => p.datos)).toEqual([
      expect.objectContaining({ codigo: 'QR-1', invitadoId: 'i1', reservaId: 'r1', unidadCodigo: 'A-101', origen: 'RESERVA', usosMaximos: 1, estado: 'VIGENTE' }),
      expect.objectContaining({ codigo: 'QR-2', invitadoId: 'i2', origen: 'RESERVA' }),
    ]);
    expect(pases[0]!.datos.validoDesde.toISOString()).toBe('2026-10-30T11:00:00.000Z');
    expect(pases[0]!.datos.validoHasta.toISOString()).toBe('2026-10-31T03:59:59.000Z');
    expect(pases[0]!.datos.visitaId).toBeUndefined();
  });

  it('A2 el pase de un invitado se valida y se consume igual que el de una visita', () => {
    const pase = emitida().pases(P)[0]!;

    expect(pase.evaluar(new Date('2026-10-30T20:00:00Z'))).toEqual({ valido: true });
    expect(pase.consumir(new Date('2026-10-30T20:00:00Z')).evaluar(new Date('2026-10-30T21:00:00Z'))).toEqual({ valido: false, motivo: 'USADO' });
  });

  it('A1 cada invitado necesita su propio id, y la fecha y la unidad deben ser válidas', () => {
    expect(() => PasesDeReserva.emitir({ ...PEDIDO, invitados: [PEDIDO.invitados[0]!, PEDIDO.invitados[0]!] }, () => 'QR')).toThrow(DatoInvalido);
    expect(() => PasesDeReserva.emitir({ ...PEDIDO, fecha: '2026-02-30' }, () => 'QR')).toThrow(DatoInvalido);
    expect(() => PasesDeReserva.emitir({ ...PEDIDO, unidadCodigo: 'cualquiera' }, () => 'QR')).toThrow(DatoInvalido);
  });

  it('una reserva sin invitados no emite pases', () => {
    expect(PasesDeReserva.emitir({ ...PEDIDO, invitados: [] }, () => 'QR').pases(P)).toEqual([]);
  });

  it('A2 una reserva revocada ya no emite pases, aunque la emisión llegue tarde', () => {
    expect(emitida().revocar().revocada).toBe(true);
    expect(emitida().revocar().pases(P)).toEqual([]);
    expect(PasesDeReserva.revocadaSinEmitir('r1').pases(P)).toEqual([]);
  });

  it('A2 A3 revocar deja REVOCADO un pase vigente; uno usado o ya revocado no cambia', () => {
    const vigente = emitida().pases(P)[0]!;
    const usado = vigente.consumir(new Date('2026-10-30T20:00:00Z'));

    expect(vigente.revocar().evaluar(new Date('2026-10-30T20:00:00Z'))).toEqual({ valido: false, motivo: 'REVOCADO' });
    expect(usado.revocar()).toBe(usado);
    expect(vigente.revocar().revocar().datos.estado).toBe('REVOCADO');
  });

  it('el pase de una visita sigue igual (sin reserva ni invitado)', () => {
    const pase = Pase.emitirParaVisita('QR-V', 'v1', 'A-101', '2026-10-30', P);

    expect(pase.datos.origen).toBe('VISITA');
    expect(pase.datos.reservaId).toBeUndefined();
  });
});
