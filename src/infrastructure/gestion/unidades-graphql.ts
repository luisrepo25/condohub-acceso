import { GestionNoDisponible, TokenInvalido } from '@/application/errores';
import type { UnidadesDelSolicitante } from '@/application/ports/servicios';

const MIS_UNIDADES = 'query UnidadesDelSolicitante { miPerfil { unidades { codigo } } }';

/**
 * F1 sobre la API GraphQL de Gestión (contracts/graphql/schema.graphql), por el gateway y con el token de quien hace la
 * petición: Gestión responde solo sus unidades. Es una lectura: se reintenta una vez ante un fallo de red, nunca ante una
 * respuesta. El token no se guarda ni se registra.
 */
export class UnidadesGraphql implements UnidadesDelSolicitante {
  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
    private readonly hacerFetch: typeof fetch = fetch,
  ) {}

  async codigos(token: string): Promise<string[]> {
    const respuesta = await this.consultar(token);
    if (respuesta.status === 401) throw new TokenInvalido('El token ya no es válido para Gestión');
    if (!respuesta.ok) throw new GestionNoDisponible(`Gestión respondió ${respuesta.status}`);
    const cuerpo = (await respuesta.json().catch(() => null)) as { data?: { miPerfil?: { unidades?: unknown } }; errors?: unknown } | null;
    const unidades = cuerpo?.data?.miPerfil?.unidades;
    if (!Array.isArray(unidades)) throw new GestionNoDisponible('Gestión respondió algo que no cumple su contrato (miPerfil.unidades)');
    return unidades.map((u) => {
      const codigo = (u as { codigo?: unknown } | null)?.codigo;
      if (typeof codigo !== 'string' || codigo === '') throw new GestionNoDisponible('Gestión respondió una unidad sin código');
      return codigo.toUpperCase();
    });
  }

  private async consultar(token: string): Promise<Response> {
    let ultimo: unknown;
    for (let intento = 0; intento < 2; intento++) {
      try {
        return await this.hacerFetch(this.url, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ query: MIS_UNIDADES }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        ultimo = e;
      }
    }
    console.warn('Gestión no responde a miPerfil', ultimo instanceof Error ? ultimo.message : ultimo);
    throw new GestionNoDisponible('Gestión no responde');
  }
}
