import { ReglaNegocioViolada } from '@/domain/errores';
import type { Pase } from '@/domain/model/pase';
import { type NuevoAcceso, RegistroAcceso } from '@/domain/model/registro-acceso';
import type { Solicitante } from '@/domain/model/rol';
import {
  type PaseRepository,
  PaseYaNoDisponible,
  type RegistroAccesoRepository,
  type RespuestasIdempotentes,
  type VehiculoRepository,
} from '@/domain/ports/repositorios';
import { unidadPorPlaca } from '@/domain/services/politica-placas';
import { idempotencyKey } from '@/domain/value-objects/idempotency-key';
import type { ParametrosAcceso } from '@/domain/value-objects/parametros';
import { normalizarPlaca } from '@/domain/value-objects/placa';
import { idempotente, type Respuesta } from '../idempotencia';
import { registroJson } from '../presentacion';
import type { GeneradorIds, Reloj } from '../ports/servicios';

export interface DepsRegistrarAcceso {
  readonly registros: RegistroAccesoRepository;
  readonly pases: PaseRepository;
  readonly vehiculos: VehiculoRepository;
  readonly respuestas: RespuestasIdempotentes;
  readonly reloj: Reloj;
  readonly ids: GeneradorIds;
  readonly parametros: ParametrosAcceso;
}

export interface OpcionesRegistro {
  /** O6: la operación se hizo sin conexión y llega al sincronizar (`POST /api/sync`). */
  readonly sinConexion?: boolean;
}

/** Un reloj de dispositivo adelantado más que esto no se cree: se usa la hora del servidor. */
const TOLERANCIA_RELOJ_MS = 5 * 60_000;

interface Autorizacion {
  readonly nuevo: NuevoAcceso;
  readonly consumo?: { antes: Pase; despues: Pase };
  readonly observacion?: string;
}

/**
 * A3: el guardia registra un ingreso o una salida (solo se agrega). Un ingreso permitido con pase lo consume con una
 * escritura condicional (A1, A2: dos guardias no lo usan dos veces); sin pase lo autoriza una unidad, indicada por el
 * guardia o deducida de una placa de residente bien leída (A4). Idempotente por Idempotency-Key (O1–O3).
 *
 * Sin conexión (O6) el pase se evalúa a la hora en que ocurrió el ingreso (la del dispositivo) y, si al sincronizar ya
 * no sirve, el ingreso se registra igual (ya ocurrió, A3) sin gastar el pase y con una observación para el ADMIN.
 */
export async function registrarAcceso(
  deps: DepsRegistrarAcceso,
  solicitante: Solicitante,
  claveCruda: string | null,
  nuevo: NuevoAcceso,
  opciones: OpcionesRegistro = {},
): Promise<Respuesta> {
  const clave = idempotencyKey(claveCruda);
  const sinConexion = opciones.sinConexion === true;
  return idempotente(deps.respuestas, clave, solicitante, async () => {
    if (nuevo.corrigeA && !(await deps.registros.existe(nuevo.corrigeA))) {
      throw new ReglaNegocioViolada('A3', `No existe el registro ${nuevo.corrigeA} que se quiere corregir`);
    }
    const ahora = deps.reloj.ahora();
    const instante = sinConexion ? instanteDelIngreso(nuevo.horaDispositivo, ahora) : ahora;
    const autorizado = await autorizacion(deps, nuevo, instante, sinConexion);
    try {
      return await guardar(deps, solicitante, clave, autorizado, ahora);
    } catch (e) {
      if (!(e instanceof PaseYaNoDisponible)) throw e;
      if (!sinConexion) throw new ReglaNegocioViolada('A2', 'El pase se usó o se revocó mientras tanto', { motivo: 'USADO' });
      // Otro guardia lo usó mientras se sincronizaba: el ingreso ya ocurrió y se registra igual, sin gastar el pase.
      return guardar(deps, solicitante, clave, { nuevo: autorizado.nuevo, observacion: observacionSinConexion('USADO') }, ahora);
    }
  });
}

async function guardar(
  deps: DepsRegistrarAcceso,
  solicitante: Solicitante,
  clave: string,
  autorizado: Autorizacion,
  ahora: Date,
): Promise<Respuesta> {
  const registro = RegistroAcceso.registrar(autorizado.nuevo, {
    registroId: deps.ids.id(),
    guardiaSub: solicitante.sub,
    horaServidor: ahora,
    observacion: autorizado.observacion,
  });
  const respuesta = { codigoHttp: 201, cuerpo: registroJson(registro) };
  await deps.registros.registrar(registro, { clave, sub: solicitante.sub, ...respuesta }, autorizado.consumo);
  return respuesta;
}

/** Quién autoriza el ingreso: el pase (que se consume), la unidad indicada o la de la placa reconocida (A4). */
async function autorizacion(deps: DepsRegistrarAcceso, nuevo: NuevoAcceso, instante: Date, sinConexion: boolean): Promise<Autorizacion> {
  const ingresoPermitido = nuevo.sentido === 'INGRESO' && (nuevo.resultado ?? 'PERMITIDO') === 'PERMITIDO';
  if (!ingresoPermitido) return { nuevo };

  if (nuevo.paseCodigo) {
    const pase = await deps.pases.porCodigo(nuevo.paseCodigo);
    const evaluacion = pase ? pase.evaluar(instante) : ({ valido: false, motivo: 'NO_EXISTE' } as const);
    if (!pase || !evaluacion.valido) {
      const motivo = evaluacion.valido ? 'NO_EXISTE' : evaluacion.motivo;
      if (!sinConexion) {
        throw new ReglaNegocioViolada('A2', motivo === 'NO_EXISTE' ? 'El pase no existe' : `El pase no permite el ingreso: ${motivo}`, { motivo });
      }
      return { nuevo: { ...nuevo, unidadCodigo: pase?.datos.unidadCodigo ?? nuevo.unidadCodigo }, observacion: observacionSinConexion(motivo) };
    }
    // Con pase, la unidad que autoriza es la del pase (no la que escriba el guardia).
    return { nuevo: { ...nuevo, unidadCodigo: pase.datos.unidadCodigo }, consumo: { antes: pase, despues: pase.consumir(instante) } };
  }
  if (!nuevo.unidadCodigo && nuevo.placa) {
    const vehiculo = await deps.vehiculos.porPlaca(normalizarPlaca(nuevo.placa));
    return { nuevo: { ...nuevo, unidadCodigo: unidadPorPlaca(vehiculo, nuevo.confianzaPlaca, deps.parametros.confianzaPlacaMinima) } };
  }
  return { nuevo };
}

/** O6: el ingreso sin conexión se evalúa cuando ocurrió, salvo que el reloj del dispositivo esté adelantado. */
function instanteDelIngreso(horaDispositivo: Date, ahora: Date): Date {
  return horaDispositivo.getTime() > ahora.getTime() + TOLERANCIA_RELOJ_MS ? ahora : horaDispositivo;
}

function observacionSinConexion(motivo: string): string {
  return `O6: ingreso hecho sin conexión con un pase que al sincronizar ya no servía (${motivo}); se registra sin gastarlo`;
}
