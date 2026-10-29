export type EstadoPase = 'VIGENTE' | 'USADO' | 'REVOCADO' | 'VENCIDO';
export type MotivoPaseNoUsable = 'NO_EXISTE' | 'REVOCADO' | 'USADO' | 'VENCIDO' | 'AUN_NO_VALIDO';

export interface Pase {
  readonly codigo: string;
  readonly unidadCodigo: string;
  readonly estado: EstadoPase;
  readonly usos: number;
  readonly usosMaximos: number;
  readonly validoDesde: string;
  readonly validoHasta: string;
  readonly visitaId?: string;
  readonly origen?: 'VISITA' | 'RESERVA';
  /** Último cambio (creación o uso): permite a la app del guardia sincronizar solo lo nuevo (O6). */
  readonly actualizadoEn?: string;
}

/** A2: un pase inexistente, revocado, usado o fuera de su ventana se rechaza con motivo; `undefined` si sirve. */
export function motivoPaseNoUsable(pase: Pase | undefined, ahora: Date): MotivoPaseNoUsable | undefined {
  if (!pase) return 'NO_EXISTE';
  if (pase.estado === 'REVOCADO') return 'REVOCADO';
  if (pase.estado === 'USADO' || pase.usos >= pase.usosMaximos) return 'USADO';
  const t = ahora.getTime();
  if (t < Date.parse(pase.validoDesde)) return 'AUN_NO_VALIDO';
  if (pase.estado === 'VENCIDO' || t > Date.parse(pase.validoHasta)) return 'VENCIDO';
  return undefined;
}
