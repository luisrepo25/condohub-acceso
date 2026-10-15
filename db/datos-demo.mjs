// Datos de demostración de Acceso (solo dev): placas de residentes, una visita con pase y un ingreso.
// Uso: DYNAMODB_ENDPOINT=http://localhost:8000 node db/datos-demo.mjs   (npm run db:demo)
// Las escrituras usan el mismo patrón idempotente que la API (O3), así que correrlo dos veces no duplica.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLA = 'condohub-acceso';
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
}));

const siNoExiste = async (item) => {
  try {
    await doc.send(new PutCommand({ TableName: TABLA, Item: item, ConditionExpression: 'attribute_not_exists(PK)' }));
  } catch (e) {
    if (e.name !== 'ConditionalCheckFailedException') throw e;
  }
};

// A4: placas registradas de residentes (bloque A, 1 vehículo por casa)
for (let n = 1; n <= 50; n++) {
  const placa = `${String(1000 + n)}ABC`;
  await siNoExiste({
    PK: `PLACA#${placa}`, SK: 'META', tipo: 'Vehiculo',
    placa, unidadCodigo: `A-${100 + n}`, activa: true,
    GSI1PK: `UNIDAD#A-${100 + n}`, GSI1SK: `PLACA#${placa}`,
  });
}

// A1: visita de A-101 con pase QR para hoy
const hoy = new Date().toISOString().slice(0, 10);
const visitaId = 'demo-visita-0001';
const codigo = 'QR-DEMO-0001';
await siNoExiste({
  PK: 'UNIDAD#A-101', SK: `VISITA#${hoy}#${visitaId}`, tipo: 'Visita',
  visitaId, nombre: 'Visita Demo', documento: 'CI-999', registradaPor: '00000000-0000-0000-0000-00000000a002',
  creadaEn: new Date().toISOString(),
});
await siNoExiste({
  PK: `PASE#${codigo}`, SK: 'META', tipo: 'Pase',
  codigo, visitaId, unidadCodigo: 'A-101', estado: 'VIGENTE', usos: 0, usosMaximos: 1,
  validoDesde: `${hoy}T07:00:00-04:00`, validoHasta: `${hoy}T23:59:59-04:00`, origen: 'VISITA',
  GSI1PK: `PASES#${hoy}`, GSI1SK: `PASE#${codigo}`,
});

// A3 + O3: un ingreso registrado de forma idempotente
const idem = '6f1c2a0e-0000-4000-8000-000000000001';
const ts = `${hoy}T09:15:00.000Z`;
const respuesta = { registroId: 'demo-acceso-0001', resultado: 'PERMITIDO' };
try {
  await doc.send(new TransactWriteCommand({
    TransactItems: [
      { Put: {
          TableName: TABLA,
          Item: { PK: `IDEM#${idem}`, SK: 'META', tipo: 'Idempotencia', respuesta, codigoHttp: 201,
                  expiraEn: Math.floor(Date.now() / 1000) + 7 * 86400 },
          ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: {
          TableName: TABLA,
          Item: { PK: `DIA#${hoy}`, SK: `ACCESO#${ts}#demo-acceso-0001`, tipo: 'RegistroAcceso',
                  registroId: 'demo-acceso-0001', sentido: 'INGRESO', categoria: 'VEHICULO', placa: '1001ABC',
                  confianzaPlaca: 0.93, unidadCodigo: 'A-101', resultado: 'PERMITIDO', guardiaSub: '00000000-0000-0000-0000-00000000a003',
                  horaDispositivo: ts, horaServidor: new Date().toISOString(), idempotencyKey: idem,
                  GSI2PK: 'UNIDAD#A-101', GSI2SK: `ACCESO#${ts}` } } },
    ],
  }));
} catch (e) {
  if (e.name !== 'TransactionCanceledException') throw e;  // ya existía: misma respuesta, sin duplicar
}
console.log('Datos demo de Acceso listos');
