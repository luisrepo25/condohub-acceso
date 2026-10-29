import type { Pase } from '@/domain/model/pase';
import type { Visita } from '@/domain/model/visita';

export interface ResultadoVisita {
  /** false cuando la `Idempotency-Key` ya existía: `respuesta` es la de la primera vez (O3). */
  readonly creada: boolean;
  readonly respuesta: Visita;
}

/** Guarda la visita y su pase en una sola transacción, con la clave de idempotencia (O3). */
export interface VisitaRepositorio {
  guardar(visita: Visita, idempotencyKey: string): Promise<ResultadoVisita>;
}

export interface PaseRepositorio {
  obtener(codigo: string): Promise<Pase | undefined>;
  /** Pases cuya ventana empieza el día `fecha` (yyyy-mm-dd, en la zona del condominio). */
  delDia(fecha: string): Promise<Pase[]>;
}

/** F1: las unidades de las que quien llama es titular o residente. Lo sabe Gestión (otro contexto): se pregunta por API. */
export interface UnidadesDelSolicitante {
  codigos(credencial: string): Promise<string[]>;
}
