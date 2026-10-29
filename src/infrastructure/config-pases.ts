import { randomBytes } from 'node:crypto';
import type { VentanaPase } from '@/domain/model/visita';

export interface ConfigPases {
  readonly gestionUrl: string;
  readonly ventana: VentanaPase;
  /** Desfase de la zona del condominio respecto de UTC, en minutos (La Paz = -240). */
  readonly desfaseMinutos: number;
}

/** Ventana por defecto del pase (A1) y zona del condominio: parámetros de negocio por variables de entorno. */
export function configPasesDesdeEntorno(env: Record<string, string | undefined> = process.env): ConfigPases {
  const desfaseMinutos = Number(env.ZONA_DESFASE_MINUTOS ?? -240);
  const signo = desfaseMinutos < 0 ? '-' : '+';
  const abs = Math.abs(desfaseMinutos);
  const offset = `${signo}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return {
    gestionUrl: env.GESTION_GRAPHQL_URL ?? 'http://localhost:8090/gestion/graphql',
    ventana: { horaDesde: env.PASE_HORA_DESDE ?? '07:00:00', horaHasta: env.PASE_HORA_HASTA ?? '23:59:59', offset },
    desfaseMinutos,
  };
}

/** Código del QR: 128 bits aleatorios, imposible de adivinar o de enumerar (A1). */
export function nuevoCodigoPase(): string {
  return `CH-${randomBytes(16).toString('base64url')}`;
}
