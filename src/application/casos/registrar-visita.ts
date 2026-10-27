import { ReglaNegocioViolada } from '@/domain/errores';
import type { Solicitante } from '@/domain/model/rol';
import { type SolicitudVisita, Visita } from '@/domain/model/visita';
import type { RespuestasIdempotentes, VisitaRepository } from '@/domain/ports/repositorios';
import { idempotencyKey } from '@/domain/value-objects/idempotency-key';
import type { ParametrosAcceso } from '@/domain/value-objects/parametros';
import { unidadCodigo } from '@/domain/value-objects/unidad';
import { idempotente, type Respuesta } from '../idempotencia';
import { visitaJson } from '../presentacion';
import type { GeneradorIds, Reloj, UnidadesDelSolicitante } from '../ports/servicios';

export interface DepsRegistrarVisita {
  readonly visitas: VisitaRepository;
  readonly respuestas: RespuestasIdempotentes;
  readonly unidades: UnidadesDelSolicitante;
  readonly reloj: Reloj;
  readonly ids: GeneradorIds;
  readonly parametros: ParametrosAcceso;
}

/**
 * A1: el residente anuncia una visita para su unidad (F1, según Gestión) y se emite su pase QR; el ADMIN, para
 * cualquier unidad. Idempotente por Idempotency-Key (O1–O3): repetirla devuelve la misma visita y el mismo pase.
 */
export async function registrarVisita(
  deps: DepsRegistrarVisita,
  solicitante: Solicitante,
  token: string,
  claveCruda: string | null,
  solicitud: SolicitudVisita,
): Promise<Respuesta> {
  const clave = idempotencyKey(claveCruda);
  return idempotente(deps.respuestas, clave, solicitante, async () => {
    const unidad = unidadCodigo(solicitud.unidadCodigo);
    if (!solicitante.roles.has('ADMIN') && !(await deps.unidades.codigos(token)).includes(unidad)) {
      throw new ReglaNegocioViolada('F1', 'Solo puedes registrar visitas para una unidad tuya');
    }
    const ahora = deps.reloj.ahora();
    const visita = Visita.registrar(
      { ...solicitud, unidadCodigo: unidad },
      { visitaId: deps.ids.id(), codigoPase: deps.ids.codigoPase() },
      solicitante.sub,
      ahora,
      deps.parametros,
    );
    const respuesta = { codigoHttp: 201, cuerpo: visitaJson(visita, ahora) };
    await deps.visitas.registrar(visita, { clave, sub: solicitante.sub, ...respuesta });
    return respuesta;
  });
}
