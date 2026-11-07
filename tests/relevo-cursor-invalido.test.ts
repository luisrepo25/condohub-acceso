import { describe, expect, it } from 'vitest';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { RelevoStream } from '@/infrastructure/messaging/relevo-stream';

type Orden = { constructor: { name: string }; input: Record<string, unknown> };

const SECUENCIA_VIEJA = '111111111111111111111';

function error(nombre: string, mensaje: string): Error {
  const e = new Error(mensaje);
  e.name = nombre;
  return e;
}

/** Un stream nuevo (tabla recreada o DynamoDB Local reiniciado) que no conoce el cursor guardado. */
function armar(falloDelCursor: Error | undefined) {
  const tiposPedidos: string[] = [];
  const publicados: string[] = [];
  const dynamo = {
    send: async (o: Orden) => ({ Table: { LatestStreamArn: 'arn:stream-nuevo' }, _: o }),
  } as unknown as DynamoDBClient;
  const doc = {
    send: async (o: Orden) => (o.constructor.name === 'GetCommand' ? { Item: { secuencia: SECUENCIA_VIEJA } } : {}),
  } as unknown as DynamoDBDocumentClient;
  const streams = {
    send: async (o: Orden) => {
      switch (o.constructor.name) {
        case 'DescribeStreamCommand':
          return { StreamDescription: { Shards: [{ ShardId: 'shard-1' }] } };
        case 'GetShardIteratorCommand': {
          const tipo = String(o.input.ShardIteratorType);
          tiposPedidos.push(tipo);
          if (tipo === 'AFTER_SEQUENCE_NUMBER' && falloDelCursor) throw falloDelCursor;
          return { ShardIterator: 'iterador' };
        }
        case 'GetRecordsCommand':
          return {
            Records: [
              {
                eventName: 'INSERT',
                dynamodb: {
                  SequenceNumber: '222',
                  NewImage: { tipo: { S: 'ComandoAtendido' }, routingKey: { S: 'acceso.PaseEmitido' }, mensaje: { S: JSON.stringify({ eventId: 'e-1' }) } },
                },
              },
            ],
          };
        default:
          return {};
      }
    },
  } as unknown as DynamoDBStreamsClient;
  const publicador = {
    publicar: async (routingKey: string) => {
      publicados.push(routingKey);
    },
  };
  return { relevo: new RelevoStream(dynamo, streams, doc, 'tabla', publicador), tiposPedidos, publicados };
}

describe('S4 relevo: un cursor que el stream no reconoce no lo traba', () => {
  it('S4 con un cursor de un stream anterior (Invalid SequenceNumber) lee desde el inicio y sigue publicando', async () => {
    const { relevo, tiposPedidos, publicados } = armar(error('ValidationException', 'Invalid SequenceNumber'));

    expect(await relevo.vuelta()).toBe(1);

    expect(tiposPedidos).toEqual(['AFTER_SEQUENCE_NUMBER', 'TRIM_HORIZON']);
    expect(publicados).toEqual(['acceso.PaseEmitido']);
  });

  it('S4 un error de validación que no es del cursor se sigue propagando', async () => {
    const { relevo } = armar(error('ValidationException', 'Invalid ShardId'));

    await expect(relevo.vuelta()).rejects.toThrow('Invalid ShardId');
  });

  it('S4 con un cursor válido no vuelve al inicio', async () => {
    const { relevo, tiposPedidos } = armar(undefined);

    await relevo.vuelta();

    expect(tiposPedidos).toEqual(['AFTER_SEQUENCE_NUMBER']);
  });
});
