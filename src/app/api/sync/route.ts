import { casosDeUso } from '@/infrastructure/composicion';
import { conErroresDeDominio, leerJson } from '@/infrastructure/http/dominio';
import { proteger } from '@/infrastructure/http/proteger';

/** O1-O4: lote de operaciones hechas offline; responde una entrada por operación. */
export const POST = proteger(
  ['GUARDIA', 'ADMIN'],
  conErroresDeDominio(async (request, solicitante) => {
    const resultado = await casosDeUso().sincronizarLote.ejecutar(await leerJson(request), solicitante);
    return Response.json(resultado);
  }),
);
