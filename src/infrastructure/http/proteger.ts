import { exigirAlgunRol } from '@/application/autorizacion';
import { TokenInvalido } from '@/application/errores';
import type { VerificadorToken } from '@/application/ports/verificador-token';
import type { Rol, Solicitante } from '@/domain/model/rol';
import { configDesdeEntorno } from '@/infrastructure/config';
import { JoseVerificador } from '@/infrastructure/keycloak/jose-verificador';
import { desdeError } from './problemas';

let verificador: VerificadorToken | undefined;

/** Los tests inyectan un verificador con claves propias. */
export function usarVerificador(v: VerificadorToken | undefined): void {
  verificador = v;
}

function verificadorActual(): VerificadorToken {
  if (!verificador) {
    const c = configDesdeEntorno();
    verificador = JoseVerificador.desdeJwks(c.keycloakIssuer, c.keycloakJwks);
  }
  return verificador;
}

async function solicitanteDe(request: Request): Promise<Solicitante> {
  const cabecera = request.headers.get('authorization') ?? '';
  const [esquema, token] = cabecera.split(' ');
  if (esquema?.toLowerCase() !== 'bearer' || !token) throw new TokenInvalido('Falta el header Authorization: Bearer');
  return verificadorActual().verificar(token);
}

/** Envuelve un route handler: autentica (JWT de Keycloak), autoriza por rol y traduce errores a RFC 7807. */
export function proteger(
  permitidos: Rol[] | 'cualquiera',
  manejador: (request: Request, solicitante: Solicitante) => Promise<Response> | Response,
) {
  return async (request: Request): Promise<Response> => {
    try {
      const solicitante = await solicitanteDe(request);
      if (permitidos !== 'cualquiera') exigirAlgunRol(solicitante, ...permitidos);
      return await manejador(request, solicitante);
    } catch (e) {
      return desdeError(e);
    }
  };
}