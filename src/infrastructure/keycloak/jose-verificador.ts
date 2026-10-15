import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ServicioDeIdentidadNoDisponible, TokenInvalido } from '@/application/errores';
import type { VerificadorToken } from '@/application/ports/verificador-token';
import { esRol, type Rol, type Solicitante } from '@/domain/model/rol';

/** Valida firma RS256, `exp` e `iss` de un JWT de Keycloak. Los roles salen de `realm_access.roles`. */
export class JoseVerificador implements VerificadorToken {
  constructor(
    private readonly issuer: string,
    private readonly claves: JWTVerifyGetKey,
  ) {}

  static desdeJwks(issuer: string, jwksUri: string): JoseVerificador {
    return new JoseVerificador(issuer, createRemoteJWKSet(new URL(jwksUri)));
  }

  async verificar(token: string): Promise<Solicitante> {
    try {
      const { payload } = await jwtVerify(token, this.claves, {
        issuer: this.issuer,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'iss', 'sub'],
      });
      const nombres = (payload.realm_access as { roles?: unknown } | undefined)?.roles;
      const roles = new Set<Rol>(
        Array.isArray(nombres) ? nombres.filter((n): n is string => typeof n === 'string').filter(esRol) : [],
      );
      return { sub: String(payload.sub), roles };
    } catch (e) {
      if (e instanceof errors.JWKSTimeout) throw new ServicioDeIdentidadNoDisponible(e.message);
      if (e instanceof TypeError) throw new ServicioDeIdentidadNoDisponible(e.message); // fetch falló
      throw new TokenInvalido(e instanceof Error ? e.message : 'token inválido');
    }
  }
}