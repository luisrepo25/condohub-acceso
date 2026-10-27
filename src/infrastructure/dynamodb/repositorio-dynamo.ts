import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  type DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { ClaveYaUsada, PaseYaNoDisponible, type RespuestaGuardada } from '@/domain/ports/repositorios';

export type Escritura = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

/** O3: las respuestas guardadas se borran solas (TTL de DynamoDB sobre `expiraEn`) a los 7 días. */
const DIAS_IDEMPOTENCIA = 7;

/**
 * Base de los repositorios de Acceso sobre la tabla única de DynamoDB (docs/datos/modelo-de-datos.md). Cada escritura
 * de la API va en una transacción con su respuesta idempotente (`IDEM#<clave>` con `attribute_not_exists`): todo o nada.
 */
export abstract class RepositorioDynamo {
  constructor(
    protected readonly doc: DynamoDBDocumentClient,
    protected readonly tabla: string,
  ) {}

  protected idempotencia(r: RespuestaGuardada): Escritura {
    return this.nuevo({
      PK: `IDEM#${r.clave}`, SK: 'META', tipo: 'Idempotencia',
      // O3: el cuerpo se guarda como texto JSON, así se devuelve idéntico (un mapa de DynamoDB no conserva el orden).
      sub: r.sub, codigoHttp: r.codigoHttp, respuesta: JSON.stringify(r.cuerpo),
      expiraEn: Math.floor(Date.now() / 1000) + DIAS_IDEMPOTENCIA * 86400,
    });
  }

  /** Put que solo escribe si el ítem no existe: nada se sobrescribe (A3: solo se agrega). */
  protected nuevo(item: Record<string, unknown>): Escritura {
    return { Put: { TableName: this.tabla, Item: item, ConditionExpression: 'attribute_not_exists(PK)' } };
  }

  /**
   * La primera escritura es siempre la de idempotencia: si su condición falla, la clave ya se usó.
   *
   * @param indicePase posición de la actualización condicional de un pase, para distinguir su fallo
   */
  protected async transaccion(escrituras: Escritura[], indicePase?: number): Promise<void> {
    try {
      await this.doc.send(new TransactWriteCommand({ TransactItems: escrituras }));
    } catch (e) {
      if (!(e instanceof TransactionCanceledException)) throw e;
      const motivos = e.CancellationReasons ?? [];
      if (motivos[0]?.Code === 'ConditionalCheckFailed') throw new ClaveYaUsada();
      if (indicePase !== undefined && motivos[indicePase]?.Code === 'ConditionalCheckFailed') throw new PaseYaNoDisponible();
      throw e;
    }
  }

  protected async leer(pk: string): Promise<Record<string, unknown> | null> {
    const { Item } = await this.doc.send(new GetCommand({ TableName: this.tabla, Key: { PK: pk, SK: 'META' }, ConsistentRead: true }));
    return Item ?? null;
  }
}
