import { casosDeUso } from '@/infrastructure/composicion';
import { conErroresDeDominio, credencialDe, leerJson } from '@/infrastructure/http/dominio';
import { proteger } from '@/infrastructure/http/proteger';

/** A1: el residente registra una visita y se emite un pase QR. */
export const POST = proteger(
  ['RESIDENTE', 'ADMIN'],
  conErroresDeDominio(async (request, solicitante) => {
    const clave = request.headers.get('idempotency-key') ?? '';
    const { respuesta } = await casosDeUso().registrarVisita.ejecutar(await leerJson(request), clave, solicitante, credencialDe(request));
    return Response.json(respuesta, { status: 201 });
  }),
);
