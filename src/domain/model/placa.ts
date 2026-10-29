/** Placa de un vehículo de residente (A4). Se guarda y compara tal cual: en mayúsculas y sin separadores. */
export interface PlacaRegistrada {
  readonly placa: string;
  readonly unidadCodigo: string;
}

/** A4: la placa leída se compara contra la lista sin importar mayúsculas, espacios ni guiones. */
export function normalizarPlaca(texto: string): string {
  return texto.toUpperCase().replace(/[\s-]/g, '');
}
