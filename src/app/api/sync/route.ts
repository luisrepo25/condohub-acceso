import { noImplementado } from '@/infrastructure/http/problemas';
import { proteger } from '@/infrastructure/http/proteger';

/** O1-O4: lote de operaciones hechas offline; responde una entrada por operación. */
export const POST = proteger(['GUARDIA', 'ADMIN'], () => noImplementado('La sincronización offline'));