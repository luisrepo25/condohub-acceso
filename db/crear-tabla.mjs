// Crea la tabla única de Acceso en DynamoDB (Local en dev) y activa el TTL.
// Uso: DYNAMODB_ENDPOINT=http://localhost:8000 node db/crear-tabla.mjs   (npm run db:crear)
import { readFile } from 'node:fs/promises';
import {
  DynamoDBClient,
  CreateTableCommand,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
  },
});

const definicion = JSON.parse(await readFile(new URL('./tabla-acceso.json', import.meta.url), 'utf8'));

try {
  await client.send(new CreateTableCommand(definicion));
  await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: definicion.TableName });
  console.log(`Tabla ${definicion.TableName} creada`);
} catch (e) {
  if (e.name !== 'ResourceInUseException') throw e;
  console.log(`Tabla ${definicion.TableName} ya existía`);
}

// I3/O3: las claves de idempotencia y eventos procesados expiran solos (atributo expiraEn, epoch en segundos)
await client.send(new UpdateTimeToLiveCommand({
  TableName: definicion.TableName,
  TimeToLiveSpecification: { Enabled: true, AttributeName: 'expiraEn' },
}));
console.log('TTL activo sobre expiraEn');
