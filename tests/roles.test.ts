// Matriz rol × endpoint. Permitido ⇒ llega a la lógica (ni 401 ni 403); no permitido ⇒ 403; sin token ⇒ 401.
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as accesos } from '@/app/api/accesos/route';
import { GET as alertas } from '@/app/api/alertas/route';
import { GET as pasesGuardia } from '@/app/api/pases/guardia/route';
import { POST as pasesValidar } from '@/app/api/pases/validar/route';
import { POST as sync } from '@/app/api/sync/route';
import { POST as visitas } from '@/app/api/visitas/route';
import { usarVerificador } from '@/infrastructure/http/proteger';
import { crearToken, peticion, verificadorDePrueba } from './helpers';

beforeAll(() => usarVerificador(verificadorDePrueba));

type Manejador = (r: Request) => Promise<Response>;
const portero = ['GUARDIA', 'ADMIN'];
const casos: Array<{ nombre: string; metodo: string; manejador: Manejador; permitidos: string[] }> = [
  { nombre: 'A1_registrar_visita', metodo: 'POST', manejador: visitas, permitidos: ['RESIDENTE', 'ADMIN'] },
  { nombre: 'A2_validar_pase', metodo: 'POST', manejador: pasesValidar, permitidos: portero },
  { nombre: 'O6_pases_vigentes_para_la_pwa', metodo: 'GET', manejador: pasesGuardia, permitidos: portero },
  { nombre: 'A3_registrar_acceso', metodo: 'POST', manejador: accesos, permitidos: portero },
  { nombre: 'O3_sincronizar_lote_offline', metodo: 'POST', manejador: sync, permitidos: portero },
  { nombre: 'I4_alertas', metodo: 'GET', manejador: alertas, permitidos: portero },
];

describe.each(casos)('$nombre', ({ metodo, manejador, permitidos }) => {
  it('sin token es 401', async () => {
    expect((await manejador(peticion(metodo))).status).toBe(401);
  });

  it.each(['ADMIN', 'RESIDENTE', 'GUARDIA'])('rol %s', async (rol) => {
    const r = await manejador(peticion(metodo, await crearToken([rol])));
    if (permitidos.includes(rol)) {
      expect([401, 403]).not.toContain(r.status);
    } else {
      expect(r.status).toBe(403);
      expect(r.headers.get('content-type')).toContain('application/problem+json');
    }
  });
});