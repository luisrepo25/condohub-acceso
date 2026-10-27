// Capa anticorrupción con el Servicio IA (I4): qué pide y cómo traduce la respuesta de la IA a alertas de Acceso.
import { describe, expect, it } from 'vitest';
import { IaNoDisponible, TokenInvalido } from '@/application/errores';
import { VisitantesIa } from '@/infrastructure/ia/visitantes-ia';

function iaQueResponde(...respuestas: Array<Response | Error>) {
  const pedidas: Array<{ url: string; init: RequestInit }> = [];
  const fetchFalso = (async (url: string, init: RequestInit) => {
    pedidas.push({ url, init });
    const r = respuestas.shift();
    if (!r || r instanceof Error) throw r ?? new Error('sin respuesta');
    return r;
  }) as unknown as typeof fetch;
  return { adaptador: new VisitantesIa('http://gateway.prueba/ia/', 1000, fetchFalso), pedidas };
}

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
const visitante = { clusterId: 'c-7', apariciones: 5, diasDistintos: 3, primeraVez: '2026-10-20T10:00:00Z', ultimaVez: '2026-10-26T10:00:00Z', alertadoEn: '2026-10-26T06:00:00Z' };

describe('visitantes recurrentes de la IA como alertas de Acceso (I4)', () => {
  it('I4 traduce cada visitante con aviso a una Alerta y pide con el token del guardia', async () => {
    const { adaptador, pedidas } = iaQueResponde(json([visitante]));

    expect(await adaptador.alertas('token-guardia')).toEqual([
      { id: 'VISITANTE#c-7', tipo: 'VISITANTE_RECURRENTE', clusterId: 'c-7', apariciones: 5, diasDistintos: 3, creadaEn: new Date('2026-10-26T06:00:00Z') },
    ]);
    expect(pedidas[0]!.url).toBe('http://gateway.prueba/ia/rostros/visitantes-recurrentes?limite=100');
    expect((pedidas[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer token-guardia');
  });

  it('sin fecha de aviso usa la última vez que se lo vio', async () => {
    const [a] = await iaQueResponde(json([{ ...visitante, alertadoEn: null }])).adaptador.alertas('t');
    expect(a!.creadaEn).toEqual(new Date('2026-10-26T10:00:00Z'));
  });

  it('un 401 de la IA es un token inválido', async () => {
    await expect(iaQueResponde(json({}, 401)).adaptador.alertas('t')).rejects.toBeInstanceOf(TokenInvalido);
  });

  it.each([
    ['un 500', json({}, 500)],
    ['algo que no es una lista', json({ visitantes: [] })],
    ['un visitante sin clusterId', json([{ ...visitante, clusterId: undefined }])],
    ['una fecha inválida', json([{ ...visitante, alertadoEn: 'ayer', ultimaVez: 'ayer' }])],
  ])('%s es IaNoDisponible', async (_caso, respuesta) => {
    await expect(iaQueResponde(respuesta).adaptador.alertas('t')).rejects.toBeInstanceOf(IaNoDisponible);
  });

  it('reintenta una vez ante un fallo de red', async () => {
    expect(await iaQueResponde(new Error('ECONNREFUSED'), json([])).adaptador.alertas('t')).toEqual([]);
    await expect(iaQueResponde(new Error('x'), new Error('x')).adaptador.alertas('t')).rejects.toBeInstanceOf(IaNoDisponible);
  });
});
