// Las rutas implementadas deben coincidir con contracts/openapi/acceso.yaml (si el contrato está a mano).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const contrato = fileURLToPath(new URL('../../../contracts/openapi/acceso.yaml', import.meta.url));
const raizApi = fileURLToPath(new URL('../src/app/api', import.meta.url));
const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function rutasDe(dir: string, prefijo = '/api'): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return rutasDe(ruta, `${prefijo}/${nombre}`);
    if (nombre !== 'route.ts') return [];
    const fuente = readFileSync(ruta, 'utf8');
    return METODOS.filter((m) => new RegExp(`export (const|async function) ${m}\\b`).test(fuente)).map((m) => `${m} ${prefijo}`);
  });
}

describe.skipIf(!existsSync(contrato))('contrato acceso.yaml', () => {
  it('implementa exactamente las operaciones del contrato', () => {
    const doc = parse(readFileSync(contrato, 'utf8')) as { paths: Record<string, Record<string, unknown>> };
    const esperadas = Object.entries(doc.paths).flatMap(([ruta, ops]) =>
      Object.keys(ops).filter((m) => METODOS.includes(m.toUpperCase())).map((m) => `${m.toUpperCase()} ${ruta}`),
    );
    expect(rutasDe(raizApi).sort()).toEqual(esperadas.sort());
  });
});