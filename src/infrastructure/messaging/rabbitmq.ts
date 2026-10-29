import amqp, { type Channel, type Connection, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import type { ComandoSaga } from '@/application/ports/saga';
import { leerComando, MensajeInvalido } from './lector-comando';
import type { Publicador } from './relevo-stream';

export interface Registro {
  info(mensaje: string, datos?: Record<string, unknown>): void;
  warn(mensaje: string, datos?: Record<string, unknown>): void;
  error(mensaje: string, datos?: Record<string, unknown>): void;
}

/** Log JSON estructurado (CLAUDE.md raíz): nunca tokens ni datos sensibles. */
export const registroJson: Registro = {
  info: (mensaje, datos) => console.log(JSON.stringify({ nivel: 'info', mensaje, ...datos })),
  warn: (mensaje, datos) => console.warn(JSON.stringify({ nivel: 'warn', mensaje, ...datos })),
  error: (mensaje, datos) => console.error(JSON.stringify({ nivel: 'error', mensaje, ...datos })),
};

/**
 * Publicador con confirmación del broker: persistente y `mandatory` (si ninguna cola lo recibe, es un fallo y el
 * relevo lo reintenta). La topología es de infra/rabbitmq/definitions.json: el exchange debe existir.
 */
export class PublicadorRabbitMq implements Publicador {
  private canal: ConfirmChannel | undefined;
  private sinCola: string | undefined;

  constructor(
    private readonly conexion: Connection,
    private readonly exchange: string,
  ) {}

  async publicar(routingKey: string, cuerpo: string, eventId: string): Promise<void> {
    const canal = await this.abrir();
    this.sinCola = undefined;
    canal.publish(this.exchange, routingKey, Buffer.from(cuerpo), {
      persistent: true,
      mandatory: true,
      contentType: 'application/json',
      contentEncoding: 'utf-8',
      messageId: eventId,
      type: routingKey,
    });
    await canal.waitForConfirms();
    if (this.sinCola) throw new Error(`RabbitMQ no tiene cola para ${routingKey}: ${this.sinCola}`);
  }

  private async abrir(): Promise<ConfirmChannel> {
    if (this.canal) return this.canal;
    const canal = await this.conexion.createConfirmChannel();
    await canal.checkExchange(this.exchange);
    canal.on('return', (m: ConsumeMessage) => {
      this.sinCola = `ninguna cola recibe ${m.fields.routingKey}`;
    });
    canal.on('close', () => {
      this.canal = undefined;
    });
    this.canal = canal;
    return canal;
  }
}

/**
 * Consumidor de la cola `acceso.reservas` (S5). De a un mensaje (prefetch 1): así una revocación nunca se atiende a la
 * vez que la emisión de la misma reserva, que llegó antes. Un error pasajero se reintenta 3 veces con espera
 * exponencial (S2); un mensaje fuera de contrato, o que sigue fallando, va a la cola de fallidos (condohub.dlq).
 * La confirmación (ack) se envía recién cuando el comando quedó atendido.
 */
export async function consumirComandos(
  conexion: Connection,
  cola: string,
  atender: (comando: ComandoSaga) => Promise<boolean>,
  log: Registro,
  esperasMs: readonly number[] = [500, 1000, 2000],
): Promise<Channel> {
  const canal = await conexion.createChannel();
  await canal.checkQueue(cola);
  await canal.prefetch(1);
  await canal.consume(cola, async (mensaje) => {
    if (!mensaje) return;
    let comando: ComandoSaga;
    try {
      comando = leerComando(mensaje.content.toString('utf8'));
    } catch (e) {
      log.error('Comando de la saga fuera de contrato: va a la cola de fallidos', { error: (e as Error).message });
      canal.nack(mensaje, false, false);
      return;
    }
    const contexto = { eventId: comando.eventId, tipo: comando.tipo, sagaId: comando.sagaId, reservaId: comando.data.reservaId };
    for (const [intento, espera] of [0, ...esperasMs].entries()) {
      await new Promise((r) => setTimeout(r, espera));
      try {
        const atendido = await atender(comando);
        canal.ack(mensaje);
        log.info(atendido ? 'Comando de la saga atendido' : 'Comando de la saga repetido: se descarta', contexto);
        return;
      } catch (e) {
        if (e instanceof MensajeInvalido) break;
        log.warn('No se pudo atender un comando de la saga', { ...contexto, intento: intento + 1, error: (e as Error).message });
      }
    }
    log.error('Comando de la saga sin atender tras los reintentos: va a la cola de fallidos', contexto);
    canal.nack(mensaje, false, false);
  });
  return canal;
}

export function conectar(url: string): Promise<Connection> {
  return amqp.connect(url);
}
