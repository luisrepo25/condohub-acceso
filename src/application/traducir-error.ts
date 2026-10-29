import { ConflictoDeClave, DatoInvalido, ReglaViolada } from '@/domain/errores';
import { ServicioNoDisponible } from './servicio-no-disponible';

export interface ProblemaTraducido {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly code?: string;
}

/**
 * Errores del dominio a su problema HTTP: forma incorrecta = 400, clave de otra persona = 409, regla violada = 422 con el código de la regla,
 * F1 (la unidad no es del solicitante) = 403 y otro servicio caído = 503.
 */
export function traducirError(e: unknown): ProblemaTraducido | undefined {
  if (e instanceof DatoInvalido) return { status: 400, title: 'Solicitud inválida', detail: e.message };
  if (e instanceof ConflictoDeClave) return { status: 409, title: 'Conflicto', detail: e.message };
  if (e instanceof ReglaViolada && e.codigo === 'F1') return { status: 403, title: 'Sin permiso', detail: e.message, code: 'F1' };
  if (e instanceof ReglaViolada) return { status: 422, title: 'Regla de negocio violada', detail: e.message, code: e.codigo };
  if (e instanceof ServicioNoDisponible) {
    return { status: 503, title: 'Servicio no disponible', detail: 'No se pudo consultar a Gestión; reintente en unos segundos' };
  }
  return undefined;
}
