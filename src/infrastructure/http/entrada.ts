import type { OperacionSync } from '@/application/casos/sincronizar-lote';
import { DatoInvalido } from '@/domain/errores';
import type { NuevoAcceso } from '@/domain/model/registro-acceso';
import type { SolicitudVisita } from '@/domain/model/visita';

/**
 * Validación de la forma de las peticiones (contracts/openapi/acceso.yaml). Solo la forma: las reglas de negocio las
 * aplica el dominio. Cualquier error es DatoInvalido (HTTP 400).
 */

type Objeto = Record<string, unknown>;

const FECHA_HORA_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

export async function cuerpoJson(request: Request): Promise<Objeto> {
  const cuerpo: unknown = await request.json().catch(() => {
    throw new DatoInvalido('El cuerpo debe ser JSON');
  });
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new DatoInvalido('El cuerpo debe ser un objeto JSON');
  return cuerpo as Objeto;
}

/** El token del header Authorization (ya validado por `proteger`): se reenvía a Gestión para F1. */
export function tokenDe(request: Request): string {
  return (request.headers.get('authorization') ?? '').split(' ')[1] ?? '';
}

function texto(o: Objeto, campo: string, max: number, requerido: true): string;
function texto(o: Objeto, campo: string, max: number, requerido?: false): string | undefined;
function texto(o: Objeto, campo: string, max: number, requerido = false): string | undefined {
  const v = o[campo];
  if (v === undefined || v === null) {
    if (requerido) throw new DatoInvalido(`Falta el campo ${campo}`);
    return undefined;
  }
  if (typeof v !== 'string') throw new DatoInvalido(`${campo} debe ser texto`);
  if (v.length > max) throw new DatoInvalido(`${campo} admite hasta ${max} caracteres`);
  return v;
}

function opcion<T extends string>(o: Objeto, campo: string, valores: readonly T[], requerido: boolean): T | undefined {
  const v = o[campo];
  if (v === undefined || v === null) {
    if (requerido) throw new DatoInvalido(`Falta el campo ${campo}`);
    return undefined;
  }
  if (typeof v !== 'string' || !(valores as readonly string[]).includes(v)) {
    throw new DatoInvalido(`${campo} debe ser uno de: ${valores.join(', ')}`);
  }
  return v as T;
}

export function solicitudVisita(o: Objeto): SolicitudVisita {
  return {
    unidadCodigo: texto(o, 'unidadCodigo', 20, true),
    nombre: texto(o, 'nombre', 120, true),
    documento: texto(o, 'documento', 30),
    fecha: texto(o, 'fecha', 10, true),
  };
}

export function codigoDePase(o: Objeto): string {
  const codigo = texto(o, 'codigo', 100, true).trim();
  if (codigo === '') throw new DatoInvalido('Falta el campo codigo');
  return codigo;
}

/** Parámetro de consulta `desde` (fecha ISO-8601 con zona), opcional. */
export function desdeDe(request: Request): Date | undefined {
  const valor = new URL(request.url).searchParams.get('desde');
  if (valor === null || valor === '') return undefined;
  if (!FECHA_HORA_CON_ZONA.test(valor) || Number.isNaN(Date.parse(valor))) {
    throw new DatoInvalido('desde debe ser una fecha ISO-8601 con zona, ej. 2026-10-27T00:00:00Z');
  }
  return new Date(valor);
}

/** Máximo de operaciones por lote de `POST /api/sync`: la PWA envía su cola en partes. */
export const MAXIMO_OPERACIONES = 100;

/**
 * Forma del lote (contrato LoteSync). El lote mal formado es 400 entero; los `datos` de cada operación se leen al
 * procesarla, así una operación mal formada responde 400 sola y no frena a las demás.
 */
export function loteSync(o: Objeto): OperacionSync[] {
  const operaciones = o.operaciones;
  if (!Array.isArray(operaciones) || operaciones.length === 0) throw new DatoInvalido('operaciones debe ser una lista con al menos una operación');
  if (operaciones.length > MAXIMO_OPERACIONES) throw new DatoInvalido(`Un lote admite hasta ${MAXIMO_OPERACIONES} operaciones`);
  return operaciones.map((op, i) => {
    if (typeof op !== 'object' || op === null || Array.isArray(op)) throw new DatoInvalido(`La operación ${i} debe ser un objeto`);
    const operacion = op as Objeto;
    const clave = texto(operacion, 'idempotencyKey', 60, true);
    if (operacion.tipo !== 'ACCESO') throw new DatoInvalido(`La operación ${i}: tipo debe ser ACCESO`);
    const datos = operacion.datos;
    return {
      idempotencyKey: clave,
      datos: () => {
        if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) throw new DatoInvalido('datos debe ser un objeto');
        return nuevoAcceso(datos as Objeto);
      },
    };
  });
}

export function nuevoAcceso(o: Objeto): NuevoAcceso {
  const hora = texto(o, 'horaDispositivo', 40, true);
  if (!FECHA_HORA_CON_ZONA.test(hora) || Number.isNaN(Date.parse(hora))) {
    throw new DatoInvalido('horaDispositivo debe ser una fecha ISO-8601 con zona, ej. 2026-10-27T14:00:00-04:00');
  }
  const confianza = o.confianzaPlaca;
  if (confianza !== undefined && confianza !== null && (typeof confianza !== 'number' || !Number.isFinite(confianza))) {
    throw new DatoInvalido('confianzaPlaca debe ser un número');
  }
  return {
    sentido: opcion(o, 'sentido', ['INGRESO', 'SALIDA'] as const, true)!,
    categoria: opcion(o, 'categoria', ['PEATON', 'VEHICULO'] as const, true)!,
    unidadCodigo: texto(o, 'unidadCodigo', 20),
    paseCodigo: texto(o, 'paseCodigo', 100),
    placa: texto(o, 'placa', 20),
    confianzaPlaca: typeof confianza === 'number' ? confianza : undefined,
    resultado: opcion(o, 'resultado', ['PERMITIDO', 'RECHAZADO'] as const, false),
    motivo: texto(o, 'motivo', 300),
    corrigeA: texto(o, 'corrigeA', 100),
    horaDispositivo: new Date(hora),
  };
}
