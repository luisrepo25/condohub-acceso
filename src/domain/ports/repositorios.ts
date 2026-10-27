import type { Pase } from '../model/pase';
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
