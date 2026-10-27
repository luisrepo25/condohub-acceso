import { ReglaNegocioViolada } from '../errores';

/** Vehículo registrado de un residente (`PLACA#<placa>`). */
export interface VehiculoRegistrado {
  readonly placa: string;
  readonly unidadCodigo: string;
  readonly activa: boolean;
}

/**
 * A4: una placa de residente leída con confianza ≥ el mínimo permite el ingreso, autorizado por su unidad. Por debajo,
 * sin coincidencia o con un vehículo dado de baja, decide el guardia: debe indicar la unidad que autoriza (A2).
 * Una placa no registrada nunca se permite sola.
 *
 * @returns la unidad que autoriza el ingreso
 */
export function unidadPorPlaca(vehiculo: VehiculoRegistrado | null, confianza: number | undefined, minima: number): string {
  if (!vehiculo || !vehiculo.activa) {
    throw new ReglaNegocioViolada('A4', 'La placa no es de un residente: el guardia debe indicar la unidad que autoriza');
  }
  if (confianza === undefined || confianza < minima) {
    throw new ReglaNegocioViolada(
      'A4',
      `La lectura de la placa tiene confianza ${confianza ?? 'desconocida'} (mínimo ${minima}): el guardia debe indicar la unidad`,
    );
  }
  return vehiculo.unidadCodigo;
}
