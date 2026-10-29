import { DatoInvalido } from '@/domain/errores';
import { motivoPaseNoUsable, type MotivoPaseNoUsable, type Pase } from '@/domain/model/pase';
import type { PaseRepositorio } from './ports/pases';

export interface PaseValidado {
  readonly valido: boolean;
  readonly motivo?: MotivoPaseNoUsable;
  readonly pase?: Pase;
}

/** A2: informa si el pase sirve y, si no, por qué. NO lo consume: el uso se gasta al registrar el ingreso (decidido el 27/10). */
export class ValidarPase {
  constructor(
    private readonly pases: PaseRepositorio,
    private readonly reloj: () => Date,
  ) {}

  async ejecutar(datos: unknown): Promise<PaseValidado> {
    const codigo = (datos as { codigo?: unknown } | null)?.codigo;
    if (typeof codigo !== 'string' || codigo.trim() === '') throw new DatoInvalido('codigo es obligatorio');
    const pase = await this.pases.obtener(codigo.trim());
    const motivo = motivoPaseNoUsable(pase, this.reloj());
    return motivo ? { valido: false, motivo, ...(pase ? { pase } : {}) } : { valido: true, pase };
  }
}
