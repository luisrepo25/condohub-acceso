import { generateKeyPair, SignJWT } from 'jose';
import { JoseVerificador } from '@/infrastructure/keycloak/jose-verificador';

export const ISSUER = 'http://localhost:8180/realms/condohub';

const { privateKey, publicKey } = await generateKeyPair('RS256');
const ajena = await generateKeyPair('RS256');

export const verificadorDePrueba = new JoseVerificador(ISSUER, async () => publicKey);

interface Opciones {
  sub?: string;
  issuer?: string;
  expiraEnSegundos?: number;
  claveAjena?: boolean;
}

/** Firma un token como lo haría Keycloak (RS256, `realm_access.roles`, `iss`, `exp`). */
export async function crearToken(roles: string[], o: Opciones = {}): Promise<string> {
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT({ realm_access: { roles: [...roles, 'offline_access'] } })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(o.sub ?? '00000000-0000-0000-0000-00000000a001')
    .setIssuer(o.issuer ?? ISSUER)
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + (o.expiraEnSegundos ?? 900))
    .sign(o.claveAjena ? ajena.privateKey : privateKey);
}

export function peticion(metodo: string, token?: string): Request {
  return new Request('http://localhost/api', {
    method: metodo,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}