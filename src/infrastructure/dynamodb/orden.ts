/** DynamoDB no conserva el orden de los campos: se ordenan (también los anidados) para repetir la respuesta idéntica (O3). */
export function conCamposOrdenados<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map(conCamposOrdenados) as unknown as T;
  if (valor === null || typeof valor !== 'object') return valor;
  const entradas = Object.entries(valor as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entradas.map(([k, v]) => [k, conCamposOrdenados(v)])) as T;
}
