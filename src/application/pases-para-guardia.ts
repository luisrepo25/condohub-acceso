import { DatoInvalido } from '@/domain/errores';
import type { Pase } from '@/domain/model/pase';
import type { PaseRepositorio } from './ports/pases';

/** O6: pases de hoy y de mañana para que la app del guardia los valide sin conexión; `desde` trae solo lo cambiado. */
export class PasesParaGuardia {
  constructor(
    private readonly pases: PaseRepositorio,
    private readonly reloj: () => Date,
    /** Desfase de la zona del condominio respecto de UTC, en minutos (La Paz = -240). */
    private readonly desfaseMinutos: number,
  ) {}

  async ejecutar(desde?: string | null): Promise<Pase[]> {
    const limite = desde ? Date.parse(desde) : undefined;
    if (limite !== undefined && Number.isNaN(limite)) throw new DatoInvalido('desde debe ser una fecha y hora ISO-8601');
    const hoy = this.fechaLocal(0);
    const delDia = [...(await this.pases.delDia(hoy)), ...(await this.pases.delDia(this.fechaLocal(1)))];
    return delDia
      .filter((p) => limite === undefined || Date.parse(p.actualizadoEn ?? '') >= limite)
      .sort((a, b) => a.validoDesde.localeCompare(b.validoDesde) || a.codigo.localeCompare(b.codigo));
  }

  private fechaLocal(diasMas: number): string {
    const t = this.reloj().getTime() + this.desfaseMinutos * 60_000 + diasMas * 86_400_000;
    return new Date(t).toISOString().slice(0, 10);
  }
}
