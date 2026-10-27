import { DatoInvalido, ReglaNegocioViolada } from '../errores';
import { normalizarPlaca } from '../value-objects/placa';
import { unidadCodigo } from '../value-objects/unidad';

export type Sentido = 'INGRESO' | 'SALIDA';
export type Categoria = 'PEATON' | 'VEHICULO';
export type Resultado = 'PERMITIDO' | 'RECHAZADO';

/** Lo que envía el guardia (contrato NuevoAcceso), ya con la forma validada. */
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
  readonly horaDispositivo: Date;
}

export interface DatosRegistro extends Omit<NuevoAcceso, 'resultado'> {
  readonly registroId: string;
  readonly resultado: Resultado;
  readonly guardiaSub: string;
  readonly horaServidor: Date;
  /** O6: por qué un ingreso sincronizado se registró sin gastar su pase (el ADMIN lo revisa). */
  readonly observacion?: string;
}

/**
 * Registro de acceso (A3): solo se agrega, nunca se edita; un error se corrige con otro registro que lo referencia
 * (`corrigeA`). La hora del dispositivo se guarda aparte de la del servidor (O1).
 */
export class RegistroAcceso {
  private constructor(readonly datos: DatosRegistro) {}

  /**
   * A2: un rechazo lleva motivo; un ingreso permitido necesita quién lo autoriza (un pase o la unidad que lo autoriza,
   * que con placa reconocida sale del vehículo, A4). La unidad, si viene, ya está resuelta por el caso de uso.
   */
  static registrar(
    nuevo: NuevoAcceso,
    extra: { registroId: string; guardiaSub: string; horaServidor: Date; observacion?: string },
  ): RegistroAcceso {
    const resultado = nuevo.resultado ?? 'PERMITIDO';
    const motivo = nuevo.motivo?.trim() || undefined;
    if (motivo && motivo.length > 300) throw new DatoInvalido('El motivo admite hasta 300 caracteres');
    if (nuevo.confianzaPlaca !== undefined && (nuevo.confianzaPlaca < 0 || nuevo.confianzaPlaca > 1)) {
      throw new DatoInvalido('confianzaPlaca debe estar entre 0 y 1');
    }
    if (nuevo.confianzaPlaca !== undefined && !nuevo.placa) throw new DatoInvalido('confianzaPlaca solo acompaña a una placa');
    if (resultado === 'RECHAZADO' && !motivo) {
      throw new ReglaNegocioViolada('A2', 'Un rechazo se registra con su motivo');
    }
    if (nuevo.sentido === 'INGRESO' && resultado === 'PERMITIDO' && !nuevo.paseCodigo && !nuevo.unidadCodigo) {
      throw new ReglaNegocioViolada('A2', 'Un ingreso sin pase necesita la unidad que lo autoriza');
    }
    return new RegistroAcceso({
      ...nuevo,
      unidadCodigo: nuevo.unidadCodigo ? unidadCodigo(nuevo.unidadCodigo) : undefined,
      placa: nuevo.placa ? normalizarPlaca(nuevo.placa) : undefined,
      motivo,
      resultado,
      ...extra,
    });
  }

  static reconstituir(datos: DatosRegistro): RegistroAcceso {
    return new RegistroAcceso(datos);
  }

  /** A1: solo un ingreso permitido con pase gasta su uso. Una salida o un rechazo no lo gastan. */
  consumePase(): boolean {
    return this.datos.sentido === 'INGRESO' && this.datos.resultado === 'PERMITIDO' && this.datos.paseCodigo !== undefined;
  }
}
