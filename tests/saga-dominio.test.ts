// Paso 3 de la saga de reserva en el dominio, sin infraestructura (A1, A2, A3). Reserva del viernes 30/10/2026.
import { describe, expect, it } from 'vitest';
import { DatoInvalido } from '@/domain/errores';
import { motivoPaseNoUsable } from '@/domain/model/pase';
import { emitirPasesDeReserva, pasesDeLosInvitados, revocadaSinEmitir, revocarPasesDeReserva } from '@/domain/model/pases-de-reserva';

const VENTANA = { horaDesde: '07:00:00', horaHasta: '23:59:59', offset: '-04:00' };
const CREADA = '2026-10-28T12:00:00.000Z';
const PEDIDO = {
  reservaId: 'r1',
  unidadCodigo: 'a-101',
  fecha: '2026-10-30',
  invitados: [
    { invitadoId: 'i1', nombre: 'Ana Pérez' },
    { invitadoId: 'i2', nombre: 'Luis Rojas' },
  ],
};

function emitida() {
  let n = 0;
  return emitirPasesDeReserva(PEDIDO, () => `QR-${++n}`);
}

describe('pases de los invitados de una reserva', () => {
  it('A1 cada invitado recibe un pase de un solo uso para el día de la reserva, con la ventana de una visita', () => {
    const pases = pasesDeLosInvitados(emitida(), VENTANA, CREADA);

    expect(pases).toEqual([
      expect.objectContaining({ codigo: 'QR-1', invitadoId: 'i1', reservaId: 'r1', unidadCodigo: 'A-101', origen: 'RESERVA', usosMaximos: 1, estado: 'VIGENTE' }),
      expect.objectContaining({ codigo: 'QR-2', invitadoId: 'i2', origen: 'RESERVA' }),
    ]);
    expect(pases[0]!.validoDesde).toBe('2026-10-30T07:00:00-04:00');
    expect(pases[0]!.validoHasta).toBe('2026-10-30T23:59:59-04:00');
    expect(pases[0]!.visitaId).toBeUndefined();
  });

  it('A2 el pase de un invitado se valida igual que el de una visita', () => {
    const pase = pasesDeLosInvitados(emitida(), VENTANA, CREADA)[0]!;

    expect(motivoPaseNoUsable(pase, new Date('2026-10-30T20:00:00Z'))).toBeUndefined();
    expect(motivoPaseNoUsable(pase, new Date('2026-10-31T12:00:00Z'))).toBe('VENCIDO');
  });

  it('A1 cada invitado necesita su propio id, y la fecha y la unidad deben ser válidas', () => {
    expect(() => emitirPasesDeReserva({ ...PEDIDO, invitados: [PEDIDO.invitados[0]!, PEDIDO.invitados[0]!] }, () => 'QR')).toThrow(DatoInvalido);
    expect(() => emitirPasesDeReserva({ ...PEDIDO, fecha: '2026-02-30' }, () => 'QR')).toThrow(DatoInvalido);
    expect(() => emitirPasesDeReserva({ ...PEDIDO, unidadCodigo: ' ' }, () => 'QR')).toThrow(DatoInvalido);
  });

  it('una reserva sin invitados no emite pases', () => {
    expect(pasesDeLosInvitados(emitirPasesDeReserva({ ...PEDIDO, invitados: [] }, () => 'QR'), VENTANA, CREADA)).toEqual([]);
  });

  it('A2 una reserva revocada ya no emite pases, aunque la emisión llegue tarde', () => {
    expect(revocarPasesDeReserva(emitida()).estado).toBe('REVOCADA');
    expect(pasesDeLosInvitados(revocarPasesDeReserva(emitida()), VENTANA, CREADA)).toEqual([]);
    expect(pasesDeLosInvitados(revocadaSinEmitir('r1'), VENTANA, CREADA)).toEqual([]);
  });

  it('revocar dos veces es lo mismo que revocar una', () => {
    const revocada = revocarPasesDeReserva(emitida());
    expect(revocarPasesDeReserva(revocada)).toBe(revocada);
  });
});
