import { ReglaNegocioViolada } from '../errores';
import { instanteLocal } from '../value-objects/hora-local';
import type { ParametrosAcceso } from '../value-objects/parametros';

/** Estado guardado; VENCIDO no se guarda: se deduce de la ventana. */
export type EstadoGuardado = 'VIGENTE' | 'USADO' | 'REVOCADO';
export type EstadoPase = EstadoGuardado | 'VENCIDO';
export type MotivoRechazo = 'VENCIDO' | 'USADO' | 'REVOCADO' | 'NO_EXISTE' | 'AUN_NO_VALIDO';
export type Evaluacion = { valido: true } | { valido: false; motivo: MotivoRechazo };

export interface DatosPase {
  readonly codigo: string;
  readonly visitaId?: string;
  readonly unidadCodigo: string;
  readonly estado: EstadoGuardado;
  readonly usos: number;
  readonly usosMaximos: number;
  readonly validoDesde: Date;
  readonly validoHasta: Date;
  readonly origen: 'VISITA' | 'RESERVA';
  /** Paso 3 de la saga: la reserva y el invitado de un pase de origen RESERVA. */
  readonly reservaId?: string;
  readonly invitadoId?: string;
}

/**
 * Pase QR (A1, A2): ventana de validez y un solo uso de ingreso. Validarlo solo consulta; el uso se consume al
 * registrar el ingreso (A2). Inmutable: `consumir` devuelve el pase nuevo.
 */
export class Pase {
  private constructor(readonly datos: DatosPase) {}

  /** A1: pase de una visita, válido el día indicado en la ventana por defecto (hora local) y de un solo uso. */
  static emitirParaVisita(codigo: string, visitaId: string, unidadCodigo: string, fecha: string, p: ParametrosAcceso): Pase {
    return new Pase({
      codigo,
      visitaId,
      unidadCodigo,
      estado: 'VIGENTE',
      usos: 0,
      usosMaximos: 1,
      validoDesde: instanteLocal(fecha, p.ventanaDesde, p.zonaHoraria),
      validoHasta: instanteLocal(fecha, p.ventanaHasta, p.zonaHoraria),
      origen: 'VISITA',
    });
  }

  /**
   * Paso 3 de la saga: pase de un invitado de una reserva, con la misma ventana y el mismo único uso que el de una
   * visita (A1) para el día de la reserva.
   */
  static emitirParaReserva(
    codigo: string,
    invitado: { reservaId: string; invitadoId: string },
    unidadCodigo: string,
    fecha: string,
    p: ParametrosAcceso,
  ): Pase {
    return new Pase({
      codigo,
      unidadCodigo,
      estado: 'VIGENTE',
      usos: 0,
      usosMaximos: 1,
      validoDesde: instanteLocal(fecha, p.ventanaDesde, p.zonaHoraria),
      validoHasta: instanteLocal(fecha, p.ventanaHasta, p.zonaHoraria),
      origen: 'RESERVA',
      reservaId: invitado.reservaId,
      invitadoId: invitado.invitadoId,
    });
  }

  static reconstituir(datos: DatosPase): Pase {
    return new Pase(datos);
  }

  get codigo(): string {
    return this.datos.codigo;
  }

  /** Estado visible: un pase vigente fuera de su ventana está VENCIDO. */
  estadoEn(ahora: Date): EstadoPase {
    if (this.datos.estado === 'VIGENTE' && ahora > this.datos.validoHasta) return 'VENCIDO';
    return this.datos.estado;
  }

  /** A2: si el pase sirve ahora para ingresar, y si no, por qué. No cambia nada. */
  evaluar(ahora: Date): Evaluacion {
    if (this.datos.estado === 'REVOCADO') return { valido: false, motivo: 'REVOCADO' };
    if (this.datos.estado === 'USADO' || this.datos.usos >= this.datos.usosMaximos) return { valido: false, motivo: 'USADO' };
    if (ahora > this.datos.validoHasta) return { valido: false, motivo: 'VENCIDO' };
    if (ahora < this.datos.validoDesde) return { valido: false, motivo: 'AUN_NO_VALIDO' };
    return { valido: true };
  }

  /** Compensación del paso 3: un pase vigente queda REVOCADO (A2). Uno usado o ya revocado no cambia (A3). */
  revocar(): Pase {
    return this.datos.estado === 'VIGENTE' ? new Pase({ ...this.datos, estado: 'REVOCADO' }) : this;
  }

  /** A1, A2: consume un uso de ingreso. Lanza A2 con el motivo si el pase no sirve. */
  consumir(ahora: Date): Pase {
    const evaluacion = this.evaluar(ahora);
    if (!evaluacion.valido) {
      throw new ReglaNegocioViolada('A2', `El pase no permite el ingreso: ${evaluacion.motivo}`, { motivo: evaluacion.motivo });
    }
    const usos = this.datos.usos + 1;
    return new Pase({ ...this.datos, usos, estado: usos >= this.datos.usosMaximos ? 'USADO' : 'VIGENTE' });
  }
}
