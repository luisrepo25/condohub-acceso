import { ClaveYaUsada, type RespuestaGuardada, type RespuestasIdempotentes } from '@/domain/ports/repositorios';
import type { Solicitante } from '@/domain/model/rol';
import { ClaveIdempotenciaAjena } from './errores';

export interface Respuesta {
  readonly codigoHttp: number;
  readonly cuerpo: unknown;
}

/**
 * O3: ejecuta una escritura idempotente. Si la clave ya existe devuelve su respuesta guardada (solo a quien la creó);
 * si dos reintentos llegan a la vez y el otro guardó primero, también devuelve la del otro.
 *
 * @param escribir hace la operación y la guarda junto con `respuesta`; lanza ClaveYaUsada si la clave se adelantó
 */
export async function idempotente(
  respuestas: RespuestasIdempotentes,
  clave: string,
  solicitante: Solicitante,
  escribir: () => Promise<Respuesta>,
): Promise<Respuesta> {
  const previa = await respuestas.buscar(clave);
  if (previa) return deQuien(previa, solicitante);
  try {
    return await escribir();
  } catch (e) {
    if (!(e instanceof ClaveYaUsada)) throw e;
    const ganadora = await respuestas.buscar(clave);
    if (!ganadora) throw e;
    return deQuien(ganadora, solicitante);
  }
}

function deQuien(guardada: RespuestaGuardada, solicitante: Solicitante): Respuesta {
  if (guardada.sub !== solicitante.sub) throw new ClaveIdempotenciaAjena('Esa Idempotency-Key ya se usó en otra solicitud');
  return { codigoHttp: guardada.codigoHttp, cuerpo: guardada.cuerpo };
}
