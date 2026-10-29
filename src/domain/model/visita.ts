import { DatoInvalido } from '../errores';
import type { Pase } from './pase';

/** Lo que anuncia el residente (contrato `NuevaVisita`). */
export interface NuevaVisita {
  readonly unidadCodigo: string;
  readonly nombre: string;
  readonly documento?: string;
  readonly fecha: string;
}

export interface Visita {
  readonly visitaId: string;
  readonly unidadCodigo: string;
  readonly nombre: string;
  readonly documento?: string;
  readonly fecha: string;
  readonly pase: Pase;
  readonly registradaPor: string;
  readonly creadaEn: string;
}

/** A1: ventana por defecto del pase (parámetros de negocio, no constantes: vienen de la configuración). */
export interface VentanaPase {
  readonly horaDesde: string;
  readonly horaHasta: string;
  readonly offset: string;
}

export interface ContextoVisita {
  readonly visitaId: string;
  readonly codigoPase: string;
  readonly creadaEn: string;
  readonly registradaPor: string;
  readonly ventana: VentanaPase;
}

function texto(o: Record<string, unknown>, campo: string, obligatorio: boolean, max: number): string | undefined {
  const v = o[campo];
  if (v === undefined || v === null) {
    if (obligatorio) throw new DatoInvalido(`${campo} es obligatorio`);
    return undefined;
  }
  if (typeof v !== 'string' || v.trim() === '') throw new DatoInvalido(`${campo} debe ser un texto no vacío`);
  if (v.trim().length > max) throw new DatoInvalido(`${campo} no puede pasar de ${max} caracteres`);
  return v.trim();
}

/** Valida la forma de lo recibido (HTTP 400 si no cumple). */
export function leerNuevaVisita(datos: unknown): NuevaVisita {
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) throw new DatoInvalido('La visita debe ser un objeto');
  const o = datos as Record<string, unknown>;
  const fecha = texto(o, 'fecha', true, 10) as string;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`))) {
    throw new DatoInvalido('fecha debe ser un día con formato yyyy-mm-dd');
  }
  return {
    unidadCodigo: texto(o, 'unidadCodigo', true, 20) as string,
    nombre: texto(o, 'nombre', true, 120) as string,
    documento: texto(o, 'documento', false, 30),
    fecha,
  };
}

/** A1: anunciar una visita emite un pase con ventana de validez y un solo uso. */
export function registrarVisita(nueva: NuevaVisita, c: ContextoVisita): Visita {
  const pase: Pase = {
    codigo: c.codigoPase,
    unidadCodigo: nueva.unidadCodigo,
    estado: 'VIGENTE',
    usos: 0,
    usosMaximos: 1,
    validoDesde: `${nueva.fecha}T${c.ventana.horaDesde}${c.ventana.offset}`,
    validoHasta: `${nueva.fecha}T${c.ventana.horaHasta}${c.ventana.offset}`,
    visitaId: c.visitaId,
    origen: 'VISITA',
    actualizadoEn: c.creadaEn,
  };
  return Object.freeze({
    visitaId: c.visitaId,
    unidadCodigo: nueva.unidadCodigo,
    nombre: nueva.nombre,
    documento: nueva.documento,
    fecha: nueva.fecha,
    pase,
    registradaPor: c.registradaPor,
    creadaEn: c.creadaEn,
  });
}
