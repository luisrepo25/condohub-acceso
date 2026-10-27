import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { type EstadoGuardado, Pase } from '@/domain/model/pase';
import type { RegistroAcceso } from '@/domain/model/registro-acceso';
import type { Visita } from '@/domain/model/visita';
import type {
  PaseRepository,
  RegistroAccesoRepository,
  RespuestaGuardada,
  RespuestasIdempotentes,
  VehiculoRepository,
  VisitaRepository,
} from '@/domain/ports/repositorios';
import type { VehiculoRegistrado } from '@/domain/services/politica-placas';
import { fechaLocal } from '@/domain/value-objects/hora-local';
import { type Escritura, RepositorioDynamo } from './repositorio-dynamo';

export class RespuestasDynamo extends RepositorioDynamo implements RespuestasIdempotentes {
  async buscar(clave: string): Promise<RespuestaGuardada | null> {
    const item = await this.leer(`IDEM#${clave}`);
    if (!item) return null;
    return { clave, sub: String(item.sub ?? ''), codigoHttp: Number(item.codigoHttp), cuerpo: item.respuesta };
  }
}

/** Visita (`UNIDAD#<codigo>` / `VISITA#<fecha>#<id>`) y su pase (`PASE#<codigo>`), en la misma transacción. */
export class VisitasDynamo extends RepositorioDynamo implements VisitaRepository {
  async registrar(visita: Visita, respuesta: RespuestaGuardada): Promise<void> {
    const v = visita.datos;
    const p = visita.pase.datos;
    await this.transaccion([
      this.idempotencia(respuesta),
      this.nuevo({
        PK: `UNIDAD#${v.unidadCodigo}`, SK: `VISITA#${v.fecha}#${v.visitaId}`, tipo: 'Visita',
        visitaId: v.visitaId, unidadCodigo: v.unidadCodigo, nombre: v.nombre, documento: v.documento, fecha: v.fecha,
        registradaPor: v.registradaPor, creadaEn: v.creadaEn.toISOString(),
      }),
      this.nuevo({
        PK: `PASE#${p.codigo}`, SK: 'META', tipo: 'Pase',
        codigo: p.codigo, visitaId: p.visitaId, unidadCodigo: p.unidadCodigo, estado: p.estado, usos: p.usos,
        usosMaximos: p.usosMaximos, validoDesde: p.validoDesde.toISOString(), validoHasta: p.validoHasta.toISOString(),
        origen: p.origen,
        // Pases del día para la PWA del guardia (GET /api/pases/guardia)
        GSI1PK: `PASES#${v.fecha}`, GSI1SK: `PASE#${p.codigo}`,
      }),
    ]);
  }
}

export class PasesDynamo extends RepositorioDynamo implements PaseRepository {
  async porCodigo(codigo: string): Promise<Pase | null> {
    const item = await this.leer(`PASE#${codigo}`);
    if (!item) return null;
    return Pase.reconstituir({
      codigo: String(item.codigo),
      visitaId: item.visitaId === undefined ? undefined : String(item.visitaId),
      unidadCodigo: String(item.unidadCodigo),
      estado: String(item.estado) as EstadoGuardado,
      usos: Number(item.usos),
      usosMaximos: Number(item.usosMaximos),
      validoDesde: new Date(String(item.validoDesde)),
      validoHasta: new Date(String(item.validoHasta)),
      origen: item.origen === 'RESERVA' ? 'RESERVA' : 'VISITA',
    });
  }
}

export class VehiculosDynamo extends RepositorioDynamo implements VehiculoRepository {
  async porPlaca(placa: string): Promise<VehiculoRegistrado | null> {
    const item = await this.leer(`PLACA#${placa}`);
    if (!item) return null;
    return { placa: String(item.placa), unidadCodigo: String(item.unidadCodigo), activa: item.activa === true };
  }
}

/**
 * Registros de acceso (`DIA#<fecha local>` / `ACCESO#<hora servidor>#<id>`), solo se agregan (A3). Con un puntero
 * `REGISTRO#<id>` para encontrarlos por id (correcciones) y, si es un ingreso con pase, el consumo condicional del pase.
 */
export class RegistrosDynamo extends RepositorioDynamo implements RegistroAccesoRepository {
  constructor(
    doc: DynamoDBDocumentClient,
    tabla: string,
    private readonly zonaHoraria: string,
  ) {
    super(doc, tabla);
  }

  async existe(registroId: string): Promise<boolean> {
    return (await this.leer(`REGISTRO#${registroId}`)) !== null;
  }

  async registrar(registro: RegistroAcceso, respuesta: RespuestaGuardada, consumo?: { antes: Pase; despues: Pase }): Promise<void> {
    const r = registro.datos;
    const hora = r.horaServidor.toISOString();
    const dia = fechaLocal(r.horaServidor, this.zonaHoraria);
    const sk = `ACCESO#${hora}#${r.registroId}`;
    const escrituras: Escritura[] = [
      this.idempotencia(respuesta),
      this.nuevo({
        PK: `DIA#${dia}`, SK: sk, tipo: 'RegistroAcceso',
        registroId: r.registroId, sentido: r.sentido, categoria: r.categoria, unidadCodigo: r.unidadCodigo,
        paseCodigo: r.paseCodigo, placa: r.placa, confianzaPlaca: r.confianzaPlaca, resultado: r.resultado,
        motivo: r.motivo, corrigeA: r.corrigeA, guardiaSub: r.guardiaSub,
        horaDispositivo: r.horaDispositivo.toISOString(), horaServidor: hora, idempotencyKey: respuesta.clave,
        ...(r.unidadCodigo ? { GSI2PK: `UNIDAD#${r.unidadCodigo}`, GSI2SK: `ACCESO#${hora}` } : {}),
      }),
      this.nuevo({ PK: `REGISTRO#${r.registroId}`, SK: 'META', tipo: 'PunteroRegistro', dia, sk }),
    ];
    if (consumo) escrituras.push(this.consumirPase(consumo.antes, consumo.despues));
    await this.transaccion(escrituras, consumo ? escrituras.length - 1 : undefined);
  }

  /** A1/A2: el pase se consume solo si nadie lo cambió desde que se leyó (otro guardia, una revocación). */
  private consumirPase(antes: Pase, despues: Pase): Escritura {
    return {
      Update: {
        TableName: this.tabla,
        Key: { PK: `PASE#${antes.codigo}`, SK: 'META' },
        UpdateExpression: 'SET usos = :usosNuevos, estado = :estadoNuevo',
        ConditionExpression: 'usos = :usosAntes AND estado = :estadoAntes',
        ExpressionAttributeValues: {
          ':usosNuevos': despues.datos.usos,
          ':estadoNuevo': despues.datos.estado,
          ':usosAntes': antes.datos.usos,
          ':estadoAntes': antes.datos.estado,
        },
      },
    };
  }
}
