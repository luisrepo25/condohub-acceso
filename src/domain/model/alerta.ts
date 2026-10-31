/** Alerta de portería en el lenguaje de Acceso: «visitante recurrente no registrado» (I4). La IA aporta el clúster; Acceso la hace suya. */
export interface AlertaVisitante {
  readonly id: string;
  readonly tipo: 'VISITANTE_RECURRENTE';
  readonly clusterId: string;
  readonly apariciones: number;
  readonly diasDistintos: number;
  readonly creadaEn: string;
}
