// Tabla temporal de DynamoDB Local para las pruebas (la misma definición que db/tabla-acceso.json, con otro nombre):
// cada ejecución usa la suya y la borra al final, así nunca toca los datos de desarrollo.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient, waitUntilTableExists } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';

export async function crearTablaDePrueba() {
  const cliente = new DynamoDBClient({ endpoint: ENDPOINT, region: 'us-east-1', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } });
  const tabla = `condohub-acceso-prueba-${randomUUID().slice(0, 8)}`;
  const definicion = JSON.parse(readFileSync(new URL('../db/tabla-acceso.json', import.meta.url), 'utf8'));
  try {
    await cliente.send(new CreateTableCommand({ ...definicion, TableName: tabla, StreamSpecification: undefined }));
  } catch (e) {
    throw new Error(`Las pruebas de Acceso necesitan DynamoDB Local en ${ENDPOINT} (docker compose up dynamodb): ${(e as Error).message}`);
  }
  await waitUntilTableExists({ client: cliente, maxWaitTime: 30 }, { TableName: tabla });
  const doc = DynamoDBDocumentClient.from(cliente, { marshallOptions: { removeUndefinedValues: true } });
  return {
    tabla,
    doc,
    poner: (item: Record<string, unknown>) => doc.send(new PutCommand({ TableName: tabla, Item: item })),
    borrar: () => cliente.send(new DeleteTableCommand({ TableName: tabla })),
  };
}
