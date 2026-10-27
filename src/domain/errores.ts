/** Una regla de negocio impide la operación; `codigo` es el de reglas-de-negocio.md (A1, A2...). HTTP 422 (F1: 403). */
export class ReglaNegocioViolada extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    /** Datos para el cliente, ej. `{ motivo: 'USADO' }` en A2. */
    readonly detalle: Readonly<Record<string, string>> = {},
  ) {
    super(mensaje);
    this.name = 'ReglaNegocioViolada';
  }
}

/** Un dato de entrada no tiene la forma válida (nombre vacío, fecha mal escrita...). HTTP 400. */
export class DatoInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'DatoInvalido';
  }
}
