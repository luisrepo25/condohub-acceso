import { DatoInvalido } from '../errores';

/**
 * Conversión entre la hora local del condominio y instantes UTC, con `Intl` (sin librerías). Las ventanas de los pases
 * (A1: 07:00–23:59) son hora local; se guardan como instantes UTC.
 */

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` real (no 2026-02-30). */
export function exigirFecha(fecha: string): void {
  const m = FECHA.exec(fecha);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!d || d.toISOString().slice(0, 10) !== fecha) throw new DatoInvalido(`Fecha inválida: '${fecha}' (YYYY-MM-DD)`);
}

/** Fecha local (`YYYY-MM-DD`) de un instante en la zona dada. */
export function fechaLocal(instante: Date, zona: string): string {
  const p = partes(instante, zona);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Instante UTC de una fecha y hora (`HH:MM:SS`) locales de la zona dada. */
export function instanteLocal(fecha: string, hora: string, zona: string): Date {
  exigirFecha(fecha);
  const [h = 0, mi = 0, s = 0] = hora.split(':').map(Number);
  const [y, mo, d] = fecha.split('-').map(Number) as [number, number, number];
  const comoUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  // Dos pasadas: la diferencia horaria de la zona en ese instante (sirve también con horario de verano).
  let instante = comoUtc - desfase(new Date(comoUtc), zona);
  instante = comoUtc - desfase(new Date(instante), zona);
  return new Date(instante);
}

/** Milisegundos que la hora local de la zona va por delante de UTC en ese instante (La Paz: -4 h). */
function desfase(instante: Date, zona: string): number {
  const p = partes(instante, zona);
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return local - Math.floor(instante.getTime() / 1000) * 1000;
}

function partes(instante: Date, zona: string): Record<string, string> {
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(formato.formatToParts(instante).map((p) => [p.type, p.value]));
}
