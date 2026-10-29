import type { Pase } from '../model/pase';
import type { PasesDeReserva } from '../model/pases-de-reserva';
import type { RegistroAcceso } from '../model/registro-acceso';
import type { Visita } from '../model/visita';
import type { VehiculoRegistrado } from '../services/politica-placas';

/**
 * O3: la respuesta de una operación hecha con una Idempotency-Key. Se guarda en la misma escritura que la operación;
 * repetir la clave devuelve exactamente esta respuesta (mismo código y cuerpo).
 */
export interface RespuestaGuardada {
  readonly clave: string;
  /** Quién la hizo: la clave de otra persona no devuelve su respuesta. */
  readonly sub: string;
  readonly codigoHttp: number;
  readonly cuerpo: unknown;
}

/** O3: otra petición con la misma Idempotency-Key se guardó antes (dos reintentos a la vez). */
export class ClaveYaUsada extends Error {
  constructor() {
    super('La Idempotency-Key ya se usó');
    this.name = 'ClaveYaUsada';
  }
}

/** A2: el pase cambió entre leerlo y consumirlo (otro guardia lo usó o se revocó). */
export class PaseYaNoDisponible extends Error {
  constructor() {
    super('El pase ya no está disponible');
    this.name = 'PaseYaNoDisponible';
  }
}

export interface RespuestasIdempotentes {
  buscar(clave: string): Promise<RespuestaGuardada | null>;
}

export interface VisitaRepository {
  /** Guarda la visita, su pase y la respuesta (O3) en una sola escritura. @throws ClaveYaUsada */
  registrar(visita: Visita, respuesta: RespuestaGuardada): Promise<void>;
}

export interface PaseRepository {
  porCodigo(codigo: string): Promise<Pase | null>;
  /**
   * O6: pases de un día local (vigentes, usados o revocados), para la copia sin conexión del guardia.
   *
   * @param desde solo los creados o cambiados desde ese instante (sincronización incremental)
   */
  delDia(fecha: string, desde?: Date): Promise<Pase[]>;
}

export interface RegistroAccesoRepository {
  existe(registroId: string): Promise<boolean>;
  /**
   * A3, O3: agrega el registro y la respuesta en una sola escritura y, si es un ingreso con pase, consume el pase solo
   * si sigue como se leyó (`antes`).
   *
   * @throws ClaveYaUsada · PaseYaNoDisponible
   */
  registrar(registro: RegistroAcceso, respuesta: RespuestaGuardada, consumo?: { antes: Pase; despues: Pase }): Promise<void>;
}

export interface VehiculoRepository {
  porPlaca(placa: string): Promise<VehiculoRegistrado | null>;
}

/** Paso 3 de la saga: otra emisión o revocación de la misma reserva se guardó antes. */
export class PasesDeReservaYaRegistrados extends Error {
  constructor() {
    super('Los pases de la reserva ya se registraron');
    this.name = 'PasesDeReservaYaRegistrados';
  }
}

export interface PasesDeReservaRepository {
  deLaReserva(reservaId: string): Promise<PasesDeReserva | null>;
  /** Guarda qué pase recibió cada invitado. @throws PasesDeReservaYaRegistrados si otro proceso lo guardó antes */
  registrar(pases: PasesDeReserva): Promise<void>;
  /**
   * Guarda los pases que falten (los ya guardados no se tocan): repetirlo no duplica nada.
   *
   * @param fecha día local de los pases (índice de los pases del día para la app del guardia)
   */
  guardarPases(fecha: string, pases: Pase[]): Promise<void>;
  /**
   * Guarda la reserva como revocada y revoca sus pases todavía vigentes (los usados no cambian, A3). Repetirlo no
   * cambia nada más: retoma una revocación que se cortó a mitad.
   *
   * @return cuántos pases se revocaron en esta llamada
   */
  revocar(revocada: PasesDeReserva): Promise<number>;
}
