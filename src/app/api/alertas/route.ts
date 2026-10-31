import { casosDeUso } from '@/infrastructure/composicion';
import { conErroresDeDominio, credencialDe } from '@/infrastructure/http/dominio';
import { proteger } from '@/infrastructure/http/proteger';

/** Las alertas cambian con cada corrida del agrupamiento: nunca se guardan en caché. */
export const dynamic = 'force-dynamic';

/** I4: alertas de visitante recurrente para el guardia. Acceso las obtiene de la IA y las traduce a sus conceptos (capa anticorrupción). */
export const GET = proteger(
  ['GUARDIA', 'ADMIN'],
  conErroresDeDominio(async (request) => {
    const desde = new URL(request.url).searchParams.get('desde') ?? undefined;
    return Response.json(await casosDeUso().listarAlertas.ejecutar(credencialDe(request), desde));
  }),
);
