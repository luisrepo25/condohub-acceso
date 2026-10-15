import { beforeAll, describe, expect, it } from 'vitest';
import { GET as salud } from '@/app/api/salud/route';
import { usarVerificador } from '@/infrastructure/http/proteger';
import { crearToken, ISSUER, peticion, verificadorDePrueba } from './helpers';

beforeAll(() => usarVerificador(verificadorDePrueba));

describe('autenticación con JWT de Keycloak', () => {
  it('sin token responde 401 en problem+json', async () => {
    const r = await salud(peticion('GET'));
    expect(r.status).toBe(401);
    expect(r.headers.get('content-type')).toContain('application/problem+json');
    expect(r.headers.get('www-authenticate')).toBe('Bearer');
  });

  it.each(['ADMIN', 'RESIDENTE', 'GUARDIA'])('token de %s ve la salud', async (rol) => {
    const r = await salud(peticion('GET', await crearToken([rol])));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ servicio: 'acceso', estado: 'OK' });
  });

  it('token firmado con otra clave es 401', async () => {
    expect((await salud(peticion('GET', await crearToken(['ADMIN'], { claveAjena: true })))).status).toBe(401);
  });

  it('token vencido es 401', async () => {
    expect((await salud(peticion('GET', await crearToken(['ADMIN'], { expiraEnSegundos: -60 })))).status).toBe(401);
  });

  it('token de otro emisor es 401', async () => {
    const t = await crearToken(['ADMIN'], { issuer: 'http://otro-realm/realms/x' });
    expect((await salud(peticion('GET', t))).status).toBe(401);
  });

  it('basura como token es 401', async () => {
    expect((await salud(peticion('GET', 'esto.no.es-un-jwt'))).status).toBe(401);
  });

  it('un rol que no es de CondoHub se ignora', async () => {
    const { POST } = await import('@/app/api/pases/validar/route');
    expect((await POST(peticion('POST', await crearToken(['superusuario'])))).status).toBe(403);
  });

  it('ISSUER del test es el del realm', () => expect(ISSUER).toContain('/realms/condohub'));
});