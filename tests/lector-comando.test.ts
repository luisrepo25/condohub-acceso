// S5: el consumidor de Acceso solo acepta comandos de la saga con el sobre y los campos de su contrato.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { leerComando, MensajeInvalido } from '@/infrastructure/messaging/lector-comando';

const RESERVA = '44444444-4444-4444-8444-000000000001';
const INVITADO = '55555555-5555-4555-8555-000000000001';

function sobre(type: string, data: Record<string, unknown>, sagaId: unknown = '33333333-3333-4333-8333-000000000001'): string {
  return JSON.stringify({ eventId: '11111111-1111-4111-8111-000000000001', type, occurredAt: '2026-10-28T12:00:00Z', sagaId, version: 1, data });
}

const EMITIR = { reservaId: RESERVA, unidadId: '1c672f16-6d63-4534-8c00-3c6813468783', unidadCodigo: 'A-101', fecha: '2026-10-30', invitados: [{ invitadoId: INVITADO, nombre: 'Ana Pérez' }] };

describe('comandos de la saga para Acceso', () => {
  it('lee EmitirPasesReserva y RevocarPasesReserva', () => {
    expect(leerComando(sobre('reservas.EmitirPasesReserva', EMITIR))).toEqual({
      tipo: 'reservas.EmitirPasesReserva', eventId: '11111111-1111-4111-8111-000000000001', sagaId: '33333333-3333-4333-8333-000000000001', data: EMITIR,
    });
    expect(leerComando(sobre('reservas.RevocarPasesReserva', { reservaId: RESERVA }, null))).toMatchObject({ tipo: 'reservas.RevocarPasesReserva', sagaId: null, data: { reservaId: RESERVA } });
  });

  it.each([
    ['no es JSON', 'hola'],
    ['tipo ajeno', sobre('reservas.AplicarCargosReserva', { reservaId: RESERVA })],
    ['sin reservaId', sobre('reservas.RevocarPasesReserva', {})],
    ['invitados que no son lista', sobre('reservas.EmitirPasesReserva', { ...EMITIR, invitados: 'Ana' })],
    ['invitado sin id', sobre('reservas.EmitirPasesReserva', { ...EMITIR, invitados: [{ nombre: 'Ana' }] })],
    ['fecha mal escrita', sobre('reservas.EmitirPasesReserva', { ...EMITIR, fecha: '30/10/2026' })],
    ['sagaId que no es uuid', sobre('reservas.RevocarPasesReserva', { reservaId: RESERVA }, 'x')],
  ])('un mensaje fuera de contrato se rechaza: %s', (_, cuerpo) => {
    expect(() => leerComando(cuerpo)).toThrow(MensajeInvalido);
  });

  it('el comando del contrato tiene exactamente los campos que se leen', () => {
    const ruta = fileURLToPath(new URL('../../../contracts/events/reservas.EmitirPasesReserva.schema.json', import.meta.url));
    if (!existsSync(ruta)) return;
    const data = JSON.parse(readFileSync(ruta, 'utf8')).allOf[1].properties.data;
    expect(Object.keys(EMITIR).sort()).toEqual([...data.required].sort());
    expect(Object.keys(EMITIR.invitados[0]!).sort()).toEqual([...data.properties.invitados.items.required].sort());
  });

  it('las respuestas de Acceso tienen los campos de su contrato', () => {
    for (const [tipo, data] of [
      ['acceso.PaseEmitido', { reservaId: RESERVA, pases: [{ invitadoId: INVITADO, codigo: 'QR-1' }] }],
      ['acceso.PaseRevocado', { reservaId: RESERVA, cantidad: 1 }],
    ] as const) {
      const ruta = fileURLToPath(new URL(`../../../contracts/events/${tipo}.schema.json`, import.meta.url));
      if (!existsSync(ruta)) return;
      const esquema = JSON.parse(readFileSync(ruta, 'utf8')).allOf[1].properties.data;
      expect(Object.keys(data).sort(), tipo).toEqual(Object.keys(esquema.properties).sort());
    }
  });
});
