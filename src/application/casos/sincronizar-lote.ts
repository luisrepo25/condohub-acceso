import type { NuevoAcceso } from '@/domain/model/registro-acceso';
import type { Solicitante } from '@/domain/model/rol';
import type { Respuesta } from '../idempotencia';
import { type DepsRegistrarAcceso, registrarAcceso } from './registrar-acceso';

export interface OperacionSync {
  readonly idempotencyKey: string;
  /** Lee los datos de la operación; si no tienen la forma válida lanza DatoInvalido y esa operación sola responde 400. */
  readonly datos: () => NuevoAcceso;
}

export interface ResultadoOperacion {
  readonly idempotencyKey: string;
  readonly codigo: number;
  readonly cuerpo: unknown;
}

/**
 * O1–O4: aplica en orden un lote de operaciones hechas sin conexión. Cada una es independiente, con su propia
 * Idempotency-Key, y su resultado es el que habría tenido por separado: un error de una no frena a las demás. Repetir
 * el lote devuelve las mismas respuestas sin duplicar nada (O3). La PWA da por sincronizada solo la que tuvo 2xx (O4).
 *
 * @param comoRespuesta traduce un error de una operación a su código y cuerpo (problem+json), como lo haría la API
 */
export async function sincronizarLote(
  deps: DepsRegistrarAcceso,
  solicitante: Solicitante,
  operaciones: readonly OperacionSync[],
  comoRespuesta: (error: unknown) => Promise<Respuesta>,
): Promise<ResultadoOperacion[]> {
  const resultados: ResultadoOperacion[] = [];
  for (const op of operaciones) {
    let r: Respuesta;
    try {
      r = await registrarAcceso(deps, solicitante, op.idempotencyKey, op.datos(), { sinConexion: true });
    } catch (e) {
      r = await comoRespuesta(e);
    }
    resultados.push({ idempotencyKey: op.idempotencyKey, codigo: r.codigoHttp, cuerpo: r.cuerpo });
  }
  return resultados;
}
