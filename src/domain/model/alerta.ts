/**
 * Alerta para el guardia (I4): un visitante recurrente no registrado. Es un concepto de Acceso; la IA solo da los
 * clústeres de rostros desconocidos y la capa anticorrupción los traduce a esto.
 */
export interface Alerta {
  readonly id: string;
  readonly tipo: 'VISITANTE_RECURRENTE';
  readonly clusterId: string;
  readonly apariciones: number;
  readonly diasDistintos: number;
  readonly creadaEn: Date;
}
