import { sincronizarLote } from '@/application/casos/sincronizar-lote';
import { dependencias } from '@/infrastructure/composicion';
import { cuerpoJson, loteSync } from '@/infrastructure/http/entrada';
import { desdeError } from '@/infrastructure/http/problemas';
import { proteger } from '@/infrastructure/http/proteger';

/** O1-O4: lote de operaciones hechas offline; responde una entrada por operación con el código que habría tenido. */
export const POST = proteger(['GUARDIA', 'ADMIN'], async (request, solicitante) => {
  const operaciones = loteSync(await cuerpoJson(request));
  const resultados = await sincronizarLote(dependencias(), solicitante, operaciones, async (e) => {
    const r = desdeError(e);
    return { codigoHttp: r.status, cuerpo: await r.json() };
  });
  return Response.json({ resultados });
});
