import { registrarVisita } from '@/application/casos/registrar-visita';
import { dependencias } from '@/infrastructure/composicion';
import { cuerpoJson, solicitudVisita, tokenDe } from '@/infrastructure/http/entrada';
import { proteger } from '@/infrastructure/http/proteger';

/** A1: el residente registra una visita y se emite un pase QR. Idempotente (O1–O3). */
export const POST = proteger(['RESIDENTE', 'ADMIN'], async (request, solicitante) => {
  const solicitud = solicitudVisita(await cuerpoJson(request));
  const r = await registrarVisita(dependencias(), solicitante, tokenDe(request), request.headers.get('idempotency-key'), solicitud);
  return Response.json(r.cuerpo, { status: r.codigoHttp });
});
