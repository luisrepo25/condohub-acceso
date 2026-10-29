import type { ComandoSaga } from '@/application/ports/saga';

/** Un mensaje de la cola de la saga que no cumple su contrato: no se reintenta, va a la cola de fallidos. */
export class MensajeInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'MensajeInvalido';
  }
}

type Objeto = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lee el sobre de contracts/events (`{eventId, type, sagaId, data}`) de un comando de la saga para Acceso:
 * `reservas.EmitirPasesReserva` o `reservas.RevocarPasesReserva`. Solo la forma: las reglas las aplica el dominio.
 */
export function leerComando(cuerpo: string): ComandoSaga {
  const sobre = objeto(parsear(cuerpo), 'el mensaje');
  const data = objeto(sobre.data, 'data');
  const eventId = uuid(sobre.eventId, 'eventId');
  const sagaId = sobre.sagaId === null || sobre.sagaId === undefined ? null : uuid(sobre.sagaId, 'sagaId');
  const reservaId = uuid(data.reservaId, 'data.reservaId');
  if (sobre.type === 'reservas.RevocarPasesReserva') {
    return { tipo: 'reservas.RevocarPasesReserva', eventId, sagaId, data: { reservaId } };
  }
  if (sobre.type !== 'reservas.EmitirPasesReserva') {
    throw new MensajeInvalido(`Tipo de mensaje no esperado en la cola de Acceso: ${JSON.stringify(sobre.type)}`);
  }
  if (!Array.isArray(data.invitados)) throw new MensajeInvalido('data.invitados debe ser una lista');
  const fecha = texto(data.fecha, 'data.fecha');
  if (!FECHA.test(fecha)) throw new MensajeInvalido('data.fecha debe ser YYYY-MM-DD');
  return {
    tipo: 'reservas.EmitirPasesReserva',
    eventId,
    sagaId,
    data: {
      reservaId,
      unidadId: uuid(data.unidadId, 'data.unidadId'),
      unidadCodigo: texto(data.unidadCodigo, 'data.unidadCodigo'),
      fecha,
      invitados: data.invitados.map((i, n) => {
        const invitado = objeto(i, `data.invitados[${n}]`);
        return { invitadoId: uuid(invitado.invitadoId, `data.invitados[${n}].invitadoId`), nombre: texto(invitado.nombre, `data.invitados[${n}].nombre`) };
      }),
    },
  };
}

function parsear(cuerpo: string): unknown {
  try {
    return JSON.parse(cuerpo);
  } catch {
    throw new MensajeInvalido('El mensaje no es JSON');
  }
}

function objeto(v: unknown, campo: string): Objeto {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new MensajeInvalido(`${campo} debe ser un objeto`);
  return v as Objeto;
}

function texto(v: unknown, campo: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new MensajeInvalido(`${campo} debe ser texto no vacío`);
  return v;
}

function uuid(v: unknown, campo: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new MensajeInvalido(`${campo} debe ser un UUID`);
  return v.toLowerCase();
}
