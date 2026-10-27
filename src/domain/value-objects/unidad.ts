import { DatoInvalido } from '../errores';

const CODIGO = /^[A-Z]{1,3}-\d{1,4}$/;

/** Código de unidad tal como lo usa Gestión (ej. `A-101`). Acceso identifica la unidad por su código. */
export function unidadCodigo(valor: string): string {
  const codigo = valor.trim().toUpperCase();
  if (!CODIGO.test(codigo)) throw new DatoInvalido(`Código de unidad inválido: '${valor}' (ej. A-101)`);
  return codigo;
}
