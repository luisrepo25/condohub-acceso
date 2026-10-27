/** Parámetros de negocio de Acceso (configuración, nunca constantes en el código). */
export interface ParametrosAcceso {
  /** Zona horaria del condominio: las ventanas de los pases son hora local (A1). */
  readonly zonaHoraria: string;
  /** A1: ventana por defecto del pase de una visita, hora local `HH:MM:SS`. */
  readonly ventanaDesde: string;
  readonly ventanaHasta: string;
  /** A4: confianza mínima de una placa leída para permitir el ingreso sin que decida el guardia. */
  readonly confianzaPlacaMinima: number;
}
