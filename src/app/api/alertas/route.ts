import { alertasParaGuardia } from '@/application/casos/consultas-guardia';
import { dependencias } from '@/infrastructure/composicion';
import { desdeDe, tokenDe } from '@/infrastructure/http/entrada';
import { proteger } from '@/infrastructure/http/proteger';

/** I4: alertas de visitante recurrente para el guardia, traducidas desde el Servicio IA (capa anticorrupción). */
export const GET = proteger(['GUARDIA', 'ADMIN'], async (request) => {
  return Response.json(await alertasParaGuardia(dependencias(), tokenDe(request), desdeDe(request)));
});

// Siempre se responde en el momento: depende del token y de datos que cambian (Next no debe intentar prerenderla).
export const dynamic = 'force-dynamic';
