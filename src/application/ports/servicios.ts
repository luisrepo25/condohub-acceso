/** Hora actual. Puerto para probar las reglas de tiempo (A1, A2) con una hora fija. */
export interface Reloj {
  ahora(): Date;
}

/** Identificadores y códigos de pase difíciles de adivinar (el QR es una credencial). */
export interface GeneradorIds {
  id(): string;
  codigoPase(): string;
}

/**
 * F1: códigos de las unidades del solicitante según Gestión (`miPerfil`), con su propio token. Gestión es la dueña de
 * las unidades; Acceso no guarda esa relación.
 *
 * @throws GestionNoDisponible si Gestión no responde o responde fuera de contrato
 */
export interface UnidadesDelSolicitante {
  codigos(token: string): Promise<string[]>;
}
