// Evidencia repetible contra inyección: Acceso usa DynamoDB, sin SQL ni PartiQL. Se demuestra que (1) ninguna expresión
// del código se arma con datos de entrada y (2) los ataques clásicos viajan solo como valores, nunca dentro de una expresión.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RegistrarVisita } from '@/application/registrar-visita';
import type { Solicitante } from '@/domain/model/rol';
import { nuevoCodigoPase } from '@/infrastructure/config-pases';
import { VisitaPaseDynamo } from '@/infrastructure/dynamodb/visita-pase-dynamo';

const ATAQUES = ["' OR '1'='1", "'; DROP TABLE acceso; --", "x' UNION SELECT usename FROM pg_user --", '1; DELETE FROM acceso; --', '" OR 1=1 --'];
const CARPETA = join(__dirname, '..', 'src', 'infrastructure', 'dynamodb');

describe('Acceso · expresiones de DynamoDB', () => {
  it('ninguna_expresion_del_codigo_se_arma_con_plantillas_ni_concatenacion', () => {
    const peligrosas: string[] = [];
    for (const archivo of readdirSync(CARPETA).filter((f) => f.endsWith('.ts'))) {
      readFileSync(join(CARPETA, archivo), 'utf8')
        .split('\n')
        .forEach((linea, i) => {
          const asigna = /(ConditionExpression|UpdateExpression|KeyConditionExpression|FilterExpression|ProjectionExpression)\s*:\s*(.*)/.exec(linea);
          if (asigna && !/^'[^'$`]*'\s*[,}]/.test(asigna[2] ?? '')) peligrosas.push(`${archivo}:${i + 1}: ${linea.trim()}`);
        });
    }
    expect(peligrosas).toEqual([]);
  });

  it('los_ataques_clasicos_viajan_solo_como_valores_y_nunca_dentro_de_una_expresion', async () => {
    const comandos: Record<string, unknown>[] = [];
    const doc = { send: async (c: { input: Record<string, unknown> }) => (comandos.push(c.input), {}) };
    const residente: Solicitante = { sub: 'residente-it', roles: new Set(['RESIDENTE']) };
    const registrar = new RegistrarVisita({
      repositorio: new VisitaPaseDynamo(doc as never, 'acceso'),
      unidades: { codigos: async () => ['A-101'] },
      reloj: () => new Date('2031-06-15T15:00:00Z'),
      nuevoId: randomUUID,
      nuevoCodigoPase,
      ventana: { horaDesde: '07:00:00', horaHasta: '23:59:59', offset: '-04:00' },
    });

    for (const ataque of ATAQUES) {
      await registrar.ejecutar({ unidadCodigo: 'A-101', nombre: ataque, fecha: '2031-06-15' }, randomUUID(), residente, 'jwt');
    }

    expect(comandos.length).toBeGreaterThan(0);
    const expresiones = JSON.stringify(
      comandos.map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => /Expression$/.test(k)))),
    );
    for (const ataque of ATAQUES) {
      expect(expresiones).not.toContain(ataque);
      expect(JSON.stringify(comandos)).toContain(JSON.stringify(ataque).slice(1, -1)); // sí se guardó, como dato
    }
  });
});
