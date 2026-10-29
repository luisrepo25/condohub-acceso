import type { RegistroAcceso } from '@/domain/model/registro-acceso';

export interface ResultadoGuardado {
  /** false cuando la `Idempotency-Key` ya existía: `respuesta` es la de la primera vez (O3). */
  readonly creado: boolean;
  readonly respuesta: RegistroAcceso;
}

/**
 * Puerto de persistencia de los registros de acceso. `guardar` es atómico:
 * - guarda la clave de idempotencia y el registro, o devuelve lo guardado la primera vez (O3);
 * - si el registro es un ingreso permitido con `paseCodigo`, consume el único uso del pase con una
 *   escritura condicional, o lanza `ReglaViolada('A2', ...)` si no sirve (A2, A1).
 */
export interface RegistroAccesoRepositorio {
  guardar(registro: RegistroAcceso, idempotencyKey: string, opciones?: OpcionesGuardado): Promise<ResultadoGuardado>;
}

export interface OpcionesGuardado {
  /** O6: instante en que se evalúa el pase (la hora del ingreso sin conexión). Por omisión, ahora. */
  readonly instante?: Date;
  /** O6: el ingreso se registra sin evaluar ni gastar el pase (ya ocurrió y el pase ya no servía). */
  readonly sinConsumirPase?: boolean;
}
