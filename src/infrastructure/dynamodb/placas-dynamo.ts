import { ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { PlacaRepositorio } from '@/application/ports/placas';
import type { PlacaRegistrada } from '@/domain/model/placa';

/**
 * Vehículos de residentes en la tabla única (`PK = PLACA#<placa>`, `SK = META`). Recorre la tabla con un filtro: sirve para unos
 * cientos de placas (un condominio de ~200 unidades). TODO: si creciera, un GSI por tipo evitaría el recorrido.
 */
export class PlacasDynamo implements PlacaRepositorio {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabla: string,
  ) {}

  async activas(): Promise<PlacaRegistrada[]> {
    const placas: PlacaRegistrada[] = [];
    let siguiente: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(
        new ScanCommand({
          TableName: this.tabla,
          FilterExpression: 'begins_with(PK, :p) AND SK = :m AND activa = :t',
          ExpressionAttributeValues: { ':p': 'PLACA#', ':m': 'META', ':t': true },
          ExclusiveStartKey: siguiente,
        }),
      );
      for (const i of r.Items ?? []) placas.push({ placa: String(i.placa), unidadCodigo: String(i.unidadCodigo) });
      siguiente = r.LastEvaluatedKey;
    } while (siguiente);
    return placas;
  }
}
