import { describe, expect, it } from 'vitest';
import { ServicioNoDisponible } from '@/application/servicio-no-disponible';
import { UnidadesGestion } from '@/infrastructure/gestion/unidades-gestion';
import { configPasesDesdeEntorno, nuevoCodigoPase } from '@/infrastructure/config-pases';

const responder = (cuerpo: unknown, status = 200) => (async () => new Response(JSON.stringify(cuerpo), { status })) as unknown as typeof fetch;

describe('UnidadesGestion (F1 por API)', () => {
  it('F1_pide_las_unidades_con_el_token_de_quien_llama_y_devuelve_sus_codigos', async () => {
    let recibida: { url: string; init?: RequestInit } | undefined;
    const http = (async (url: string, init?: RequestInit) => {
      recibida = { url, init };
      return new Response(JSON.stringify({ data: { miPerfil: { unidades: [{ codigo: 'A-101' }, { codigo: 'B-202' }] } } }));
    }) as unknown as typeof fetch;
    const codigos = await new UnidadesGestion('http://gestion/graphql', 1000, http).codigos('jwt-residente');
    expect(codigos).toEqual(['A-101', 'B-202']);
    expect((recibida?.init?.headers as Record<string, string>).authorization).toBe('Bearer jwt-residente');
    expect(String(recibida?.init?.body)).toContain('miPerfil');
  });

  it('F1_una_cuenta_sin_unidades_devuelve_lista_vacia', async () => {
    const gestion = new UnidadesGestion('http://g', 1000, responder({ data: { miPerfil: { unidades: [] } } }));
    expect(await gestion.codigos('jwt')).toEqual([]);
  });

  it.each([
    ['HTTP 500', responder({}, 500)],
    ['errores GraphQL', responder({ errors: [{ message: 'x' }], data: null })],
    ['respuesta sin forma', responder({ data: {} })],
    ['sin red', (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch],
  ])('nunca asume permiso: %s es ServicioNoDisponible', async (_nombre, http) => {
    await expect(new UnidadesGestion('http://g', 1000, http).codigos('jwt')).rejects.toThrow(ServicioNoDisponible);
  });
});

describe('configuracion de pases', () => {
  it('A1_la_ventana_por_defecto_es_07_00_a_23_59_en_la_hora_de_La_Paz', () => {
    expect(configPasesDesdeEntorno({}).ventana).toEqual({ horaDesde: '07:00:00', horaHasta: '23:59:59', offset: '-04:00' });
  });

  it('A1_la_ventana_y_la_zona_son_parametros', () => {
    const c = configPasesDesdeEntorno({ PASE_HORA_DESDE: '08:00:00', PASE_HORA_HASTA: '22:00:00', ZONA_DESFASE_MINUTOS: '-180' });
    expect(c.ventana).toEqual({ horaDesde: '08:00:00', horaHasta: '22:00:00', offset: '-03:00' });
    expect(c.desfaseMinutos).toBe(-180);
  });

  it('A1_el_codigo_del_pase_es_largo_aleatorio_y_distinto', () => {
    const codigos = new Set(Array.from({ length: 100 }, nuevoCodigoPase));
    expect(codigos.size).toBe(100);
    expect([...codigos][0]).toMatch(/^CH-[A-Za-z0-9_-]{22}$/);
  });
});
