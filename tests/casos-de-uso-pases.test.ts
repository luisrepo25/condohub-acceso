import { describe, expect, it } from 'vitest';
import type { PaseRepositorio, ResultadoVisita, UnidadesDelSolicitante, VisitaRepositorio } from '@/application/ports/pases';
import { PasesParaGuardia } from '@/application/pases-para-guardia';
import { RegistrarVisita } from '@/application/registrar-visita';
import { ServicioNoDisponible } from '@/application/servicio-no-disponible';
import { traducirError } from '@/application/traducir-error';
import { ValidarPase } from '@/application/validar-pase';
import { DatoInvalido, ReglaViolada } from '@/domain/errores';
import type { Pase } from '@/domain/model/pase';
import type { Solicitante } from '@/domain/model/rol';
import type { Visita } from '@/domain/model/visita';

class Repositorio implements VisitaRepositorio, PaseRepositorio {
  readonly visitas: Visita[] = [];
  private readonly porClave = new Map<string, Visita>();
  async guardar(v: Visita, clave: string): Promise<ResultadoVisita> {
    const previa = this.porClave.get(clave);
    if (previa) return { creada: false, respuesta: previa };
    this.porClave.set(clave, v);
    this.visitas.push(v);
    return { creada: true, respuesta: v };
  }
  async obtener(codigo: string): Promise<Pase | undefined> {
    return this.visitas.find((v) => v.pase.codigo === codigo)?.pase;
  }
  async delDia(fecha: string): Promise<Pase[]> {
    return this.visitas.map((v) => v.pase).filter((p) => p.validoDesde.startsWith(fecha));
  }
}

const residente: Solicitante = { sub: 'residente-1', roles: new Set(['RESIDENTE']) };
const admin: Solicitante = { sub: 'admin-1', roles: new Set(['ADMIN']) };
const K1 = '6f1c2a0e-0000-4000-8000-000000000001';
const K2 = '6f1c2a0e-0000-4000-8000-000000000002';
const visita = { unidadCodigo: 'A-101', nombre: 'Ana Pérez', fecha: '2026-10-30' };
const AHORA = new Date('2026-10-30T15:00:00Z');

function montar(unidades: string[] | Error = ['A-101']) {
  const repo = new Repositorio();
  const gestion: UnidadesDelSolicitante = {
    async codigos() {
      if (unidades instanceof Error) throw unidades;
      return unidades;
    },
  };
  let n = 0;
  const registrar = new RegistrarVisita({
    repositorio: repo,
    unidades: gestion,
    reloj: () => AHORA,
    nuevoId: () => `v-${++n}`,
    nuevoCodigoPase: () => `CH-codigo-${n}`,
    ventana: { horaDesde: '07:00:00', horaHasta: '23:59:59', offset: '-04:00' },
  });
  return { repo, registrar, validar: new ValidarPase(repo, () => AHORA), guardia: new PasesParaGuardia(repo, () => AHORA, -240) };
}

describe('RegistrarVisita', () => {
  it('A1_el_residente_anuncia_una_visita_de_su_unidad_y_recibe_el_pase', async () => {
    const { registrar } = montar();
    const r = await registrar.ejecutar(visita, K1, residente, 'jwt');
    expect(r.creada).toBe(true);
    expect(r.respuesta.pase).toMatchObject({ estado: 'VIGENTE', usosMaximos: 1, unidadCodigo: 'A-101' });
    expect(r.respuesta.registradaPor).toBe('residente-1');
  });

  it('F1_un_residente_no_anuncia_visitas_de_una_unidad_ajena', async () => {
    const { registrar, repo } = montar(['B-202']);
    const intento = registrar.ejecutar(visita, K1, residente, 'jwt');
    await expect(intento).rejects.toThrow(ReglaViolada);
    await expect(intento).rejects.toMatchObject({ codigo: 'F1' });
    expect(repo.visitas).toHaveLength(0);
  });

  it('F1_el_admin_puede_anunciar_visitas_de_cualquier_unidad_sin_consultar_a_gestion', async () => {
    const { registrar } = montar(new ServicioNoDisponible());
    await expect(registrar.ejecutar(visita, K1, admin, 'jwt')).resolves.toMatchObject({ creada: true });
  });

  it('O3_repetir_la_Idempotency_Key_devuelve_la_misma_visita_y_el_mismo_pase', async () => {
    const { registrar, repo } = montar();
    const a = await registrar.ejecutar(visita, K1, residente, 'jwt');
    const b = await registrar.ejecutar(visita, K1, residente, 'jwt');
    expect(b.creada).toBe(false);
    expect(b.respuesta.pase.codigo).toBe(a.respuesta.pase.codigo);
    expect(repo.visitas).toHaveLength(1);
  });

  it('O1_exige_Idempotency_Key_uuid_v4', async () => {
    const { registrar } = montar();
    await expect(registrar.ejecutar(visita, 'x', residente, 'jwt')).rejects.toThrow(DatoInvalido);
  });

  it('si_Gestion_no_responde_es_503_y_no_se_emite_nada', async () => {
    const { registrar, repo } = montar(new ServicioNoDisponible());
    const error = await registrar.ejecutar(visita, K1, residente, 'jwt').catch((e: unknown) => e);
    expect(traducirError(error)).toMatchObject({ status: 503 });
    expect(repo.visitas).toHaveLength(0);
  });

  it('F1_se_traduce_a_403_y_otras_reglas_a_422', () => {
    expect(traducirError(new ReglaViolada('F1', 'x'))).toMatchObject({ status: 403, code: 'F1' });
    expect(traducirError(new ReglaViolada('A2', 'x'))).toMatchObject({ status: 422, code: 'A2' });
  });
});

