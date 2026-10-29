import { casosDeUso } from '@/infrastructure/composicion';
import { conErroresDeDominio } from '@/infrastructure/http/dominio';
import { proteger } from '@/infrastructure/http/proteger';

/** La lista cambia cuando se registra un vehículo: nunca se guarda en caché. */
export const dynamic = 'force-dynamic';

/** A4, O6: placas de residentes para que la app del guardia las compare en el dispositivo. */
export const GET = proteger(
  ['GUARDIA', 'ADMIN'],
  conErroresDeDominio(async () => Response.json(await casosDeUso().listarPlacas.ejecutar())),
);
