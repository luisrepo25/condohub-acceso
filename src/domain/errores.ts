/** La forma de lo recibido es incorrecta (HTTP 400). */
export class DatoInvalido extends Error {}

/** Una regla de negocio impide la operación (HTTP 422); `codigo` es el de la regla (A2, A3...). */
export class ReglaViolada extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}


/** La `Idempotency-Key` ya la usó otra persona (HTTP 409, O3): repetir una clave ajena no devuelve su respuesta. */
export class ConflictoDeClave extends Error {
  constructor() {
    super('La Idempotency-Key ya fue usada por otra persona');
  }
}
