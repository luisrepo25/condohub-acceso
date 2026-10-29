import { DatoInvalido } from '../errores';
import { exigirFecha } from '../value-objects/hora-local';
import type { ParametrosAcceso } from '../value-objects/parametros';
import { unidadCodigo } from '../value-objects/unidad';
import { Pase } from './pase';

export interface InvitadoDeReserva {
  readonly invitadoId: string;
  readonly nombre: string;
}

export interface PaseDeInvitado {
  readonly invitadoId: string;
  readonly codigo: string;
}

export interface DatosPasesDeReserva {
  readonly reservaId: string;
  readonly unidadCodigo: string;
  readonly fecha: string;
  /** EMITIDA: tiene sus pases. REVOCADA: se compensó; si llega una emisión tardía, ya no emite nada. */
  readonly estado: 'EMITIDA' | 'REVOCADA';
  readonly pases: readonly PaseDeInvitado[];
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
 * emisión repetida devuelve los mismos pases y una revocación sabe cuáles revocar. Inmutable.
 */
export class PasesDeReserva {
  private constructor(readonly datos: DatosPasesDeReserva) {}

  /** Paso 3: un pase de un solo uso por invitado, para el día de la reserva (A1). */
  static emitir(pedido: PedidoDePases, codigoPase: () => string): PasesDeReserva {
    exigirFecha(pedido.fecha);
    const ids = pedido.invitados.map((i) => i.invitadoId);
    if (ids.some((id) => id.trim() === '') || new Set(ids).size !== ids.length) {
      throw new DatoInvalido('Cada invitado de la reserva necesita un id propio');
    }
    return new PasesDeReserva({
      reservaId: pedido.reservaId,
      unidadCodigo: unidadCodigo(pedido.unidadCodigo),
      fecha: pedido.fecha,
      estado: 'EMITIDA',
      pases: pedido.invitados.map((i) => ({ invitadoId: i.invitadoId, codigo: codigoPase() })),
    });
  }

  /** Compensación que llegó antes que la emisión: queda marcada para que una emisión tardía no emita nada. */
  static revocadaSinEmitir(reservaId: string): PasesDeReserva {
    return new PasesDeReserva({ reservaId, unidadCodigo: '', fecha: '', estado: 'REVOCADA', pases: [] });
  }

  static reconstituir(datos: DatosPasesDeReserva): PasesDeReserva {
    return new PasesDeReserva(datos);
  }

  get revocada(): boolean {
    return this.datos.estado === 'REVOCADA';
  }

  /** Los pases de los invitados (A1); ninguno si la reserva ya se revocó. */
  pases(p: ParametrosAcceso): Pase[] {
    if (this.revocada) return [];
    const { reservaId, unidadCodigo: unidad, fecha } = this.datos;
    return this.datos.pases.map((x) => Pase.emitirParaReserva(x.codigo, { reservaId, invitadoId: x.invitadoId }, unidad, fecha, p));
  }

  revocar(): PasesDeReserva {
    return this.revocada ? this : new PasesDeReserva({ ...this.datos, estado: 'REVOCADA' });
  }
}
