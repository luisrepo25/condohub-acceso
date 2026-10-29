import { ConflictoDeClave, DatoInvalido, ReglaViolada } from '@/domain/errores';
import { leerNuevoAcceso, registrarAcceso, type RegistroAcceso } from '@/domain/model/registro-acceso';
import type { Solicitante } from '@/domain/model/rol';
import type { RegistroAccesoRepositorio, ResultadoGuardado } from './ports/registro-acceso-repositorio';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Un reloj de dispositivo adelantado más que esto no se cree: se evalúa el pase a la hora del servidor. */
const TOLERANCIA_RELOJ_MS = 5 * 60_000;

export interface OpcionesRegistro {
  /** O6: la operación se hizo sin conexión y llega al sincronizar (`POST /api/sync`). */
  readonly sinConexion?: boolean;
}

/** A3, O1-O3: registra un ingreso o una salida de forma idempotente. */
export class RegistrarAcceso {
  constructor(
    private readonly repositorio: RegistroAccesoRepositorio,
    private readonly reloj: () => Date,
    private readonly nuevoId: () => string,
  ) {}

  async ejecutar(datos: unknown, idempotencyKey: string, solicitante: Solicitante, opciones: OpcionesRegistro = {}): Promise<ResultadoGuardado> {
    if (!UUID_V4.test(idempotencyKey)) throw new DatoInvalido('Idempotency-Key debe ser un UUID v4');
    const ahora = this.reloj();
    const registro = registrarAcceso(leerNuevoAcceso(datos), {
      registroId: this.nuevoId(),
      horaServidor: ahora.toISOString(),
      guardiaSub: solicitante.sub,
    });
    const clave = idempotencyKey.toLowerCase();
    const resultado = opciones.sinConexion ? await this.guardarSinConexion(registro, clave, ahora) : await this.repositorio.guardar(registro, clave);
    // O3: repetir una clave ajena no devuelve la respuesta de otra persona.
    if (!resultado.creado && resultado.respuesta.guardiaSub !== solicitante.sub) throw new ConflictoDeClave();
    return resultado;
  }

  /**
   * O6: el pase se evalúa a la hora en que ocurrió el ingreso (la del dispositivo). Si al sincronizar ya no sirve (otro
   * guardia lo usó, se revocó), el ingreso se registra igual porque ya ocurrió (A3), sin gastar el pase y con una
   * observación para que el `ADMIN` lo revise.
   */
  private async guardarSinConexion(registro: RegistroAcceso, clave: string, ahora: Date): Promise<ResultadoGuardado> {
    try {
      return await this.repositorio.guardar(registro, clave, { instante: instanteDelIngreso(new Date(registro.horaDispositivo), ahora) });
    } catch (e) {
      if (!(e instanceof ReglaViolada) || e.codigo !== 'A2' || !registro.paseCodigo) throw e;
      const observacion = `O6: ingreso hecho sin conexión con un pase que al sincronizar ya no servía (${e.message}); se registra sin gastarlo`;
      return this.repositorio.guardar({ ...registro, observacion }, clave, { sinConsumirPase: true });
    }
  }
}

function instanteDelIngreso(horaDispositivo: Date, ahora: Date): Date {
  return horaDispositivo.getTime() > ahora.getTime() + TOLERANCIA_RELOJ_MS ? ahora : horaDispositivo;
}
