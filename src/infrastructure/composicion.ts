import { randomBytes, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { DepsRegistrarAcceso } from '@/application/casos/registrar-acceso';
import type { DepsRegistrarVisita } from '@/application/casos/registrar-visita';
import type { DepsValidarPase } from '@/application/casos/validar-pase';
import { configDesdeEntorno } from './config';
import { PasesDynamo, RegistrosDynamo, RespuestasDynamo, VehiculosDynamo, VisitasDynamo } from './dynamodb/repositorios';
import { UnidadesGraphql } from './gestion/unidades-graphql';

export type Dependencias = DepsRegistrarVisita & DepsValidarPase & DepsRegistrarAcceso;

let actuales: Dependencias | undefined;

/** Único lugar donde se conectan los puertos con su infraestructura (se crea una vez por proceso). */
export function dependencias(): Dependencias {
  actuales ??= crear();
  return actuales;
}

/** Los tests reemplazan piezas (reloj, Gestión, tabla de prueba). `undefined` vuelve a las reales. */
export function usarDependencias(reemplazos: Partial<Dependencias> | undefined): void {
  actuales = reemplazos ? { ...crear(), ...reemplazos } : undefined;
}

function crear(): Dependencias {
  const c = configDesdeEntorno();
  const doc = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      endpoint: c.dynamoEndpoint,
      region: c.dynamoRegion,
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local' },
    }),
    { marshallOptions: { removeUndefinedValues: true } },
  );
  return {
    visitas: new VisitasDynamo(doc, c.dynamoTabla),
    pases: new PasesDynamo(doc, c.dynamoTabla),
    registros: new RegistrosDynamo(doc, c.dynamoTabla, c.zonaHoraria),
    vehiculos: new VehiculosDynamo(doc, c.dynamoTabla),
    respuestas: new RespuestasDynamo(doc, c.dynamoTabla),
    unidades: new UnidadesGraphql(c.gestionGraphqlUrl, c.gestionTimeoutMs),
    reloj: { ahora: () => new Date() },
    // El código del pase es la credencial del QR: 128 bits aleatorios, imposible de adivinar.
    ids: { id: () => randomUUID(), codigoPase: () => `QR-${randomBytes(16).toString('base64url')}` },
    parametros: {
      zonaHoraria: c.zonaHoraria,
      ventanaDesde: c.ventanaDesde,
      ventanaHasta: c.ventanaHasta,
      confianzaPlacaMinima: c.confianzaPlacaMinima,
    },
  };
}
