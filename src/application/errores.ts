export class TokenInvalido extends Error {}
export class ServicioDeIdentidadNoDisponible extends Error {}
export class SinPermiso extends Error {}

/** Gestión no respondió o respondió fuera de contrato: no se sabe qué unidades son del residente (F1). HTTP 503. */
export class GestionNoDisponible extends Error {}

/** El Servicio IA no respondió o respondió fuera de contrato: no hay alertas que mostrar (I4). HTTP 503. */
export class IaNoDisponible extends Error {}

/** O3: la Idempotency-Key ya la usó otra persona. No se devuelve su respuesta: HTTP 409. */
export class ClaveIdempotenciaAjena extends Error {}
