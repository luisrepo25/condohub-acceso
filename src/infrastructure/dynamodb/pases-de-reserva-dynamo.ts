import { createHash } from 'node:crypto';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ComandoSaga, ComandosAtendidos, RespuestaSaga } from '@/application/ports/saga';
import type { Pase } from '@/domain/model/pase';
import { type DatosPasesDeReserva, PasesDeReserva } from '@/domain/model/pases-de-reserva';
import { type PasesDeReservaRepository, PasesDeReservaYaRegistrados } from '@/domain/ports/repositorios';
import { RepositorioDynamo } from './repositorio-dynamo';

/** S5: los comandos atendidos se recuerdan 7 días (TTL sobre `expiraEn`), más que cualquier reentrega de RabbitMQ. */
const DIAS_COMANDO_ATENDIDO = 7;

/**
 * Pases de los invitados de una reserva (paso 3 de la saga): `RESERVA#<id>` recuerda qué código recibió cada
 * invitado y cada pase es un `PASE#<codigo>` como el de una visita, en el índice de los pases del día (GSI1) para que
 * la app del guardia lo descargue. Ninguna escritura sobrescribe un pase: repetirlas no duplica ni revive nada.
 */
export class PasesDeReservaDynamo extends RepositorioDynamo implements PasesDeReservaRepository {
  async deLaReserva(reservaId: string): Promise<PasesDeReserva | null> {
    const item = await this.leer(`RESERVA#${reservaId}`);
    if (!item) return null;
    return PasesDeReserva.reconstituir({
      reservaId: String(item.reservaId),
      unidadCodigo: String(item.unidadCodigo ?? ''),
      fecha: String(item.fecha ?? ''),
      estado: item.estado === 'REVOCADA' ? 'REVOCADA' : 'EMITIDA',
      pases: Array.isArray(item.pases) ? (item.pases as DatosPasesDeReserva['pases']) : [],
    });
  }

  async registrar(pases: PasesDeReserva): Promise<void> {
    try {
      await this.doc.send(new PutCommand({ TableName: this.tabla, Item: this.itemReserva(pases), ConditionExpression: 'attribute_not_exists(PK)' }));
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) throw new PasesDeReservaYaRegistrados();
      throw e;
    }
  }

  async guardarPases(fecha: string, pases: Pase[]): Promise<void> {
    const ahora = new Date().toISOString();
    // Uno por uno: el salón admite 80 invitados y una transacción, 100 escrituras. Cada Put es condicional.
    for (const pase of pases) {
      const p = pase.datos;
      try {
        await this.doc.send(
          new PutCommand({
            TableName: this.tabla,
            Item: {
              PK: `PASE#${p.codigo}`, SK: 'META', tipo: 'Pase',
              codigo: p.codigo, unidadCodigo: p.unidadCodigo, estado: p.estado, usos: p.usos, usosMaximos: p.usosMaximos,
              validoDesde: p.validoDesde.toISOString(), validoHasta: p.validoHasta.toISOString(), origen: p.origen,
              reservaId: p.reservaId, invitadoId: p.invitadoId,
              GSI1PK: `PASES#${fecha}`, GSI1SK: `PASE#${p.codigo}`, actualizadoEn: ahora,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          }),
        );
      } catch (e) {
        if (!(e instanceof ConditionalCheckFailedException)) throw e;
      }
    }
  }

  async revocar(revocada: PasesDeReserva): Promise<number> {
    // Primero la reserva: si el proceso se corta, una emisión tardía ya no emite nada y la revocación se retoma.
    await this.doc.send(new PutCommand({ TableName: this.tabla, Item: this.itemReserva(revocada) }));
    let revocados = 0;
    for (const { codigo } of revocada.datos.pases) {
      try {
        await this.doc.send(
          new UpdateCommand({
            TableName: this.tabla,
            Key: { PK: `PASE#${codigo}`, SK: 'META' },
            UpdateExpression: 'SET estado = :revocado, actualizadoEn = :ahora',
            ConditionExpression: 'estado = :vigente',
            ExpressionAttributeValues: { ':revocado': 'REVOCADO', ':vigente': 'VIGENTE', ':ahora': new Date().toISOString() },
          }),
        );
        revocados++;
      } catch (e) {
        // Usado (A3), ya revocado o nunca guardado: no hay nada que revocar.
        if (!(e instanceof ConditionalCheckFailedException)) throw e;
      }
    }
    return revocados;
  }

  private itemReserva(pases: PasesDeReserva): Record<string, unknown> {
    const d = pases.datos;
    return {
      PK: `RESERVA#${d.reservaId}`, SK: 'META', tipo: 'PasesDeReserva',
      reservaId: d.reservaId, unidadCodigo: d.unidadCodigo, fecha: d.fecha, estado: d.estado,
      pases: d.pases.map((p) => ({ invitadoId: p.invitadoId, codigo: p.codigo })),
      actualizadoEn: new Date().toISOString(),
    };
  }
}

/**
 * S4, S5: `EVT#<eventId>` marca un comando de la saga como atendido y guarda, en la misma escritura, la respuesta con
 * el sobre de contracts/events. El relevo del stream de la tabla la publica (docs/datos/modelo-de-datos.md: DynamoDB
 * Streams equivale al outbox). El eventId de la respuesta se deriva del comando: una reentrega no crea otro distinto.
 */
export class ComandosAtendidosDynamo extends RepositorioDynamo implements ComandosAtendidos {
  async atendido(eventId: string): Promise<boolean> {
    return (await this.doc.send(new GetCommand({ TableName: this.tabla, Key: { PK: `EVT#${eventId}`, SK: 'META' }, ConsistentRead: true }))).Item !== undefined;
  }

  async marcar(comando: ComandoSaga, respuesta: RespuestaSaga): Promise<void> {
    const ahora = new Date();
    const mensaje = {
      eventId: idDerivado(`${respuesta.tipo}:${comando.eventId}`),
      type: respuesta.tipo,
      occurredAt: ahora.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      sagaId: comando.sagaId,
      version: 1,
      data: respuesta.data,
    };
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tabla,
          Item: {
            PK: `EVT#${comando.eventId}`, SK: 'META', tipo: 'ComandoAtendido',
            comando: comando.tipo, routingKey: respuesta.tipo, mensaje: JSON.stringify(mensaje), atendidoEn: ahora.toISOString(),
            expiraEn: Math.floor(ahora.getTime() / 1000) + DIAS_COMANDO_ATENDIDO * 86400,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    } catch (e) {
      // Otro proceso lo atendió a la vez: su respuesta ya quedó para publicar.
      if (!(e instanceof ConditionalCheckFailedException)) throw e;
    }
  }
}

/** UUID determinista (versión 3, MD5 de un nombre): el mismo criterio que usa Gestión para sus respuestas de la saga. */
export function idDerivado(nombre: string): string {
  const b = createHash('md5').update(nombre).digest();
  b[6] = (b[6]! & 0x0f) | 0x30;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