describe('ValidarPase', () => {
  it('A2_un_pase_vigente_es_valido_y_validar_no_lo_consume', async () => {
    const { registrar, validar, repo } = montar();
    const { respuesta } = await registrar.ejecutar(visita, K1, residente, 'jwt');
    const r1 = await validar.ejecutar({ codigo: respuesta.pase.codigo });
    const r2 = await validar.ejecutar({ codigo: respuesta.pase.codigo });
    expect(r1.valido).toBe(true);
    expect(r2.valido).toBe(true);
    expect((await repo.obtener(respuesta.pase.codigo))?.usos).toBe(0);
  });

  it('A2_un_pase_inexistente_se_rechaza_con_motivo_NO_EXISTE', async () => {
    const { validar } = montar();
    expect(await validar.ejecutar({ codigo: 'CH-nada' })).toEqual({ valido: false, motivo: 'NO_EXISTE' });
  });

  it('A2_un_pase_fuera_de_su_ventana_se_rechaza_con_motivo_VENCIDO', async () => {
    const { registrar, repo } = montar();
    await registrar.ejecutar({ ...visita, fecha: '2026-10-29' }, K1, residente, 'jwt');
    const vencido = new ValidarPase(repo, () => AHORA);
    const r = await vencido.ejecutar({ codigo: repo.visitas[0]?.pase.codigo });
    expect(r).toMatchObject({ valido: false, motivo: 'VENCIDO' });
  });

  it('A2_pide_el_codigo', async () => {
    const { validar } = montar();
    await expect(validar.ejecutar({})).rejects.toThrow(DatoInvalido);
    await expect(validar.ejecutar(null)).rejects.toThrow(DatoInvalido);
  });
});

describe('PasesParaGuardia', () => {
  it('O6_entrega_los_pases_de_hoy_y_de_manana_para_validar_sin_conexion', async () => {
    const { registrar, guardia } = montar();
    await registrar.ejecutar(visita, K1, residente, 'jwt');
    await registrar.ejecutar({ ...visita, fecha: '2026-10-31' }, K2, residente, 'jwt');
    await registrar.ejecutar({ ...visita, fecha: '2026-11-05' }, '6f1c2a0e-0000-4000-8000-000000000003', residente, 'jwt');
    const pases = await guardia.ejecutar();
    expect(pases.map((p) => p.validoDesde.slice(0, 10))).toEqual(['2026-10-30', '2026-10-31']);
  });

  it('O6_desde_trae_solo_lo_cambiado_despues_de_ese_instante', async () => {
    const { registrar, guardia } = montar();
    await registrar.ejecutar(visita, K1, residente, 'jwt');
    expect(await guardia.ejecutar('2026-10-30T15:00:01.000Z')).toHaveLength(0);
    expect(await guardia.ejecutar('2026-10-30T14:59:59.000Z')).toHaveLength(1);
  });

  it('desde_ilegible_es_una_solicitud_invalida', async () => {
    const { guardia } = montar();
    await expect(guardia.ejecutar('ayer')).rejects.toThrow(DatoInvalido);
  });
});
