import { DescribeTableCommand, type DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DescribeStreamCommand,
  type DynamoDBStreamsClient,
  ExpiredIteratorException,
  GetRecordsCommand,
  GetShardIteratorCommand,
  ResourceNotFoundException,
  TrimmedDataAccessException,
  type _Record,
} from '@aws-sdk/client-dynamodb-streams';
import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** Envía un mensaje a RabbitMQ y resuelve solo cuando el broker lo confirmó. */
export interface Publicador {
  publicar(routingKey: string, cuerpo: string, eventId: string): Promise<void>;
}

/**
 * S4: relevo del stream de la tabla de Acceso (docs/datos/modelo-de-datos.md: DynamoDB Streams equivale al outbox).
 * Lee las altas de `ComandoAtendido` y publica su respuesta en RabbitMQ. Recuerda por fragmento del stream la última
 * respuesta confirmada (`RELEVO#<fragmento>`): tras un reinicio sigue desde ahí, así nada se pierde (entrega al
 * menos una vez; la idempotencia de Reservas, S5, descarta un repetido).
 */
export class RelevoStream {
  private streamArn: string | undefined;
  private readonly iteradores = new Map<string, string>();
  private readonly terminados = new Set<string>();

  constructor(
    private readonly dynamo: DynamoDBClient,
    private readonly streams: DynamoDBStreamsClient,
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabla: string,
    private readonly publicador: Publicador,
  ) {}

  /** Una vuelta por todos los fragmentos del stream. @return cuántas respuestas publicó */
  async vuelta(): Promise<number> {
    let publicadas = 0;
    const fragmentos = await this.fragmentos();
    const vivos = new Set(fragmentos.map((f) => f.id));
    for (const { id, padre } of fragmentos) {
      // Un fragmento hijo se lee cuando su padre terminó: así las respuestas salen en el orden en que se guardaron.
      if (this.terminados.has(id) || (padre && vivos.has(padre) && !this.terminados.has(padre))) continue;
      publicadas += await this.leerFragmento(id);
    }
    return publicadas;
  }

  private async leerFragmento(fragmento: string): Promise<number> {
    let iterador: string;
    try {
      iterador = this.iteradores.get(fragmento) ?? (await this.iteradorDesdeElCursor(fragmento));
    } catch (e) {
      // El stream guarda 24 h: un fragmento viejo ya no existe y no tiene nada pendiente.
      if (!(e instanceof ResourceNotFoundException)) throw e;
      this.terminados.add(fragmento);
      return 0;
    }
    let respuesta;
    try {
      respuesta = await this.streams.send(new GetRecordsCommand({ ShardIterator: iterador, Limit: 100 }));
    } catch (e) {
      // Un iterador vence a los 15 min sin uso: se pide otro desde el cursor en la vuelta siguiente.
      if (e instanceof ExpiredIteratorException) {
        this.iteradores.delete(fragmento);
        return 0;
      }
      if (e instanceof ResourceNotFoundException) {
        this.iteradores.delete(fragmento);
        this.terminados.add(fragmento);
        return 0;
      }
      throw e;
    }
    let publicadas = 0;
    for (const registro of respuesta.Records ?? []) {
      if (!(await this.publicarSiEsRespuesta(registro))) continue;
      publicadas++;
      // El cursor avanza solo después de publicar: un corte aquí repite el mensaje, nunca lo pierde. Se guarda solo
      // tras publicar (el propio cursor también pasa por el stream y no debe generar otra escritura).
      await this.guardarCursor(fragmento, registro.dynamodb?.SequenceNumber);
    }
    if (respuesta.NextShardIterator) this.iteradores.set(fragmento, respuesta.NextShardIterator);
    else {
      this.iteradores.delete(fragmento);
      this.terminados.add(fragmento);
    }
    return publicadas;
  }

  private async publicarSiEsRespuesta(registro: _Record): Promise<boolean> {
    const nuevo = registro.dynamodb?.NewImage;
    if (registro.eventName !== 'INSERT' || nuevo?.tipo?.S !== 'ComandoAtendido' || !nuevo.mensaje?.S || !nuevo.routingKey?.S) return false;
    const mensaje = nuevo.mensaje.S;
    const eventId = String((JSON.parse(mensaje) as { eventId?: unknown }).eventId ?? '');
    await this.publicador.publicar(nuevo.routingKey.S, mensaje, eventId);
    return true;
  }

  private async fragmentos(): Promise<{ id: string; padre?: string }[]> {
    this.streamArn ??= await this.arnDelStream();
    const ids: { id: string; padre?: string }[] = [];
    let desde: string | undefined;
    do {
      const r = await this.streams.send(new DescribeStreamCommand({ StreamArn: this.streamArn, ExclusiveStartShardId: desde }));
      for (const s of r.StreamDescription?.Shards ?? []) if (s.ShardId) ids.push({ id: s.ShardId, padre: s.ParentShardId });
      desde = r.StreamDescription?.LastEvaluatedShardId;
    } while (desde);
    return ids;
  }

  private async arnDelStream(): Promise<string> {
    const arn = (await this.dynamo.send(new DescribeTableCommand({ TableName: this.tabla }))).Table?.LatestStreamArn;
    if (!arn) throw new Error(`La tabla ${this.tabla} no tiene stream: créala con db/tabla-acceso.json (StreamSpecification)`);
    return arn;
  }

  private async iteradorDesdeElCursor(fragmento: string): Promise<string> {
    const cursor = (await this.doc.send(new GetCommand({ TableName: this.tabla, Key: { PK: `RELEVO#${fragmento}`, SK: 'META' }, ConsistentRead: true }))).Item;
    const secuencia = typeof cursor?.secuencia === 'string' ? cursor.secuencia : undefined;
    const pedir = (desdeCursor: boolean) =>
      this.streams.send(
        new GetShardIteratorCommand({
          StreamArn: this.streamArn,
          ShardId: fragmento,
          ...(desdeCursor && secuencia ? { ShardIteratorType: 'AFTER_SEQUENCE_NUMBER', SequenceNumber: secuencia } : { ShardIteratorType: 'TRIM_HORIZON' }),
        }),
      );
    let r;
    try {
      r = await pedir(true);
    } catch (e) {
      // El registro del cursor ya salió del stream (más de 24 h): lo que queda es todo posterior.
      if (!(e instanceof TrimmedDataAccessException)) throw e;
      r = await pedir(false);
    }
    if (!r.ShardIterator) throw new Error(`El stream no dio un iterador para el fragmento ${fragmento}`);
    return r.ShardIterator;
  }

  private async guardarCursor(fragmento: string, secuencia: string | undefined): Promise<void> {
    if (!secuencia) return;
    await this.doc.send(new PutCommand({ TableName: this.tabla, Item: { PK: `RELEVO#${fragmento}`, SK: 'META', tipo: 'CursorRelevo', secuencia } }));
  }
}
