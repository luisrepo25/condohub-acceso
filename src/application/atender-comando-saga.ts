import {
  emitirPasesDeReserva,
  pasesDeLosInvitados,
  revocadaSinEmitir,
  revocarPasesDeReserva,
  type PasesDeReserva,
} from '@/domain/model/pases-de-reserva';
import type { VentanaPase } from '@/domain/model/visita';
import { type PasesDeReservaRepositorio, PasesDeReservaYaRegistrados } from './ports/pases-de-reserva';
import type { ComandoSaga, ComandosAtendidos, RespuestaSaga } from './ports/saga';

export interface DepsAtenderComandoSaga {
  readonly repositorio: PasesDeReservaRepositorio;
  readonly atendidos: ComandosAtendidos;
  readonly nuevoCodigoPase: () => string;
  readonly ventana: VentanaPase;
  readonly reloj: () => Date;
}

type Emitir = Extract<ComandoSaga, { tipo: 'reservas.EmitirPasesReserva' }>['data'];

/**
 * Paso 3 de la saga de reserva y su compensación: emite un pase por invitado (A1) o revoca los de la reserva (A2).
 * Idempotente por `eventId` (S5) y por reserva: repetir la emisión devuelve los mismos pases, y si la revocación llegó
 * antes, la emisión ya no emite nada. Cada escritura se puede repetir sin duplicar, así un corte a mitad se retoma.
 */
export class AtenderComandoSaga {
  constructor(private readonly d: DepsAtenderComandoSaga) {}

  /** @return `false` si el comando ya se había atendido */
  async ejecutar(comando: ComandoSaga): Promise<boolean> {
    if (await this.d.atendidos.atendido(comando.eventId)) return false;
    const respuesta = comando.tipo === 'reservas.EmitirPasesReserva' ? await this.emitir(comando.data) : await this.revocar(comando.data.reservaId);
    await this.d.atendidos.marcar(comando, respuesta);
    return true;
  }

  private async emitir(pedido: Emitir): Promise<RespuestaSaga> {
    const registro = await this.registrarUnaVez(pedido.reservaId, () => emitirPasesDeReserva(pedido, this.d.nuevoCodigoPase));
    await this.d.repositorio.guardarPases(registro.fecha, pasesDeLosInvitados(registro, this.d.ventana, this.d.reloj().toISOString()));
    const pases = registro.estado === 'REVOCADA' ? [] : registro.pases.map((p) => ({ invitadoId: p.invitadoId, codigo: p.codigo }));
    return { tipo: 'acceso.PaseEmitido', data: { reservaId: pedido.reservaId, pases } };
  }

  private async revocar(reservaId: string): Promise<RespuestaSaga> {
    const registro = await this.registrarUnaVez(reservaId, () => revocadaSinEmitir(reservaId));
    // Se revoca aunque la reserva ya figure revocada: retoma una revocación que se cortó a mitad.
    const cantidad = await this.d.repositorio.revocar(revocarPasesDeReserva(registro));
    return { tipo: 'acceso.PaseRevocado', data: { reservaId, cantidad } };
  }

  /** El registro de la reserva, o el nuevo si no había; si otro proceso lo crea a la vez, gana el primero. */
  private async registrarUnaVez(reservaId: string, nuevo: () => PasesDeReserva): Promise<PasesDeReserva> {
    const existente = await this.d.repositorio.deLaReserva(reservaId);
    if (existente) return existente;
    const registro = nuevo();
    try {
      await this.d.repositorio.registrar(registro);
      return registro;
    } catch (e) {
      if (!(e instanceof PasesDeReservaYaRegistrados)) throw e;
      const ganador = await this.d.repositorio.deLaReserva(reservaId);
      if (!ganador) throw e;
      return ganador;
    }
  }
}
