/** Roles del realm `condohub` de Keycloak. No hay otros. */
export const ROLES = ['ADMIN', 'RESIDENTE', 'GUARDIA'] as const;
export type Rol = (typeof ROLES)[number];

export function esRol(valor: string): valor is Rol {
  return (ROLES as readonly string[]).includes(valor);
}

/** Quien hace la petición: el `sub` del token de Keycloak y sus roles. */
export interface Solicitante {
  readonly sub: string;
  readonly roles: ReadonlySet<Rol>;
}