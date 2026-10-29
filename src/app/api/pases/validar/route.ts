import { casosDeUso } from '@/infrastructure/composicion';
import { conErroresDeDominio, leerJson } from '@/infrastructure/http/dominio';
import { proteger } from '@/infrastructure/http/proteger';

/** A2: el guardia valida el QR. Solo informa: el uso se consume al registrar el ingreso. */
export const POST = proteger(
  ['GUARDIA', 'ADMIN'],
  conErroresDeDominio(async (request) => Response.json(await casosDeUso().validarPase.ejecutar(await leerJson(request)))),
);
