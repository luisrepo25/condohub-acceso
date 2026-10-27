import { DatoInvalido, ReglaNegocioViolada } from '../errores';
import { exigirFecha, fechaLocal } from '../value-objects/hora-local';
import type { ParametrosAcceso } from '../value-objects/parametros';
import { unidadCodigo } from '../value-objects/unidad';
import { Pase } from './pase';

export interface DatosVisita {
  readonly visitaId: string;
  readonly unidadCodigo: string;
  readonly nombre: string;
  readonly documento?: string;
  readonly fecha: string;
  readonly registradaPor: string;
  readonly creadaEn: Date;
}

export interface SolicitudVisita {
  readonly unidadCodigo: string;
  readonly nombre: string;
  readonly documento?: string;
  readonly fecha: string;
}

/** Visita (A1): una persona que un residente anuncia para un día; nace con su pase QR. */
export class Visita {
  private constructor(
    readonly datos: DatosVisita,
    readonly pase: Pase,
  ) {}

  /**
   * A1: registra la visita y emite su pase. La fecha es el día local del condominio y no puede haber pasado: un pase
   * de ayer nacería vencido.
   */
  static registrar(
    s: SolicitudVisita,
    ids: { visitaId: string; codigoPase: string },
    registradaPor: string,
    ahora: Date,
    p: ParametrosAcceso,
  ): Visita {
    const nombre = s.nombre.trim();
    const documento = s.documento?.trim() || undefined;
    if (nombre === '' || nombre.length > 120) throw new DatoInvalido('El nombre de la visita es obligatorio y admite hasta 120 caracteres');
    if (documento && documento.length > 30) throw new DatoInvalido('El documento admite hasta 30 caracteres');
    exigirFecha(s.fecha);
    if (s.fecha < fechaLocal(ahora, p.zonaHoraria)) {
      throw new ReglaNegocioViolada('A1', `La fecha ${s.fecha} ya pasó: el pase nacería vencido`);
    }
    const unidad = unidadCodigo(s.unidadCodigo);
    const datos: DatosVisita = { visitaId: ids.visitaId, unidadCodigo: unidad, nombre, documento, fecha: s.fecha, registradaPor, creadaEn: ahora };
    return new Visita(datos, Pase.emitirParaVisita(ids.codigoPase, ids.visitaId, unidad, s.fecha, p));
  }
}
