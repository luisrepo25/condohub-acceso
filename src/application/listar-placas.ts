import type { PlacaRegistrada } from '@/domain/model/placa';
import type { PlacaRepositorio } from './ports/placas';

/** A4, O6: la lista que la app del guardia descarga para comparar la placa leída, también sin conexión. */
export class ListarPlacas {
  constructor(private readonly placas: PlacaRepositorio) {}

  async ejecutar(): Promise<PlacaRegistrada[]> {
    const activas = await this.placas.activas();
    return [...activas].sort((a, b) => a.placa.localeCompare(b.placa));
  }
}
