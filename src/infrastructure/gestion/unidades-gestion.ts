import type { UnidadesDelSolicitante } from '@/application/ports/pases';
import { ServicioNoDisponible } from '@/application/servicio-no-disponible';

const CONSULTA = '{ miPerfil { unidades { codigo } } }';

interface RespuestaPerfil {
  data?: { miPerfil?: { unidades?: Array<{ codigo?: unknown }> } };
  errors?: unknown[];
}

/**
 * F1 por API: pregunta a Gestión (otro contexto) cuáles son las unidades de quien llama, con el token de esa persona, así
 * que Gestión decide. Si no responde o responde fuera de contrato, `ServicioNoDisponible` (503), nunca se asume permiso.
 */
export class UnidadesGestion implements UnidadesDelSolicitante {
  constructor(
    private readonly url: string,
    private readonly espera = 5000,
    private readonly http: typeof fetch = fetch,
  ) {}

  async codigos(credencial: string): Promise<string[]> {
    let r: Response;
    try {
      r = await this.http(this.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${credencial}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query: CONSULTA }),
        signal: AbortSignal.timeout(this.espera),
      });
    } catch {
      throw new ServicioNoDisponible('Gestión no respondió');
    }
    if (!r.ok) throw new ServicioNoDisponible(`Gestión respondió HTTP ${r.status}`);
    const cuerpo = (await r.json().catch(() => undefined)) as RespuestaPerfil | undefined;
    const unidades = cuerpo?.data?.miPerfil?.unidades;
    if (cuerpo?.errors || !Array.isArray(unidades)) throw new ServicioNoDisponible('Gestión respondió fuera de contrato');
    return unidades.map((u) => u.codigo).filter((c): c is string => typeof c === 'string');
  }
}
