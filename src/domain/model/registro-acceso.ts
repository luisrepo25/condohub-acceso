import { DatoInvalido, ReglaViolada } from '../errores';

export const SENTIDOS = ['INGRESO', 'SALIDA'] as const;
export const CATEGORIAS = ['PEATON', 'VEHICULO'] as const;
export const RESULTADOS = ['PERMITIDO', 'RECHAZADO'] as const;
export type Sentido = (typeof SENTIDOS)[number];
export type Categoria = (typeof CATEGORIAS)[number];
export type Resultado = (typeof RESULTADOS)[number];

/** Lo que envía el guardia (contrato `NuevoAcceso`). */
export interface NuevoAcceso {
  readonly sentido: Sentido;
  readonly categoria: Categoria;
  readonly unidadCodigo?: string;
  readonly paseCodigo?: string;
  readonly placa?: string;
  readonly confianzaPlaca?: number;
  readonly resultado?: Resultado;
  readonly motivo?: string;
  readonly corrigeA?: string;
  readonly horaDispositivo: string;
}

/** A3: un registro solo se agrega; es inmutable y un error se corrige con otro que lo referencia (`corrigeA`). */
export interface RegistroAcceso extends Omit<NuevoAcceso, 'resultado'> {
  readonly resultado: Resultado;
  readonly registroId: string;
  readonly horaServidor: string;
  readonly guardiaSub: string;
  /** O6: solo al sincronizar un ingreso sin conexión cuyo pase ya no servía; para que el ADMIN lo revise. */
  readonly observacion?: string;
}

export interface ContextoRegistro {
  readonly registroId: string;
  readonly horaServidor: string;
  readonly guardiaSub: string;
}

function opcional(o: Record<string, unknown>, campo: string): string | undefined {
  const v = o[campo];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || v.trim() === '') throw new DatoInvalido(`${campo} debe ser un texto no vacío`);
  return v.trim();
}

function enumerado<T extends string>(o: Record<string, unknown>, campo: string, validos: readonly T[]): T {
  const v = o[campo];
  if (typeof v !== 'string' || !(validos as readonly string[]).includes(v)) {
    throw new DatoInvalido(`${campo} debe ser uno de: ${validos.join(', ')}`);
  }
  return v as T;
}

function confianza(o: Record<string, unknown>): number | undefined {
  const v = o.confianzaPlaca;
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !(v >= 0 && v <= 1)) throw new DatoInvalido('confianzaPlaca debe estar entre 0 y 1');
  return v;
}

/** A4: la placa se compara tal cual contra la lista, en mayúsculas y sin separadores. */
function normalizarPlaca(placa: string | undefined): string | undefined {
  return placa?.toUpperCase().replace(/[\s-]/g, '');
}

/** Valida la forma de lo recibido (HTTP 400 si no cumple). */
export function leerNuevoAcceso(datos: unknown): NuevoAcceso {
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) throw new DatoInvalido('El registro debe ser un objeto');
  const o = datos as Record<string, unknown>;
  const hora = opcional(o, 'horaDispositivo');
  if (!hora || Number.isNaN(Date.parse(hora))) throw new DatoInvalido('horaDispositivo debe ser una fecha y hora ISO-8601');
  return {
    sentido: enumerado(o, 'sentido', SENTIDOS),
    categoria: enumerado(o, 'categoria', CATEGORIAS),
    unidadCodigo: opcional(o, 'unidadCodigo'),
    paseCodigo: opcional(o, 'paseCodigo'),
    placa: normalizarPlaca(opcional(o, 'placa')),
    confianzaPlaca: confianza(o),
    resultado: o.resultado === undefined ? undefined : enumerado(o, 'resultado', RESULTADOS),
    motivo: opcional(o, 'motivo'),
    corrigeA: opcional(o, 'corrigeA'),
    horaDispositivo: hora,
  };
}

/** Aplica las reglas A2 y crea el registro inmutable (HTTP 422 si una regla lo impide). */
export function registrarAcceso(nuevo: NuevoAcceso, contexto: ContextoRegistro): RegistroAcceso {
  const resultado = nuevo.resultado ?? 'PERMITIDO';
  if (resultado === 'RECHAZADO' && !nuevo.motivo) throw new ReglaViolada('A2', 'Un rechazo debe indicar el motivo');
  if (!nuevo.paseCodigo && !nuevo.placa && !nuevo.unidadCodigo) {
    throw new ReglaViolada('A2', 'Sin pase ni placa, el guardia debe indicar la unidad que autoriza');
  }
  return Object.freeze({ ...nuevo, resultado, ...contexto });
}
