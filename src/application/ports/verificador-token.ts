import type { Solicitante } from '@/domain/model/rol';

export interface VerificadorToken {
  /** Devuelve el solicitante o lanza `TokenInvalido` / `ServicioDeIdentidadNoDisponible`. */
  verificar(token: string): Promise<Solicitante>;
}