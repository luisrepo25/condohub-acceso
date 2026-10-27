import { validarPase } from '@/application/casos/validar-pase';
import { dependencias } from '@/infrastructure/composicion';
import { codigoDePase, cuerpoJson } from '@/infrastructure/http/entrada';
import { proteger } from '@/infrastructure/http/proteger';

/** A2: el guardia valida un QR. Solo consulta: el uso se consume al registrar el ingreso. */
export const POST = proteger(['GUARDIA', 'ADMIN'], async (request) => {
  return Response.json(await validarPase(dependencias(), codigoDePase(await cuerpoJson(request))));
});
