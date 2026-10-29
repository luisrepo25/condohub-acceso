import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand, TransactWriteCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { PaseRepositorio, ResultadoVisita, VisitaRepositorio } from '@/application/ports/pases';
import type { Pase } from '@/domain/model/pase';
import type { Visita } from '@/domain/model/visita';
import { conCamposOrdenados } from './orden';

const SIETE_DIAS = 7 * 24 * 3600;

type Escritura = NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']>[number];

/** Visitas y pases en la tabla única `condohub-acceso` (ver docs/datos/modelo-de-datos.md). */
export class VisitaPaseDynamo implements VisitaRepositorio, PaseRepositorio {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabla: string,
  ) {}

  async guardar(visita: Visita, clave: string): Promise<ResultadoVisita> {
    const previa = await this.respuestaGuardada(clave);
    if (previa) return { creada: false, respuesta: conCamposOrdenados(previa) };
    try {
      await this.doc.send(new TransactWriteCommand({ TransactItems: this.escrituras(visita, clave) }));
      return { creada: true, respuesta: conCamposOrdenados(visita) };
    } catch (e) {
      if (!(e instanceof TransactionCanceledException)) throw e;
      const repetida = await this.respuestaGuardada(clave);
      if (repetida) return { creada: false, respuesta: conCamposOrdenados(repetida) };
      throw e;
    }
  }

  /** A1: la visita, su pase y la clave de idempotencia se guardan juntos o no se guarda nada. */
  private escrituras(v: Visita, clave: string): Escritura[] {
    const nuevo = { ConditionExpression: 'attribute_not_exists(PK)' };
    const dia = v.pase.validoDesde.slice(0, 10);
    return [
      {
        Put: {
          TableName: this.tabla, ...nuevo,
          Item: {
            PK: `IDEM#${clave}`, SK: 'META', tipo: 'Idempotencia', respuesta: v, codigoHttp: 201,
            expiraEn: Math.floor(Date.parse(v.creadaEn) / 1000) + SIETE_DIAS,
          },
        },
      },
      { Put: { TableName: this.tabla, ...nuevo, Item: { PK: `UNIDAD#${v.unidadCodigo}`, SK: `VISITA#${v.fecha}#${v.visitaId}`, tipo: 'Visita', ...v } } },
      {
        Put: {
          TableName: this.tabla, ...nuevo,
          Item: { PK: `PASE#${v.pase.codigo}`, SK: 'META', tipo: 'Pase', ...v.pase, GSI1PK: `PASES#${dia}`, GSI1SK: `PASE#${v.pase.codigo}` },
        },
      },
    ];
  }

  async obtener(codigo: string): Promise<Pase | undefined> {
    const r = await this.doc.send(new GetCommand({ TableName: this.tabla, Key: { PK: `PASE#${codigo}`, SK: 'META' } }));
    return r.Item ? this.comoPase(r.Item) : undefined;
  }

  async delDia(fecha: string): Promise<Pase[]> {
    const r = await this.doc.send(new QueryCommand({
      TableName: this.tabla, IndexName: 'GSI1', KeyConditionExpression: 'GSI1PK = :d',
      ExpressionAttributeValues: { ':d': `PASES#${fecha}` },
    }));
    return (r.Items ?? []).map((i) => this.comoPase(i));
  }

  private async respuestaGuardada(clave: string): Promise<Visita | undefined> {
    const r = await this.doc.send(new GetCommand({ TableName: this.tabla, Key: { PK: `IDEM#${clave}`, SK: 'META' } }));
    return r.Item?.respuesta as Visita | undefined;
  }

  private comoPase(i: Record<string, unknown>): Pase {
    const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, tipo: _t, ...pase } = i;
    return pase as unknown as Pase;
  }
}
