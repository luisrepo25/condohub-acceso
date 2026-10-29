import { traducirError } from '@/application/traducir-error';
import { DatoInvalido } from '@/domain/errores';
import { problema } from './problemas';

/** Lee el cuerpo JSON; si no lo es, es una solicitud inválida (400). */
export async function leerJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new DatoInvalido('El cuerpo debe ser JSON válido');
  }
}

/** El token de quien llama, para reenviarlo a Gestión (F1): ya lo validó `proteger`. */
export function credencialDe(request: Request): string {
  return (request.headers.get('authorization') ?? '').replace(/^Bearer /i, '');
}

/** Traduce los errores del dominio a problem+json (400 forma, 422 regla con su código); el resto sube a `proteger`. */
export function conErroresDeDominio<A extends unknown[]>(manejador: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try {
      return await manejador(...a);
    } catch (e) {
      const p = traducirError(e);
      if (!p) throw e;
      return problema(p.status, p.title, { detail: p.detail, code: p.code });
    }
  };
}
