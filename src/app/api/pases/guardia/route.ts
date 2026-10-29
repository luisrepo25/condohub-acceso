import { casosDeUso } from '@/infrastructure/composicion';
import { conErroresDeDominio } from '@/infrastructure/http/dominio';
import { proteger } from '@/infrastructure/http/proteger';

/** Pases de hoy y de mañana para cachear en la app del guardia y validar sin conexión (O6). */
export const GET = proteger(
  ['GUARDIA', 'ADMIN'],
  conErroresDeDominio(async (request) => {
    const desde = new URL(request.url).searchParams.get('desde');
    return Response.json(await casosDeUso().pasesParaGuardia.ejecutar(desde));
  }),
);
