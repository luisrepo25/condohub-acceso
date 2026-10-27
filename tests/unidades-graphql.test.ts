// Adaptador de Gestión (F1) con un fetch simulado: qué envía y cómo traduce cada respuesta del contrato GraphQL.
import { describe, expect, it } from 'vitest';
import { GestionNoDisponible, TokenInvalido } from '@/application/errores';
import { UnidadesGraphql } from '@/infrastructure/gestion/unidades-graphql';

const URL_GESTION = 'http://gateway.prueba/gestion/graphql';

function gestionQueResponde(...respuestas: Array<Response | Error>) {
  const enviadas: RequestInit[] = [];
  const fetchFalso = (async (_url: string, init: RequestInit) => {
    enviadas.push(init);
    const r = respuestas.shift();
    if (!r || r instanceof Error) throw r ?? new Error('sin respuesta');
    return r;
  }) as unknown as typeof fetch;
  return { adaptador: new UnidadesGraphql(URL_GESTION, 1000, fetchFalso), enviadas };
}

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

describe('unidades del solicitante en Gestión (F1)', () => {
  it('F1 pide miPerfil con el token del usuario y devuelve los códigos en mayúsculas', async () => {
    const { adaptador, enviadas } = gestionQueResponde(json({ data: { miPerfil: { unidades: [{ codigo: 'a-101' }, { codigo: 'B-202' }] } } }));

    expect(await adaptador.codigos('token-del-residente')).toEqual(['A-101', 'B-202']);
    expect((enviadas[0]!.headers as Record<string, string>).authorization).toBe('Bearer token-del-residente');
    expect(String(enviadas[0]!.body)).toContain('miPerfil { unidades { codigo } }');
  });

  it('F1 una cuenta sin unidades no tiene unidades', async () => {
    expect(await gestionQueResponde(json({ data: { miPerfil: { unidades: [] } } })).adaptador.codigos('t')).toEqual([]);
  });

  it('un 401 de Gestión es un token inválido', async () => {
    await expect(gestionQueResponde(json({}, 401)).adaptador.codigos('t')).rejects.toBeInstanceOf(TokenInvalido);
  });

  it.each([
    ['un 502 del gateway', json({ message: 'x' }, 502)],
    ['sin miPerfil', json({ data: null, errors: [{ message: 'x' }] })],
    ['una unidad sin código', json({ data: { miPerfil: { unidades: [{ unidadId: 'u' }] } } })],
  ])('%s es GestionNoDisponible', async (_caso, respuesta) => {
    await expect(gestionQueResponde(respuesta).adaptador.codigos('t')).rejects.toBeInstanceOf(GestionNoDisponible);
  });

  it('reintenta una vez ante un fallo de red y luego es GestionNoDisponible', async () => {
    const recuperado = gestionQueResponde(new Error('ECONNREFUSED'), json({ data: { miPerfil: { unidades: [{ codigo: 'A-101' }] } } }));
    expect(await recuperado.adaptador.codigos('t')).toEqual(['A-101']);

    const caido = gestionQueResponde(new Error('ECONNREFUSED'), new Error('ECONNREFUSED'));
    await expect(caido.adaptador.codigos('t')).rejects.toBeInstanceOf(GestionNoDisponible);
    expect(caido.enviadas).toHaveLength(2);
  });
});
