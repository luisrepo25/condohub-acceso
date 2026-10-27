export function configDesdeEntorno() {
  const issuer = process.env.KEYCLOAK_ISSUER ?? 'http://localhost:8180/realms/condohub';
  return {
    keycloakIssuer: issuer,
    keycloakJwks: process.env.KEYCLOAK_JWKS ?? `${issuer}/protocol/openid-connect/certs`,
    // DynamoDB (Local en desarrollo: http://localhost:8000; en Docker: http://dynamodb:8000)
    dynamoEndpoint: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
    dynamoRegion: process.env.AWS_REGION ?? 'us-east-1',
    dynamoTabla: process.env.DYNAMODB_TABLA ?? 'condohub-acceso',
    // Gestión (F1: unidades del residente), por el gateway. En Docker: http://gateway:8000/gestion/graphql
    gestionGraphqlUrl: process.env.GESTION_GRAPHQL_URL ?? 'http://localhost:8080/gestion/graphql',
    gestionTimeoutMs: Number(process.env.GESTION_TIMEOUT_MS ?? 5000),
    // Servicio IA (I4: visitantes recurrentes), por el gateway. En Docker: http://gateway:8000/ia
    iaUrl: process.env.IA_URL ?? 'http://localhost:8080/ia',
    iaTimeoutMs: Number(process.env.IA_TIMEOUT_MS ?? 5000),
    // Parámetros de negocio (A1, A4)
    zonaHoraria: process.env.CONDOMINIO_ZONA_HORARIA ?? 'America/La_Paz',
    ventanaDesde: process.env.PASE_VENTANA_DESDE ?? '07:00:00',
    ventanaHasta: process.env.PASE_VENTANA_HASTA ?? '23:59:59',
    confianzaPlacaMinima: Number(process.env.PLACA_CONFIANZA_MINIMA ?? 0.85),
  };
}
