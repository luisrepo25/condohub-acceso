import type { PaseDeReserva, PasesDeReserva } from '@/domain/model/pases-de-reserva';

/** Otro proceso registró antes los pases de la reserva: gana el primero. */
export class PasesDeReservaYaRegistrados extends Error {
  constructor() {
    super('Los pases de la reserva ya estaban registrados');
    this.name = 'PasesDeReservaYaRegistrados';
  }
}

export interface PasesDeReservaRepositorio {
  deLaReserva(reservaId: string): Promise<PasesDeReserva | null>;
  /** Guarda qué pase recibió cada invitado. @throws PasesDeReservaYaRegistrados si otro proceso lo guardó antes */
  registrar(pases: PasesDeReserva): Promise<void>;
  /** Guarda los pases para la app del guardia. Nunca sobrescribe uno existente: repetirlo no duplica ni revive nada. */
  guardarPases(fecha: string, pases: readonly PaseDeReserva[]): Promise<void>;
  /** Marca la reserva revocada y revoca sus pases vigentes (uno usado se queda usado, A3). @return cuántos revocó */
  revocar(revocada: PasesDeReserva): Promise<number>;
}
