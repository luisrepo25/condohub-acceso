import { noImplementado } from '@/infrastructure/http/problemas';
import { proteger } from '@/infrastructure/http/proteger';

/** A2: el guardia valida el QR. */
export const POST = proteger(['GUARDIA', 'ADMIN'], () => noImplementado('La validación de pases'));