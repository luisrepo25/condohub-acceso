import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, TransactWriteCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { OpcionesGuardado, RegistroAccesoRepositorio, ResultadoGuardado } from '@/application/ports/registro-acceso-repositorio';
import { ReglaViolada } from '@/domain/errores';
import { motivoPaseNoUsable, type MotivoPaseNoUsable, type Pase } from '@/domain/model/pase';
import type { RegistroAcceso } from '@/domain/model/registro-acceso';

const SIETE_DIAS = 7 * 24 * 3600;

const MENSAJE_PASE: Record<MotivoPaseNoUsable, string> = {
  NO_EXISTE: 'El pase no existe',
  REVOCADO: 'El pase fue revocado',
  USADO: 'El pase ya fue usado',
  VENCIDO: 'El pase está fuera de su ventana de validez',
  AUN_NO_VALIDO: 'El pase todavía no es válido: su ventana no ha empezado',
};

/** DynamoDB no conserva el orden de los campos: se ordenan para que la respuesta repetida sea idéntica a la primera (O3). */
function ordenado(r: RegistroAcceso): RegistroAcceso {
  return Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b))) as unknown as RegistroAcceso;
}

type Escritura = NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']>[number];

/** Registros de acceso en la tabla única `condohub-acceso` (ver docs/datos/modelo-de-datos.md). */
export class RegistroAccesoDynamo implements RegistroAccesoRepositorio {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tabla: string,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async guardar(registro: RegistroAcceso, clave: string, opciones: OpcionesGuardado = {}): Promise<ResultadoGuardado> {
    const previo = await this.respuestaGuardada(clave);
    if (previo) return { creado: false, respuesta: ordenado(previo) };

    const usaPase = registro.sentido === 'INGRESO' && registro.resultado === 'PERMITIDO' && !opciones.sinConsumirPase;
    const pase = usaPase ? registro.paseCodigo : undefined;
    if (pase) await this.exigirPaseUsable(pase, opciones.instante ?? this.reloj());
    try {
      await this.doc.send(new TransactWriteCommand({ TransactItems: this.escrituras(registro, clave, pase) }));
      return { creado: true, respuesta: ordenado(registro) };
    } catch (e) {
      return this.resolverCancelacion(e, clave);
    }
  }

  private escrituras(registro: RegistroAcceso, clave: string, pase: string | undefined): Escritura[] {
    const items: Escritura[] = [
      { Put: { TableName: this.tabla, Item: this.itemIdempotencia(registro, clave), ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: this.tabla, Item: this.itemRegistro(registro), ConditionExpression: 'attribute_not_exists(PK)' } },
    ];
    if (pase) items.push(this.consumirPase(pase, registro.horaServidor));
    return items;
  }

  private itemIdempotencia(registro: RegistroAcceso, clave: string) {
    return {
      PK: `IDEM#${clave}`, SK: 'META', tipo: 'Idempotencia', respuesta: registro, codigoHttp: 201,
      expiraEn: Math.floor(Date.parse(registro.horaServidor) / 1000) + SIETE_DIAS,
    };
  }

  private itemRegistro(registro: RegistroAcceso) {
    const ts = registro.horaServidor;
    return {
      PK: `DIA#${ts.slice(0, 10)}`, SK: `ACCESO#${ts}#${registro.registroId}`, tipo: 'RegistroAcceso', ...registro,
      ...(registro.unidadCodigo ? { GSI2PK: `UNIDAD#${registro.unidadCodigo}`, GSI2SK: `ACCESO#${ts}` } : {}),
    };
  }

  /** A1: el único uso se consume con una escritura condicional, así dos guardias no lo usan dos veces. */
  private consumirPase(codigo: string, ahora: string): Escritura {
    return {
      Update: {
        TableName: this.tabla, Key: { PK: `PASE#${codigo}`, SK: 'META' },
        UpdateExpression: 'SET usos = usos + :uno, estado = :usado, actualizadoEn = :ahora',
        ConditionExpression: 'estado = :vigente AND usos < usosMaximos',
        ExpressionAttributeValues: { ':uno': 1, ':usado': 'USADO', ':vigente': 'VIGENTE', ':ahora': ahora },
      },
    };
  }

  private async respuestaGuardada(clave: string): Promise<RegistroAcceso | undefined> {
    const r = await this.doc.send(new GetCommand({ TableName: this.tabla, Key: { PK: `IDEM#${clave}`, SK: 'META' } }));
    return r.Item?.respuesta as RegistroAcceso | undefined;
  }

  private async exigirPaseUsable(codigo: string, instante: Date): Promise<void> {
    const r = await this.doc.send(new GetCommand({ TableName: this.tabla, Key: { PK: `PASE#${codigo}`, SK: 'META' } }));
    const motivo = motivoPaseNoUsable(r.Item as Pase | undefined, instante);
    if (motivo) throw new ReglaViolada('A2', MENSAJE_PASE[motivo]);
  }

  /** La transacción se cancela si otro proceso ganó la clave (O3) o gastó el pase entre la lectura y la escritura. */
  private async resolverCancelacion(e: unknown, clave: string): Promise<ResultadoGuardado> {
    if (!(e instanceof TransactionCanceledException)) throw e;
    const motivos = e.CancellationReasons ?? [];
    if (motivos[0]?.Code === 'ConditionalCheckFailed') {
      const previo = await this.respuestaGuardada(clave);
      if (previo) return { creado: false, respuesta: ordenado(previo) };
    }
    if (motivos[2]?.Code === 'ConditionalCheckFailed') throw new ReglaViolada('A2', MENSAJE_PASE.USADO);
    throw e;
  }
}
