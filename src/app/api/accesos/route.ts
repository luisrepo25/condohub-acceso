import { casosDeUso } from '@/infrastructure/composicion';
import { conErroresDeDominio, leerJson } from '@/infrastructure/http/dominio';
import { proteger } from '@/infrastructure/http/proteger';

/** A3, O1-O3: registro de ingreso/salida, append-only e idempotente por `Idempotency-Key`. */
export const POST = proteger(
  ['GUARDIA', 'ADMIN'],
  conErroresDeDominio(async (request, solicitante) => {
    const clave = request.headers.get('idempotency-key') ?? '';
    const { respuesta } = await casosDeUso().registrarAcceso.ejecutar(await leerJson(request), clave, solicitante);
    return Response.json(respuesta, { status: 201 });
  }),
);
