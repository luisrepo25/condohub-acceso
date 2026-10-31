import type { FuenteAlertas } from '@/application/ports/alertas';
import { IaNoDisponible } from '@/application/servicio-no-disponible';
import type { AlertaVisitante } from '@/domain/model/alerta';

/** Lo que devuelve la IA (`GET /rostros/visitantes-recurrentes`): su modelo, no el de Acceso. */
interface VisitanteIa {
  clusterId?: unknown;
  apariciones?: unknown;
  diasDistintos?: unknown;
  ultimaVez?: unknown;
  alertadoEn?: unknown;
}

const esTexto = (v: unknown): v is string => typeof v === 'string' && v !== '';
const esEntero = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;

/**
 * Capa anticorrupción Acceso ← IA: pide los clústeres con el token del guardia (la IA decide quién puede verlos) y los traduce a
 * `AlertaVisitante`. Solo pasan los campos que Acceso necesita: ni embeddings ni fotos (I1, I6). Fuera de contrato = 503, nunca
 * se inventa una alerta.
 */
export class AlertasIa implements FuenteAlertas {
  constructor(
    private readonly url: string,
    private readonly espera = 5000,
    private readonly http: typeof fetch = fetch,
  ) {}

  async visitantesRecurrentes(credencial: string): Promise<AlertaVisitante[]> {
    let r: Response;
    try {
      r = await this.http(`${this.url}/rostros/visitantes-recurrentes`, {
        headers: { authorization: `Bearer ${credencial}` },
        signal: AbortSignal.timeout(this.espera),
      });
    } catch {
      throw new IaNoDisponible('El Servicio IA no respondió');
    }
    if (!r.ok) throw new IaNoDisponible(`El Servicio IA respondió HTTP ${r.status}`);
    const cuerpo: unknown = await r.json().catch(() => undefined);
    if (!Array.isArray(cuerpo)) throw new IaNoDisponible('El Servicio IA respondió fuera de contrato');
    return cuerpo.map(traducir);
  }
}

function traducir(v: VisitanteIa): AlertaVisitante {
  const creadaEn = esTexto(v.alertadoEn) ? v.alertadoEn : v.ultimaVez;
  if (!esTexto(v.clusterId) || !esEntero(v.apariciones) || !esEntero(v.diasDistintos) || !esTexto(creadaEn)) {
    throw new IaNoDisponible('El Servicio IA respondió fuera de contrato');
  }
  return { id: v.clusterId, tipo: 'VISITANTE_RECURRENTE', clusterId: v.clusterId, apariciones: v.apariciones, diasDistintos: v.diasDistintos, creadaEn };
}
