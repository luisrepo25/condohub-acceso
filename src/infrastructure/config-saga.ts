export interface ConfigSaga {
  readonly rabbitmqUrl: string;
  readonly rabbitmqExchange: string;
  readonly rabbitmqColaSaga: string;
  /** Cada cuánto el relevo del stream publica las respuestas de la saga (S4). */
  readonly relevoIntervaloMs: number;
}

/** Saga de reserva, paso 3 (proceso `npm run saga`): RabbitMQ y el relevo del stream. */
export function configSagaDesdeEntorno(env: Record<string, string | undefined> = process.env): ConfigSaga {
  return {
    rabbitmqUrl: env.RABBITMQ_URL ?? 'amqp://condohub:condohub@localhost:5672/%2F',
    rabbitmqExchange: env.RABBITMQ_EXCHANGE ?? 'condohub.events',
    rabbitmqColaSaga: env.RABBITMQ_COLA_SAGA ?? 'acceso.reservas',
    relevoIntervaloMs: Number(env.RELEVO_INTERVALO_MS ?? 1000),
  };
}
