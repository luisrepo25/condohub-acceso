import { IaNoDisponible, TokenInvalido } from '@/application/errores';
import type { VisitantesRecurrentes } from '@/application/ports/servicios';
import type { Alerta } from '@/domain/model/alerta';

/** Lo que responde el Servicio IA (contracts/openapi/ia.yaml, VisitanteRecurrente): su modelo, no el de Acceso. */
interface VisitanteRecurrenteIa {
  clusterId?: unknown;
  apariciones?: unknown;
  diasDistintos?: unknown;
  ultimaVez?: unknown;
  alertadoEn?: unknown;
}

/** Cuántos visitantes se piden (el máximo que permite la IA). */
const LIMITE = 100;

/**
 * Capa anticorrupción Acceso ↔ IA (docs/arquitectura/ddd.md) para I4: pide a la IA sus visitantes recurrentes con el
 * token del guardia (por el gateway) y los traduce a `Alerta` de Acceso. Si la IA cambia su forma, solo cambia aquí.
 * Es una lectura: se reintenta una vez ante un fallo de red; el token no se guarda ni se registra.
 */
export class VisitantesIa implements VisitantesRecurrentes {
  constructor(
    private readonly urlIa: string,
    private readonly timeoutMs: number,
    private readonly hacerFetch: typeof fetch = fetch,
  ) {}

  async alertas(token: string): Promise<Alerta[]> {
    const respuesta = await this.consultar(token);
    if (respuesta.status === 401) throw new TokenInvalido('El token ya no es válido para el Servicio IA');
    if (!respuesta.ok) throw new IaNoDisponible(`El Servicio IA respondió ${respuesta.status}`);
    const cuerpo: unknown = await respuesta.json().catch(() => null);
    if (!Array.isArray(cuerpo)) throw new IaNoDisponible('El Servicio IA respondió algo que no cumple su contrato');
    return cuerpo.map((v) => VisitantesIa.traducir(v as VisitanteRecurrenteIa));
  }

  /** Un visitante con aviso de la IA es una alerta de Acceso; la fecha de la alerta es la del aviso (o su última vez). */
  private static traducir(v: VisitanteRecurrenteIa): Alerta {
    const creadaEn = new Date(String(v.alertadoEn ?? v.ultimaVez ?? ''));
    if (typeof v.clusterId !== 'string' || typeof v.apariciones !== 'number' || typeof v.diasDistintos !== 'number' || Number.isNaN(creadaEn.getTime())) {
      throw new IaNoDisponible('El Servicio IA respondió un visitante sin los datos del contrato');
    }
    return {
      id: `VISITANTE#${v.clusterId}`,
      tipo: 'VISITANTE_RECURRENTE',
      clusterId: v.clusterId,
      apariciones: v.apariciones,
      diasDistintos: v.diasDistintos,
      creadaEn,
    };
  }

  private async consultar(token: string): Promise<Response> {
    const url = `${this.urlIa.replace(/\/$/, '')}/rostros/visitantes-recurrentes?limite=${LIMITE}`;
    let ultimo: unknown;
    for (let intento = 0; intento < 2; intento++) {
      try {
        return await this.hacerFetch(url, {
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        ultimo = e;
      }
    }
    console.warn('El Servicio IA no responde a visitantes-recurrentes', ultimo instanceof Error ? ultimo.message : ultimo);
    throw new IaNoDisponible('El Servicio IA no responde');
  }
}
