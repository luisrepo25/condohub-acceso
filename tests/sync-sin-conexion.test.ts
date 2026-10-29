// O6 y O3: sincronizar un ingreso hecho sin conexión cuyo pase ya no sirve, y la clave de idempotencia de otra persona.
import { describe, expect, it } from 'vitest';
import type { OpcionesGuardado, RegistroAccesoRepositorio, ResultadoGuardado } from '@/application/ports/registro-acceso-repositorio';
import { RegistrarAcceso } from '@/application/registrar-acceso';
import { SincronizarLote } from '@/application/sincronizar-lote';
import { traducirError } from '@/application/traducir-error';
import { ConflictoDeClave, ReglaViolada } from '@/domain/errores';
import { motivoPaseNoUsable, type Pase } from '@/domain/model/pase';
import type { RegistroAcceso } from '@/domain/model/registro-acceso';
import type { Solicitante } from '@/domain/model/rol';

/** Repositorio en memoria con la semántica del de DynamoDB: evalúa el pase en `instante` y lo consume una vez. */
class RepoConPases implements RegistroAccesoRepositorio {
  readonly registros: RegistroAcceso[] = [];
  readonly instantes: Date[] = [];
  private readonly porClave = new Map<string, RegistroAcceso>();
  constructor(
    public pase: Pase,
    private readonly ahora: Date,
  ) {}

  async guardar(registro: RegistroAcceso, clave: string, opciones: OpcionesGuardado = {}): Promise<ResultadoGuardado> {
    const previo = this.porClave.get(clave);
    if (previo) return { creado: false, respuesta: previo };
    if (registro.paseCodigo && !opciones.sinConsumirPase) {
      const instante = opciones.instante ?? this.ahora;
      this.instantes.push(instante);
      const motivo = motivoPaseNoUsable(this.pase, instante);
      if (motivo) throw new ReglaViolada('A2', `El pase no sirve: ${motivo}`);
      this.pase = { ...this.pase, usos: 1, estado: 'USADO' };
    }
    this.porClave.set(clave, registro);
    this.registros.push(registro);
    return { creado: true, respuesta: registro };
  }
}

const guardia: Solicitante = { sub: 'guardia-1', roles: new Set(['GUARDIA']) };
const otro: Solicitante = { sub: 'guardia-2', roles: new Set(['GUARDIA']) };
const K1 = '6f1c2a0e-0000-4000-8000-000000000011';
const K2 = '6f1c2a0e-0000-4000-8000-000000000012';
const AHORA = new Date('2026-10-28T20:00:00Z');
const PASE: Pase = {
  codigo: 'CH-pase', unidadCodigo: 'A-101', estado: 'VIGENTE', usos: 0, usosMaximos: 1,
  validoDesde: '2026-10-28T07:00:00-04:00', validoHasta: '2026-10-28T23:59:59-04:00',
};
const conPase = (horaDispositivo: string) => ({ sentido: 'INGRESO', categoria: 'PEATON', paseCodigo: 'CH-pase', horaDispositivo });

function montar(pase: Pase = PASE) {
  const repo = new RepoConPases(pase, AHORA);
  const registrar = new RegistrarAcceso(repo, () => AHORA, () => 'r-1');
  return { repo, registrar, lote: new SincronizarLote(registrar) };
}

describe('O6 sincronizar un ingreso sin conexión', () => {
  it('O6_el_pase_se_evalua_a_la_hora_del_dispositivo_no_a_la_del_servidor', async () => {
    const { repo, lote } = montar({ ...PASE, validoHasta: '2026-10-28T12:00:00-04:00' }); // vencía a las 16:00Z
    const { resultados } = await lote.ejecutar({ operaciones: [{ idempotencyKey: K1, tipo: 'ACCESO', datos: conPase('2026-10-28T15:00:00Z') }] }, guardia);

    expect(resultados[0]?.codigo).toBe(201);
    expect(resultados[0]?.cuerpo).not.toHaveProperty('observacion');
    expect(repo.pase.estado).toBe('USADO');
  });

  it('O6_A3_si_el_pase_ya_no_servia_el_ingreso_se_registra_igual_con_observacion_y_sin_gastar_el_pase', async () => {
    const { repo, lote } = montar({ ...PASE, estado: 'USADO', usos: 1 }); // otro guardia lo usó mientras tanto
    const { resultados } = await lote.ejecutar({ operaciones: [{ idempotencyKey: K1, tipo: 'ACCESO', datos: conPase('2026-10-28T15:00:00Z') }] }, guardia);

    expect(resultados[0]?.codigo).toBe(201);
    expect(resultados[0]?.cuerpo).toMatchObject({ resultado: 'PERMITIDO', paseCodigo: 'CH-pase' });
    expect(String(resultados[0]?.cuerpo.observacion)).toContain('O6');
    expect(repo.registros).toHaveLength(1);
    expect(repo.pase.usos).toBe(1);
  });

  it('A2_fuera_de_la_sincronizacion_un_pase_que_no_sirve_sigue_rechazandose_con_422', async () => {
    const { registrar } = montar({ ...PASE, estado: 'REVOCADO' });
    await expect(registrar.ejecutar(conPase('2026-10-28T15:00:00Z'), K1, guardia)).rejects.toBeInstanceOf(ReglaViolada);
  });

  it('O6_un_reloj_adelantado_mas_de_5_minutos_se_ignora_y_se_usa_la_hora_del_servidor', async () => {
    const { repo, lote } = montar();
    await lote.ejecutar({ operaciones: [{ idempotencyKey: K1, tipo: 'ACCESO', datos: conPase('2026-10-29T20:00:00Z') }] }, guardia);

    expect(repo.instantes[0]).toEqual(AHORA);
  });

  it('O3_repetir_el_lote_con_el_pase_ya_gastado_devuelve_lo_mismo_sin_duplicar', async () => {
    const { repo, lote } = montar();
    const op = { operaciones: [{ idempotencyKey: K1, tipo: 'ACCESO', datos: conPase('2026-10-28T15:00:00Z') }] };
    const primera = await lote.ejecutar(op, guardia);
    const segunda = await lote.ejecutar(op, guardia);

    expect(segunda).toEqual(primera);
    expect(repo.registros).toHaveLength(1);
  });
});

describe('O3 la clave de idempotencia es de quien la usó', () => {
  it('O3_otra_persona_con_la_misma_clave_recibe_409_y_no_la_respuesta_ajena', async () => {
    const { registrar } = montar();
    await registrar.ejecutar({ sentido: 'SALIDA', categoria: 'PEATON', unidadCodigo: 'A-101', horaDispositivo: '2026-10-28T15:00:00Z' }, K2, guardia);

    const intento = registrar.ejecutar({ sentido: 'SALIDA', categoria: 'PEATON', unidadCodigo: 'A-101', horaDispositivo: '2026-10-28T15:00:00Z' }, K2, otro);
    await expect(intento).rejects.toBeInstanceOf(ConflictoDeClave);
    expect(traducirError(new ConflictoDeClave())).toMatchObject({ status: 409 });
  });
});
