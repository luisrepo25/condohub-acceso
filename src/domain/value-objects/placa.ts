/**
 * Placa (A4): en mayúsculas y sin separadores. Las placas registradas se comparan tal cual (también las de otro
 * formato, extranjeras o antiguas); el formato boliviano (4 dígitos + 3 letras) solo importa para aceptar una lectura.
 */
export function normalizarPlaca(valor: string): string {
  return valor.toUpperCase().replace(/[\s.-]/g, '');
}

export function esFormatoBoliviano(placa: string): boolean {
  return /^\d{4}[A-Z]{3}$/.test(placa);
}
