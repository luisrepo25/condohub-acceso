/**
 * Paso 3 de la saga de reserva: comandos que Reservas envía a Acceso por RabbitMQ (cola `acceso.reservas`) y la
 * respuesta que Acceso devuelve. Las formas son las de contracts/events.
 */
export type ComandoSaga =
  | {
      readonly tipo: 'reservas.EmitirPasesReserva';
      readonly eventId: string;
      readonly sagaId: string | null;
      readonly data: {
        readonly reservaId: string;
        readonly unidadId: string;
        readonly unidadCodigo: string;
        readonly fecha: string;
        readonly invitados: readonly { readonly invitadoId: string; readonly nombre: string }[];
      };
    }
  | {
      readonly tipo: 'reservas.RevocarPasesReserva';
      readonly eventId: string;
      readonly sagaId: string | null;
      readonly data: { readonly reservaId: string };
    };

export type RespuestaSaga =
  | { readonly tipo: 'acceso.PaseEmitido'; readonly data: { reservaId: string; pases: { invitadoId: string; codigo: string }[] } }
  | { readonly tipo: 'acceso.PaseRevocado'; readonly data: { reservaId: string; cantidad: number } };

/**
 * S4, S5: comandos ya atendidos. Marcar uno guarda también su respuesta en la misma escritura; de ahí la publica el
 * relevo hacia RabbitMQ (equivale al outbox), así la respuesta sale aunque el proceso se caiga justo después.
 */
export interface ComandosAtendidos {
  atendido(eventId: string): Promise<boolean>;
  /** Marca el comando y deja su respuesta para publicar. Repetirlo no hace nada. */
  marcar(comando: ComandoSaga, respuesta: RespuestaSaga): Promise<void>;
}
