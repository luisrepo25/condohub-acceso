// Contra DynamoDB Local real. Uso: DYNAMODB_ENDPOINT=http://localhost:8000 npm test
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PasesParaGuardia } from '@/application/pases-para-guardia';
import { RegistrarAcceso } from '@/application/registrar-acceso';
import { RegistrarVisita } from '@/application/registrar-visita';
import { ValidarPase } from '@/application/validar-pase';
import type { Solicitante } from '@/domain/model/rol';
import { nuevoCodigoPase } from '@/infrastructure/config-pases';
import { configDynamoDesdeEntorno, crearClienteDynamo } from '@/infrastructure/dynamodb/cliente';
import { RegistroAccesoDynamo } from '@/infrastructure/dynamodb/registro-acceso-dynamo';
import { VisitaPaseDynamo } from '@/infrastructure/dynamodb/visita-pase-dynamo';

const residente: Solicitante = { sub: 'residente-it', roles: new Set(['RESIDENTE']) };
const guardia: Solicitante = { sub: 'guardia-it', roles: new Set(['GUARDIA']) };
const config = configDynamoDesdeEntorno();
const doc = crearClienteDynamo(config);
const AHORA = new Date('2031-06-15T15:00:00Z');
const repo = new VisitaPaseDynamo(doc, config.tabla);
const registrarVisita = new RegistrarVisita({
  repositorio: repo,
  unidades: { codigos: async () => ['A-101'] },
  reloj: () => AHORA,
  nuevoId: randomUUID,
  nuevoCodigoPase,
  ventana: { horaDesde: '07:00:00', horaHasta: '23:59:59', offset: '-04:00' },
});
const validar = new ValidarPase(repo, () => AHORA);
const guardiaPases = new PasesParaGuardia(repo, () => AHORA, -240);
const registrarAcceso = new RegistrarAcceso(new RegistroAccesoDynamo(doc, config.tabla, () => AHORA), () => AHORA, randomUUID);
const nueva = (nombre: string) => ({ unidadCodigo: 'A-101', nombre, fecha: '2031-06-15' });

describe.skipIf(!process.env.DYNAMODB_ENDPOINT)('Visitas y pases sobre DynamoDB Local', () => {
  it('A1_la_visita_se_guarda_con_su_pase_y_se_puede_validar', async () => {
    const { respuesta } = await registrarVisita.ejecutar(nueva('Ana'), randomUUID(), residente, 'jwt');
    expect(await validar.ejecutar({ codigo: respuesta.pase.codigo })).toMatchObject({ valido: true });
  });

  it('O3_la_misma_clave_devuelve_la_misma_visita_idéntica_y_un_solo_pase', async () => {
    const clave = randomUUID();
    const a = await registrarVisita.ejecutar(nueva('Beto'), clave, residente, 'jwt');
    const b = await registrarVisita.ejecutar(nueva('Beto'), clave, residente, 'jwt');
    expect(b.creada).toBe(false);
    expect(JSON.stringify(b.respuesta)).toBe(JSON.stringify(a.respuesta));
  });

  it('A1_el_pase_aparece_en_la_lista_del_guardia_y_deja_de_servir_tras_usarlo', async () => {
    const { respuesta } = await registrarVisita.ejecutar(nueva('Carla'), randomUUID(), residente, 'jwt');
    const codigo = respuesta.pase.codigo;
    expect((await guardiaPases.ejecutar()).map((p) => p.codigo)).toContain(codigo);

    await registrarAcceso.ejecutar(
      { sentido: 'INGRESO', categoria: 'PEATON', paseCodigo: codigo, horaDispositivo: AHORA.toISOString() }, randomUUID(), guardia,
    );
    expect(await validar.ejecutar({ codigo })).toMatchObject({ valido: false, motivo: 'USADO' });
    const cambiados = await guardiaPases.ejecutar(new Date(AHORA.getTime() - 1000).toISOString());
    expect(cambiados.find((p) => p.codigo === codigo)).toMatchObject({ estado: 'USADO', usos: 1 });
  });

  it('A2_un_codigo_inventado_se_rechaza_con_NO_EXISTE', async () => {
    expect(await validar.ejecutar({ codigo: 'CH-no-existe' })).toEqual({ valido: false, motivo: 'NO_EXISTE' });
  });
});
