import type { PlacaRegistrada } from '@/domain/model/placa';

export interface PlacaRepositorio {
  /** Solo las placas activas de vehículos de residentes. */
  activas(): Promise<PlacaRegistrada[]>;
}
