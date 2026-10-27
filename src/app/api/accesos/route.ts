import { registrarAcceso } from '@/application/casos/registrar-acceso';
import { dependencias } from '@/infrastructure/composicion';
import { cuerpoJson, nuevoAcceso } from '@/infrastructure/http/entrada';
import { proteger } from '@/infrastructure/http/proteger';

/** A3, O1-O3: registro de ingreso/salida, append-only e idempotente por `Idempotency-Key`. */
export const POST = proteger(['GUARDIA', 'ADMIN'], async (request, solicitante) => {
  const nuevo = nuevoAcceso(await cuerpoJson(request));
  const r = await registrarAcceso(dependencias(), solicitante, request.headers.get('idempotency-key'), nuevo);
  return Response.json(r.cuerpo, { status: r.codigoHttp });
});
