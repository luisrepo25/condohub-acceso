import { noImplementado } from '@/infrastructure/http/problemas';
import { proteger } from '@/infrastructure/http/proteger';

/** A1: el residente registra una visita y se emite un pase QR. */
export const POST = proteger(['RESIDENTE', 'ADMIN'], () => noImplementado('El registro de visitas'));