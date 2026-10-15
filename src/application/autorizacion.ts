import type { Rol, Solicitante } from '@/domain/model/rol';
import { SinPermiso } from './errores';

/** Autorización por rol del token: cada endpoint declara qué roles lo pueden usar. */
export function exigirAlgunRol(solicitante: Solicitante, ...permitidos: Rol[]): void {
  if (!permitidos.some((rol) => solicitante.roles.has(rol))) {
    throw new SinPermiso(`Se requiere alguno de los roles: ${permitidos.join(', ')}`);
  }
}