export function configDesdeEntorno() {
  const issuer = process.env.KEYCLOAK_ISSUER ?? 'http://localhost:8180/realms/condohub';
  return {
    keycloakIssuer: issuer,
    keycloakJwks: process.env.KEYCLOAK_JWKS ?? `${issuer}/protocol/openid-connect/certs`,
  };
}