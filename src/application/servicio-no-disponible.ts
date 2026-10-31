/** Otro servicio (Gestión) no respondió o respondió fuera de contrato: HTTP 503, se puede reintentar. */
export class ServicioNoDisponible extends Error {}

/** El Servicio IA no respondió o respondió fuera de contrato: HTTP 503. */
export class IaNoDisponible extends ServicioNoDisponible {}
