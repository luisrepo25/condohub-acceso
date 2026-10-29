import { DatoInvalido } from '@/domain/errores';
import type { Solicitante } from '@/domain/model/rol';
import type { RegistrarAcceso } from './registrar-acceso';
import { traducirError } from './traducir-error';

export interface ResultadoOperacion {
  readonly idempotencyKey: string;
  readonly codigo: number;
  readonly cuerpo: Record<string, unknown>;
}

function leerOperaciones(lote: unknown): Array<Record<string, unknown>> {
  const ops = (lote as { operaciones?: unknown } | null)?.operaciones;
  if (!Array.isArray(ops) || ops.length === 0) throw new DatoInvalido('operaciones debe ser una lista con al menos una operación');
  return ops.map((op) => {
    if (typeof op !== 'object' || op === null) throw new DatoInvalido('Cada operación debe ser un objeto');
    return op as Record<string, unknown>;
  });
}

/** O1-O4: aplica un lote hecho sin conexión; responde una entrada por operación con el código HTTP que habría tenido. */
export class SincronizarLote {
  constructor(private readonly registrar: RegistrarAcceso) {}

  async ejecutar(lote: unknown, solicitante: Solicitante): Promise<{ resultados: ResultadoOperacion[] }> {
    const resultados: ResultadoOperacion[] = [];
    for (const op of leerOperaciones(lote)) resultados.push(await this.aplicar(op, solicitante));
    return { resultados };
  }

  private async aplicar(op: Record<string, unknown>, solicitante: Solicitante): Promise<ResultadoOperacion> {
    const idempotencyKey = typeof op.idempotencyKey === 'string' ? op.idempotencyKey : '';
    try {
      if (op.tipo !== 'ACCESO') throw new DatoInvalido('tipo debe ser ACCESO');
      const { respuesta } = await this.registrar.ejecutar(op.datos, idempotencyKey, solicitante, { sinConexion: true });
      return { idempotencyKey, codigo: 201, cuerpo: { ...respuesta } };
    } catch (e) {
      const problema = traducirError(e);
      if (!problema) throw e;
      return { idempotencyKey, codigo: problema.status, cuerpo: { type: 'about:blank', ...problema } };
    }
  }
}
