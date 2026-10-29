import { ConflictoDeClave, DatoInvalido, ReglaViolada } from '@/domain/errores';
import { leerNuevaVisita, registrarVisita, type VentanaPase } from '@/domain/model/visita';
import type { Solicitante } from '@/domain/model/rol';
import type { ResultadoVisita, UnidadesDelSolicitante, VisitaRepositorio } from './ports/pases';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface DependenciasRegistrarVisita {
  readonly repositorio: VisitaRepositorio;
  readonly unidades: UnidadesDelSolicitante;
  readonly reloj: () => Date;
  readonly nuevoId: () => string;
  readonly nuevoCodigoPase: () => string;
  readonly ventana: VentanaPase;
}

/** A1, F1, O3: el residente anuncia una visita de su unidad y se emite su pase QR. */
export class RegistrarVisita {
  constructor(private readonly d: DependenciasRegistrarVisita) {}

  async ejecutar(datos: unknown, idempotencyKey: string, solicitante: Solicitante, credencial: string): Promise<ResultadoVisita> {
    if (!UUID_V4.test(idempotencyKey)) throw new DatoInvalido('Idempotency-Key debe ser un UUID v4');
    const nueva = leerNuevaVisita(datos);
    await this.exigirUnidadPropia(nueva.unidadCodigo, solicitante, credencial);
    const visita = registrarVisita(nueva, {
      visitaId: this.d.nuevoId(),
      codigoPase: this.d.nuevoCodigoPase(),
      creadaEn: this.d.reloj().toISOString(),
      registradaPor: solicitante.sub,
      ventana: this.d.ventana,
    });
    const resultado = await this.d.repositorio.guardar(visita, idempotencyKey.toLowerCase());
    if (!resultado.creada && resultado.respuesta.registradaPor !== solicitante.sub) throw new ConflictoDeClave();
    return resultado;
  }

  /** F1: solo el titular y sus residentes anuncian visitas de su unidad. El `ADMIN` puede por cualquiera. */
  private async exigirUnidadPropia(unidad: string, solicitante: Solicitante, credencial: string): Promise<void> {
    if (solicitante.roles.has('ADMIN')) return;
    const propias = await this.d.unidades.codigos(credencial);
    if (!propias.includes(unidad)) throw new ReglaViolada('F1', 'La unidad no pertenece al solicitante');
  }
}
