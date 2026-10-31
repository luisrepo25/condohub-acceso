// Capa anticorrupción Acceso ← IA (DDD): Acceso obtiene los clústeres de la IA y los traduce a SUS conceptos (`Alerta`).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GET as alertas } from '@/app/api/alertas/route';
import { ListarAlertas } from '@/application/listar-alertas';
import type { FuenteAlertas } from '@/application/ports/alertas';
import { IaNoDisponible } from '@/application/servicio-no-disponible';
import type { AlertaVisitante } from '@/domain/model/alerta';
import { usarCasosDeUso, type CasosDeUso } from '@/infrastructure/composicion';
import { usarVerificador } from '@/infrastructure/http/proteger';
import { AlertasIa } from '@/infrastructure/ia/alertas-ia';
import { crearToken, peticion, verificadorDePrueba } from './helpers';

const responder = (cuerpo: unknown, status = 200) => (async () => new Response(JSON.stringify(cuerpo), { status })) as unknown as typeof fetch;
const clusterIa = { clusterId: 'v-1', apariciones: 10, diasDistintos: 2, ultimaVez: '2026-10-22T01:00:00Z', alertadoEn: '2026-10-22T01:50:00Z' };

describe('AlertasIa (la traducción)', () => {
  it('I4_pide_a_la_IA_con_el_token_del_guardia_y_traduce_a_alertas_de_Acceso', async () => {
    let recibida: { url: string; init?: RequestInit } | undefined;
    const http = (async (url: string, init?: RequestInit) => {
      recibida = { url, init };
      return new Response(JSON.stringify([clusterIa]));
    }) as unknown as typeof fetch;

    const resultado = await new AlertasIa('http://ia', 1000, http).visitantesRecurrentes('jwt-guardia');

    expect(recibida?.url).toBe('http://ia/rostros/visitantes-recurrentes');
    expect((recibida?.init?.headers as Record<string, string>).authorization).toBe('Bearer jwt-guardia');
    expect(resultado).toEqual([
      { id: 'v-1', tipo: 'VISITANTE_RECURRENTE', clusterId: 'v-1', apariciones: 10, diasDistintos: 2, creadaEn: '2026-10-22T01:50:00Z' },
    ]);
  });

  it('I4_si_el_cluster_aun_no_genero_aviso_la_fecha_es_la_ultima_vez_que_aparecio', async () => {
    const { alertadoEn: _omitido, ...sinAviso } = clusterIa;

    const [alerta] = await new AlertasIa('http://ia', 1000, responder([sinAviso])).visitantesRecurrentes('t');

    expect(alerta?.creadaEn).toBe('2026-10-22T01:00:00Z');
  });

  it('I1_I6_la_alerta_de_Acceso_no_lleva_embeddings_ni_fotos_aunque_la_IA_los_mandara', async () => {
    const conExtras = { ...clusterIa, embedding: [0.1, 0.2], foto: 'http://x/foto.jpg' };

    const [alerta] = await new AlertasIa('http://ia', 1000, responder([conExtras])).visitantesRecurrentes('t');

    expect(Object.keys(alerta as object).sort()).toEqual(['apariciones', 'clusterId', 'creadaEn', 'diasDistintos', 'id', 'tipo']);
  });

  it.each([
    ['sin conexion', (async () => Promise.reject(new TypeError('red'))) as unknown as typeof fetch],
    ['HTTP 503', responder({}, 503)],
    ['no es una lista', responder({ clusters: [] })],
    ['elemento fuera de contrato', responder([{ clusterId: 'v-1' }])],
  ])('un fallo de la IA (%s) es IaNoDisponible y nunca se inventan alertas', async (_caso, http) => {
    await expect(new AlertasIa('http://ia', 1000, http).visitantesRecurrentes('t')).rejects.toBeInstanceOf(IaNoDisponible);
  });
});

describe('ListarAlertas', () => {
  const alerta = (id: string, creadaEn: string): AlertaVisitante => ({ id, tipo: 'VISITANTE_RECURRENTE', clusterId: id, apariciones: 3, diasDistintos: 3, creadaEn });
  const fuente = (lista: AlertaVisitante[]): FuenteAlertas => ({ visitantesRecurrentes: async () => lista });

  it('I4_salen_de_la_mas_reciente_a_la_mas_antigua', async () => {
    const r = await new ListarAlertas(fuente([alerta('a', '2026-10-20T10:00:00Z'), alerta('c', '2026-10-22T10:00:00Z'), alerta('b', '2026-10-21T10:00:00Z')])).ejecutar('t');

    expect(r.map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });

  it('el_filtro_desde_deja_solo_las_alertas_creadas_desde_ese_momento', async () => {
    const lista = [alerta('a', '2026-10-20T10:00:00Z'), alerta('b', '2026-10-22T10:00:00Z')];

    expect((await new ListarAlertas(fuente(lista)).ejecutar('t', '2026-10-21T00:00:00Z')).map((x) => x.id)).toEqual(['b']);
  });

  it('un desde que no es una fecha es un dato invalido (400)', async () => {
    await expect(new ListarAlertas(fuente([])).ejecutar('t', 'ayer')).rejects.toThrow(/desde/);
  });
});

describe('GET /api/alertas', () => {
  beforeAll(() => usarVerificador(verificadorDePrueba));
  afterEach(() => usarCasosDeUso(undefined));
  const conFuente = (f: FuenteAlertas) => usarCasosDeUso({ listarAlertas: new ListarAlertas(f) } as unknown as CasosDeUso);

  it('I4_el_guardia_recibe_las_alertas_traducidas', async () => {
    conFuente({ visitantesRecurrentes: async () => [{ id: 'v-1', tipo: 'VISITANTE_RECURRENTE', clusterId: 'v-1', apariciones: 10, diasDistintos: 2, creadaEn: '2026-10-22T01:50:00Z' }] });

    const r = await alertas(peticion('GET', await crearToken(['GUARDIA'])));

    expect(r.status).toBe(200);
    expect(await r.json()).toHaveLength(1);
  });

  it('el_token_del_guardia_es_el_que_se_reenvia_a_la_IA', async () => {
    let recibido = '';
    conFuente({ visitantesRecurrentes: async (credencial) => { recibido = credencial; return []; } });
    const token = await crearToken(['GUARDIA']);

    await alertas(peticion('GET', token));

    expect(recibido).toBe(token);
  });

  it('si_la_IA_no_responde_es_503_y_dice_que_es_la_IA_no_Gestion', async () => {
    conFuente({ visitantesRecurrentes: async () => { throw new IaNoDisponible('IA no respondió'); } });

    const r = await alertas(peticion('GET', await crearToken(['GUARDIA'])));

    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).toContain('Servicio IA');
  });

  it('un_residente_no_ve_alertas_de_portería', async () => {
    conFuente({ visitantesRecurrentes: async () => [] });

    expect((await alertas(peticion('GET', await crearToken(['RESIDENTE'])))).status).toBe(403);
  });
});
