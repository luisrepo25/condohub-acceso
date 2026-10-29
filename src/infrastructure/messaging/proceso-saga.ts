// `npm run saga`: proceso del paso 3 de la saga de reserva (contenedor `acceso-saga`). Atiende los comandos de
// Reservas (cola `acceso.reservas`) y publica sus respuestas desde el stream de la tabla (S4). Si RabbitMQ o DynamoDB
// no responden, reintenta: los comandos esperan en su cola y las respuestas en el stream.
import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { AtenderComandoSaga } from '@/application/atender-comando-saga';
import { configPasesDesdeEntorno, nuevoCodigoPase } from '../config-pases';
import { configSagaDesdeEntorno } from '../config-saga';
import { configDynamoDesdeEntorno, crearClienteDynamo } from '../dynamodb/cliente';
import { ComandosAtendidosDynamo, PasesDeReservaDynamo } from '../dynamodb/pases-de-reserva-dynamo';
import { conectar, consumirComandos, PublicadorRabbitMq, registroJson as log } from './rabbitmq';
import { RelevoStream } from './relevo-stream';

const cfgDynamo = configDynamoDesdeEntorno();
const cfgSaga = configSagaDesdeEntorno();
const conexionAws = {
  region: cfgDynamo.region,
  ...(cfgDynamo.endpoint
    ? { endpoint: cfgDynamo.endpoint, credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local' } }
    : {}),
};
const dynamo = new DynamoDBClient(conexionAws);
const doc = crearClienteDynamo(cfgDynamo);
const atender = new AtenderComandoSaga({
  repositorio: new PasesDeReservaDynamo(doc, cfgDynamo.tabla),
  atendidos: new ComandosAtendidosDynamo(doc, cfgDynamo.tabla),
  nuevoCodigoPase, // el código del pase es la credencial del QR: 128 bits aleatorios, igual que el de una visita
  ventana: configPasesDesdeEntorno().ventana,
  reloj: () => new Date(),
});

let activo = true;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function vueltaDeServicio(): Promise<void> {
  const conexion = await conectar(cfgSaga.rabbitmqUrl);
  const cerrada = new Promise<void>((resolver) => {
    conexion.on('close', () => resolver());
    conexion.on('error', (e: Error) => log.warn('RabbitMQ cerró la conexión', { error: e.message }));
  });
  await consumirComandos(conexion, cfgSaga.rabbitmqColaSaga, (comando) => atender.ejecutar(comando), log);
  const relevo = new RelevoStream(dynamo, new DynamoDBStreamsClient(conexionAws), doc, cfgDynamo.tabla, new PublicadorRabbitMq(conexion, cfgSaga.rabbitmqExchange));
  log.info('Saga de Acceso escuchando', { cola: cfgSaga.rabbitmqColaSaga, tabla: cfgDynamo.tabla });
  let abierta = true;
  void cerrada.then(() => {
    abierta = false;
  });
  while (activo && abierta) {
    try {
      const publicadas = await relevo.vuelta();
      if (publicadas > 0) log.info('Respuestas de la saga publicadas', { publicadas });
    } catch (e) {
      log.warn('El relevo no pudo publicar; se reintenta', { error: (e as Error).message });
    }
    await espera(cfgSaga.relevoIntervaloMs);
  }
  if (abierta) await conexion.close();
}

async function principal(): Promise<void> {
  for (const senal of ['SIGINT', 'SIGTERM'] as const) process.on(senal, () => (activo = false));
  while (activo) {
    try {
      await vueltaDeServicio();
    } catch (e) {
      log.error('Saga de Acceso sin RabbitMQ o DynamoDB; se reintenta en 5 s', { error: (e as Error).message });
      await espera(5000);
    }
  }
}

void principal();
