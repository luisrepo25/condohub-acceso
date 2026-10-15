import { ServicioDeIdentidadNoDisponible, SinPermiso, TokenInvalido } from '@/application/errores';

/** Errores en `application/problem+json` (RFC 7807); `code` = código de la regla cuando aplica. */
export function problema(status: number, title: string, opciones: { detail?: string; code?: string; headers?: HeadersInit } = {}) {
  const cuerpo: Record<string, unknown> = { type: 'about:blank', title, status };
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
  console.error('error no controlado', e instanceof Error ? e.message : e);
  return problema(500, 'Error interno');
}