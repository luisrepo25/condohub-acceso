import { describe, expect, it } from 'vitest';
import type { RegistroAccesoRepositorio, ResultadoGuardado } from '@/application/ports/registro-acceso-repositorio';
import { RegistrarAcceso } from '@/application/registrar-acceso';
import { SincronizarLote } from '@/application/sincronizar-lote';
import { DatoInvalido } from '@/domain/errores';
import type { RegistroAcceso } from '@/domain/model/registro-acceso';
import type { Solicitante } from '@/domain/model/rol';

/** Repositorio en memoria con la misma semántica que el de DynamoDB: una clave, un registro (O3). */
class RepositorioEnMemoria implements RegistroAccesoRepositorio {
  readonly registros: RegistroAcceso[] = [];
  private readonly porClave = new Map<string, RegistroAcceso>();

  async guardar(registro: RegistroAcceso, clave: string): Promise<ResultadoGuardado> {
    const previo = this.porClave.get(clave);
    if (previo) return { creado: false, respuesta: previo };
    this.porClave.set(clave, registro);
    this.registros.push(registro);
    return { creado: true, respuesta: registro };
  }
}

const guardia: Solicitante = { sub: 'guardia-1', roles: new Set(['GUARDIA']) };
const K1 = '6f1c2a0e-0000-4000-8000-000000000001';
const K2 = '6f1c2a0e-0000-4000-8000-000000000002';
const acceso = { sentido: 'INGRESO', categoria: 'PEATON', unidadCodigo: 'A-101', horaDispositivo: '2026-10-28T14:00:00Z' };

function montar() {
  const repo = new RepositorioEnMemoria();
  let n = 0;
  const registrar = new RegistrarAcceso(repo, () => new Date('2026-10-28T15:00:00Z'), () => `r-${++n}`);
  return { repo, registrar, lote: new SincronizarLote(registrar) };
}

describe('RegistrarAcceso', () => {
  it('O3_repetir_la_Idempotency_Key_devuelve_el_mismo_registro_sin_duplicar', async () => {
    const { repo, registrar } = montar();
    const primera = await registrar.ejecutar(acceso, K1, guardia);
    const repetida = await registrar.ejecutar(acceso, K1, guardia);
    expect(primera.creado).toBe(true);
    expect(repetida.creado).toBe(false);
    expect(repetida.respuesta).toEqual(primera.respuesta);
    expect(repo.registros).toHaveLength(1);
  });

  it('O1_exige_una_Idempotency_Key_uuid_v4', async () => {
    const { registrar } = montar();
    await expect(registrar.ejecutar(acceso, '', guardia)).rejects.toThrow(DatoInvalido);
    await expect(registrar.ejecutar(acceso, 'no-es-uuid', guardia)).rejects.toThrow(DatoInvalido);
  });

  it('A3_guarda_quien_lo_registro_y_la_hora_del_servidor', async () => {
    const { registrar } = montar();
    const { respuesta } = await registrar.ejecutar(acceso, K1, guardia);
    expect(respuesta.guardiaSub).toBe('guardia-1');
    expect(respuesta.horaServidor).toBe('2026-10-28T15:00:00.000Z');
  });
});

describe('SincronizarLote', () => {
  const operaciones = [
    { idempotencyKey: K1, tipo: 'ACCESO', datos: acceso },
    { idempotencyKey: K2, tipo: 'ACCESO', datos: { ...acceso, sentido: 'SALIDA' } },
  ];

  it('O3_enviar_el_mismo_lote_dos_veces_deja_un_solo_registro_por_operacion_y_las_mismas_respuestas', async () => {
    const { repo, lote } = montar();
    const primera = await lote.ejecutar({ operaciones }, guardia);
    const segunda = await lote.ejecutar({ operaciones }, guardia);
    expect(repo.registros).toHaveLength(2);
    expect(segunda).toEqual(primera);
    expect(primera.resultados.map((r) => r.codigo)).toEqual([201, 201]);
  });

  it('O4_responde_una_entrada_por_operacion_y_una_mala_no_tumba_a_las_demas', async () => {
    const { repo, lote } = montar();
    const mala = { idempotencyKey: K2, tipo: 'ACCESO', datos: { ...acceso, resultado: 'RECHAZADO' } };
    const { resultados } = await lote.ejecutar({ operaciones: [operaciones[0], mala] }, guardia);
    expect(resultados.map((r) => r.codigo)).toEqual([201, 422]);
    expect(resultados[1]?.cuerpo).toMatchObject({ code: 'A2', status: 422 });
    expect(repo.registros).toHaveLength(1);
  });

  it('O4_una_operacion_con_forma_incorrecta_responde_400_en_su_entrada', async () => {
    const { lote } = montar();
    const { resultados } = await lote.ejecutar({ operaciones: [{ idempotencyKey: K1, tipo: 'PAGO', datos: {} }] }, guardia);
    expect(resultados[0]?.codigo).toBe(400);
  });

  it('rechaza un lote vacio o sin operaciones', async () => {
    const { lote } = montar();
    await expect(lote.ejecutar({ operaciones: [] }, guardia)).rejects.toThrow(DatoInvalido);
    await expect(lote.ejecutar({}, guardia)).rejects.toThrow(DatoInvalido);
  });
});
