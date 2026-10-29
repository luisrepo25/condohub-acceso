import { PasesDeReserva } from '@/domain/model/pases-de-reserva';
import { type PasesDeReservaRepository, PasesDeReservaYaRegistrados } from '@/domain/ports/repositorios';
import type { ParametrosAcceso } from '@/domain/value-objects/parametros';
import type { GeneradorIds } from '../ports/servicios';
import type { ComandoSaga, ComandosAtendidos, RespuestaSaga } from '../ports/saga';

export interface DepsPasesDeReserva {
  readonly pasesDeReserva: PasesDeReservaRepository;
  readonly atendidos: ComandosAtendidos;
  readonly ids: GeneradorIds;
  readonly parametros: ParametrosAcceso;
}

/**
 * Paso 3 de la saga de reserva y su compensación: emite un pase por invitado (A1) o revoca los de la reserva (A2).
 * Idempotente por `eventId` (S5) y por reserva: repetir la emisión devuelve los mismos pases, y si la revocación llegó
 * antes, la emisión ya no emite nada. Cada escritura se puede repetir sin duplicar, así un corte a mitad se retoma.
 *
 * @return `false` si el comando ya se había atendido
 */
export async function atenderComandoSaga(deps: DepsPasesDeReserva, comando: ComandoSaga): Promise<boolean> {
  if (await deps.atendidos.atendido(comando.eventId)) return false;
  const respuesta = comando.tipo === 'reservas.EmitirPasesReserva' ? await emitir(deps, comando.data) : await revocar(deps, comando.data.reservaId);
  await deps.atendidos.marcar(comando, respuesta);
  return true;
}

async function emitir(deps: DepsPasesDeReserva, pedido: Extract<ComandoSaga, { tipo: 'reservas.EmitirPasesReserva' }>['data']): Promise<RespuestaSaga> {
  const registro = await registrarUnaVez(deps, pedido.reservaId, () => PasesDeReserva.emitir(pedido, () => deps.ids.codigoPase()));
  await deps.pasesDeReserva.guardarPases(registro.datos.fecha, registro.pases(deps.parametros));
  const pases = registro.revocada ? [] : registro.datos.pases.map((p) => ({ invitadoId: p.invitadoId, codigo: p.codigo }));
  return { tipo: 'acceso.PaseEmitido', data: { reservaId: pedido.reservaId, pases } };
}

async function revocar(deps: DepsPasesDeReserva, reservaId: string): Promise<RespuestaSaga> {
  const registro = await registrarUnaVez(deps, reservaId, () => PasesDeReserva.revocadaSinEmitir(reservaId));
  // Se revoca aunque la reserva ya figure revocada: retoma una revocación que se cortó a mitad.
  const cantidad = await deps.pasesDeReserva.revocar(registro.revocar());
  return { tipo: 'acceso.PaseRevocado', data: { reservaId, cantidad } };
}

/** El registro de la reserva, o el nuevo si no había; si otro proceso lo crea a la vez, gana el primero. */
async function registrarUnaVez(deps: DepsPasesDeReserva, reservaId: string, nuevo: () => PasesDeReserva): Promise<PasesDeReserva> {
  const existente = await deps.pasesDeReserva.deLaReserva(reservaId);
  if (existente) return existente;
  const registro = nuevo();
  try {
    await deps.pasesDeReserva.registrar(registro);
    return registro;
  } catch (e) {
    if (!(e instanceof PasesDeReservaYaRegistrados)) throw e;
    const ganador = await deps.pasesDeReserva.deLaReserva(reservaId);
    if (!ganador) throw e;
    return ganador;
  }
}
