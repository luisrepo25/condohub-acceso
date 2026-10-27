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

/**
 * A3: el guardia registra un ingreso o una salida (solo se agrega). Un ingreso permitido con pase lo consume con una
 * escritura condicional (A1, A2: dos guardias no lo usan dos veces); sin pase lo autoriza una unidad, indicada por el
 * guardia o deducida de una placa de residente bien leída (A4). Idempotente por Idempotency-Key (O1–O3).
 */
export async function registrarAcceso(
  deps: DepsRegistrarAcceso,
  solicitante: Solicitante,
  claveCruda: string | null,
  nuevo: NuevoAcceso,
): Promise<Respuesta> {
  const clave = idempotencyKey(claveCruda);
  return idempotente(deps.respuestas, clave, solicitante, async () => {
    if (nuevo.corrigeA && !(await deps.registros.existe(nuevo.corrigeA))) {
      throw new ReglaNegocioViolada('A3', `No existe el registro ${nuevo.corrigeA} que se quiere corregir`);
    }
    const ahora = deps.reloj.ahora();
    const autorizado = await autorizacion(deps, nuevo, ahora);
    const registro = RegistroAcceso.registrar(autorizado.nuevo, { registroId: deps.ids.id(), guardiaSub: solicitante.sub, horaServidor: ahora });
    const respuesta = { codigoHttp: 201, cuerpo: registroJson(registro) };
    try {
      await deps.registros.registrar(registro, { clave, sub: solicitante.sub, ...respuesta }, autorizado.consumo);
    } catch (e) {
      if (e instanceof PaseYaNoDisponible) {
        throw new ReglaNegocioViolada('A2', 'El pase se usó o se revocó mientras tanto', { motivo: 'USADO' });
      }
      throw e;
    }
    return respuesta;
  });
}

/** Quién autoriza el ingreso: el pase (que se consume), la unidad indicada o la de la placa reconocida (A4). */
async function autorizacion(
  deps: DepsRegistrarAcceso,
  nuevo: NuevoAcceso,
  ahora: Date,
): Promise<{ nuevo: NuevoAcceso; consumo?: { antes: Pase; despues: Pase } }> {
  const ingresoPermitido = nuevo.sentido === 'INGRESO' && (nuevo.resultado ?? 'PERMITIDO') === 'PERMITIDO';
  if (!ingresoPermitido) return { nuevo };

  if (nuevo.paseCodigo) {
    const pase = await deps.pases.porCodigo(nuevo.paseCodigo);
    if (!pase) throw new ReglaNegocioViolada('A2', 'El pase no existe', { motivo: 'NO_EXISTE' });
    const despues = pase.consumir(ahora);
    // Con pase, la unidad que autoriza es la del pase (no la que escriba el guardia).
    return { nuevo: { ...nuevo, unidadCodigo: pase.datos.unidadCodigo }, consumo: { antes: pase, despues } };
  }
  if (!nuevo.unidadCodigo && nuevo.placa) {
    const vehiculo = await deps.vehiculos.porPlaca(normalizarPlaca(nuevo.placa));
    return { nuevo: { ...nuevo, unidadCodigo: unidadPorPlaca(vehiculo, nuevo.confianzaPlaca, deps.parametros.confianzaPlacaMinima) } };
  }
  return { nuevo };
}
