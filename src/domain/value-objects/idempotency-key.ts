import { DatoInvalido, ReglaNegocioViolada } from '../errores';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * O1: clave UUID v4 generada en el dispositivo; repetirla devuelve la misma respuesta (O3). Sin clave la petición está
 * mal formada (400); una clave que no es UUID v4 viola O1 (422), igual que en Reservas.
 */
export function idempotencyKey(valor: string | null | undefined): string {
  const clave = (valor ?? '').trim().toLowerCase();
  if (clave === '') throw new DatoInvalido('Falta el header Idempotency-Key (UUID v4 generado en el dispositivo)');
  if (!UUID_V4.test(clave)) throw new ReglaNegocioViolada('O1', 'La Idempotency-Key debe ser un UUID v4');
  return clave;
}
