import { DatoInvalido } from '../errores';
import type { Pase } from './pase';
import type { VentanaPase } from './visita';

export interface InvitadoDeReserva {
  readonly invitadoId: string;
  readonly nombre: string;
}

export interface PaseDeInvitado {
  readonly invitadoId: string;
  readonly codigo: string;
}

/** Pedido del paso 3 de la saga (Reservas → Acceso). */
export interface PedidoDePases {
  readonly reservaId: string;
  readonly unidadCodigo: string;
  readonly fecha: string;
  readonly invitados: readonly InvitadoDeReserva[];
}

/**
 * Pases de los invitados de una reserva (paso 3 de la saga, A1). Recuerda qué código recibió cada invitado: así una
 * emisión repetida devuelve los mismos pases y una revocación sabe cuáles revocar. EMITIDA: tiene sus pases.
 * REVOCADA: se compensó; si llega una emisión tardía, ya no emite nada.
 */
export interface PasesDeReserva {
  readonly reservaId: string;
  readonly unidadCodigo: string;
  readonly fecha: string;
  readonly estado: 'EMITIDA' | 'REVOCADA';
  readonly pases: readonly PaseDeInvitado[];
}

/** Un pase de la reserva es un pase como el de una visita (mismo almacén), más la reserva y el invitado. */
export type PaseDeReserva = Pase & { readonly reservaId: string; readonly invitadoId: string };

/** A1: un pase de un solo uso por invitado, para el día de la reserva. */
export function emitirPasesDeReserva(pedido: PedidoDePases, codigoPase: () => string): PasesDeReserva {
  if (!esFechaReal(pedido.fecha)) {
    throw new DatoInvalido(`Fecha inválida: '${pedido.fecha}' (yyyy-mm-dd)`);
  }
  if (pedido.unidadCodigo.trim() === '') throw new DatoInvalido('La reserva necesita el código de su unidad');
  const ids = pedido.invitados.map((i) => i.invitadoId);
  if (ids.some((id) => id.trim() === '') || new Set(ids).size !== ids.length) {
    throw new DatoInvalido('Cada invitado de la reserva necesita un id propio');
  }
  return {
    reservaId: pedido.reservaId,
    unidadCodigo: pedido.unidadCodigo.trim().toUpperCase(),
    fecha: pedido.fecha,
    estado: 'EMITIDA',
    pases: pedido.invitados.map((i) => ({ invitadoId: i.invitadoId, codigo: codigoPase() })),
  };
}

/** Compensación que llegó antes que la emisión: queda marcada para que una emisión tardía no emita nada. */
export function revocadaSinEmitir(reservaId: string): PasesDeReserva {
  return { reservaId, unidadCodigo: '', fecha: '', estado: 'REVOCADA', pases: [] };
}

export function revocarPasesDeReserva(p: PasesDeReserva): PasesDeReserva {
  return p.estado === 'REVOCADA' ? p : { ...p, estado: 'REVOCADA' };
}

/** Los pases que ve el guardia (A1, A2), con la ventana de una visita; ninguno si la reserva ya se revocó. */
export function pasesDeLosInvitados(p: PasesDeReserva, ventana: VentanaPase, creadaEn: string): PaseDeReserva[] {
  if (p.estado === 'REVOCADA') return [];
  return p.pases.map((x) => ({
    codigo: x.codigo,
    unidadCodigo: p.unidadCodigo,
    estado: 'VIGENTE',
    usos: 0,
    usosMaximos: 1,
    validoDesde: `${p.fecha}T${ventana.horaDesde}${ventana.offset}`,
    validoHasta: `${p.fecha}T${ventana.horaHasta}${ventana.offset}`,
    origen: 'RESERVA',
    actualizadoEn: creadaEn,
    reservaId: p.reservaId,
    invitadoId: x.invitadoId,
  }));
}

/** yyyy-mm-dd que existe en el calendario (rechaza 2026-02-30, que Date.parse corregiría a marzo). */
function esFechaReal(fecha: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  return m !== null && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString().slice(0, 10) === fecha;
}
