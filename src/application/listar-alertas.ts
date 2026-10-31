import { DatoInvalido } from '@/domain/errores';
import type { AlertaVisitante } from '@/domain/model/alerta';
import type { FuenteAlertas } from './ports/alertas';

/** I4: las alertas que ve el guardia, de la más reciente a la más antigua; `desde` filtra por `creadaEn`. */
export class ListarAlertas {
  constructor(private readonly fuente: FuenteAlertas) {}

  async ejecutar(credencial: string, desde?: string): Promise<AlertaVisitante[]> {
    const limite = desde === undefined ? undefined : Date.parse(desde);
    if (limite !== undefined && Number.isNaN(limite)) throw new DatoInvalido('«desde» debe ser una fecha ISO-8601');
    const todas = await this.fuente.visitantesRecurrentes(credencial);
    return todas
      .filter((a) => limite === undefined || Date.parse(a.creadaEn) >= limite)
      .sort((a, b) => Date.parse(b.creadaEn) - Date.parse(a.creadaEn));
  }
}
