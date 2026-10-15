import { noImplementado } from '@/infrastructure/http/problemas';
import { proteger } from '@/infrastructure/http/proteger';

/** A3, O1-O3: registro de ingreso/salida, append-only e idempotente por `Idempotency-Key`. */
export const POST = proteger(['GUARDIA', 'ADMIN'], () => noImplementado('El registro de accesos'));