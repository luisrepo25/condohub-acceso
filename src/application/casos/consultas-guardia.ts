import type { PaseRepository } from '@/domain/ports/repositorios';
import { fechaLocal } from '@/domain/value-objects/hora-local';
import type { ParametrosAcceso } from '@/domain/value-objects/parametros';
import { alertaJson, paseJson } from '../presentacion';
import type { Reloj, VisitantesRecurrentes } from '../ports/servicios';

export interface DepsPasesGuardia {
  readonly pases: PaseRepository;
  readonly reloj: Reloj;
  readonly parametros: ParametrosAcceso;
}

/**
 * O6: los pases del día local para la copia sin conexión de la PWA del guardia. Incluye los usados y revocados (con su
 * estado) para que la PWA deje de aceptarlos; `desde` trae solo los que cambiaron (sincronización incremental).
 */
export async function pasesParaGuardia(deps: DepsPasesGuardia, desde?: Date) {
  const ahora = deps.reloj.ahora();
  const pases = await deps.pases.delDia(fechaLocal(ahora, deps.parametros.zonaHoraria), desde);
  return pases.map((p) => paseJson(p, ahora));
}

export interface DepsAlertas {
  readonly visitantes: VisitantesRecurrentes;
}

/** I4: alertas de visitante recurrente para el guardia, de la más reciente a la más antigua; `desde` filtra por fecha. */
export async function alertasParaGuardia(deps: DepsAlertas, token: string, desde?: Date) {
  const alertas = await deps.visitantes.alertas(token);
  return alertas
    .filter((a) => !desde || a.creadaEn >= desde)
    .sort((a, b) => b.creadaEn.getTime() - a.creadaEn.getTime())
    .map(alertaJson);
}
