import type { AlertaVisitante } from '@/domain/model/alerta';

/** Puerto hacia quien detecta los visitantes recurrentes (hoy el Servicio IA). Devuelve conceptos de Acceso, nunca los de la IA. */
export interface FuenteAlertas {
  visitantesRecurrentes(credencial: string): Promise<AlertaVisitante[]>;
}
