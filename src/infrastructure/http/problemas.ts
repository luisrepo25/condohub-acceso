import {
  ClaveIdempotenciaAjena,
  GestionNoDisponible,
  ServicioDeIdentidadNoDisponible,
  SinPermiso,
  TokenInvalido,
} from '@/application/errores';
import { DatoInvalido, ReglaNegocioViolada } from '@/domain/errores';

/** Errores en `application/problem+json` (RFC 7807); `code` = código de la regla cuando aplica. */
export function problema(
  status: number,
  title: string,
  opciones: { detail?: string; code?: string; headers?: HeadersInit; extra?: Readonly<Record<string, string>> } = {},
) {
  const cuerpo: Record<string, unknown> = { type: 'about:blank', title, status, ...opciones.extra };
  if (opciones.detail) cuerpo.detail = opciones.detail;
  if (opciones.code) cuerpo.code = opciones.code;
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/problem+json', ...(opciones.headers as Record<string, string>) },
  });
}

export function noImplementado(que: string) {
  return problema(501, 'No implementado', { detail: `${que} aún no está implementado`, code: 'NO_IMPLEMENTADO' });
}

export function desdeError(e: unknown): Response {
  if (e instanceof TokenInvalido) return problema(401, 'No autenticado', { headers: { 'www-authenticate': 'Bearer' } });
  if (e instanceof SinPermiso) return problema(403, 'Sin permiso', { detail: e.message });
  if (e instanceof ServicioDeIdentidadNoDisponible) return problema(503, 'Servicio de identidad no disponible');
  // F1 (la unidad no es del solicitante) es falta de permiso; las demás reglas, 422 con su código y sus datos (ej. motivo).
  if (e instanceof ReglaNegocioViolada) {
    return e.codigo === 'F1'
      ? problema(403, 'Sin permiso', { detail: e.message, code: 'F1' })
      : problema(422, 'Regla de negocio violada', { detail: e.message, code: e.codigo, extra: e.detalle });
  }
  if (e instanceof DatoInvalido) return problema(400, 'Solicitud inválida', { detail: e.message });
  if (e instanceof ClaveIdempotenciaAjena) return problema(409, 'Idempotency-Key ya usada', { detail: e.message, code: 'O3' });
  if (e instanceof GestionNoDisponible) {
    return problema(503, 'Gestión no disponible', {
      detail: 'No se pudo consultar a Gestión qué unidades son tuyas; reintenta en unos segundos',
      headers: { 'retry-after': '5' },
    });
  }
  console.error('error no controlado', e instanceof Error ? e.message : e);
  return problema(500, 'Error interno');
}
