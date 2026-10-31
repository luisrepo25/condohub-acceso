/** Dónde está el Servicio IA (por el gateway, con el token de quien llama). Parámetro por variable de entorno. */
export function iaUrlDesdeEntorno(env: Record<string, string | undefined> = process.env): string {
  return env.IA_URL ?? 'http://localhost:8090/ia';
}
