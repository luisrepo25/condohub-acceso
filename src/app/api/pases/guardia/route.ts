import { pasesParaGuardia } from '@/application/casos/consultas-guardia';
import { dependencias } from '@/infrastructure/composicion';
import { desdeDe } from '@/infrastructure/http/entrada';
import { proteger } from '@/infrastructure/http/proteger';

/** Pases del día para cachear en la PWA del guardia (O6). `?desde=` trae solo los que cambiaron. */
export const GET = proteger(['GUARDIA', 'ADMIN'], async (request) => {
  return Response.json(await pasesParaGuardia(dependencias(), desdeDe(request)));
});

// Siempre se responde en el momento: depende del token y de datos que cambian (Next no debe intentar prerenderla).
export const dynamic = 'force-dynamic';
