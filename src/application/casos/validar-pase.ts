import type { PaseRepository } from '@/domain/ports/repositorios';
import { paseJson } from '../presentacion';
import type { Reloj } from '../ports/servicios';

export interface DepsValidarPase {
  readonly pases: PaseRepository;
  readonly reloj: Reloj;
}

/**
 * A2: el guardia escanea un QR y sabe si sirve para ingresar ahora y, si no, por qué. **Solo consulta**: el uso se
 * consume al registrar el ingreso, así un escaneo repetido no gasta el pase.
 */
export async function validarPase(deps: DepsValidarPase, codigo: string) {
  const pase = await deps.pases.porCodigo(codigo.trim());
  if (!pase) return { valido: false, motivo: 'NO_EXISTE' as const };
  const ahora = deps.reloj.ahora();
  const evaluacion = pase.evaluar(ahora);
  return { ...evaluacion, pase: paseJson(pase, ahora) };
}
