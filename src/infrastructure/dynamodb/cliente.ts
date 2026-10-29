import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export interface ConfigDynamo {
  readonly endpoint?: string;
  readonly region: string;
  readonly tabla: string;
}

export function configDynamoDesdeEntorno(): ConfigDynamo {
  return {
    endpoint: process.env.DYNAMODB_ENDPOINT,
    region: process.env.AWS_REGION ?? 'us-east-1',
    tabla: process.env.TABLA_ACCESO ?? 'condohub-acceso',
  };
}

/** Con `DYNAMODB_ENDPOINT` (DynamoDB Local) usa credenciales de relleno; en AWS, la cadena por defecto. */
export function crearClienteDynamo(c: ConfigDynamo): DynamoDBDocumentClient {
  const base = new DynamoDBClient({
    region: c.region,
    ...(c.endpoint ? { endpoint: c.endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}),
  });
  return DynamoDBDocumentClient.from(base, { marshallOptions: { removeUndefinedValues: true } });
}
