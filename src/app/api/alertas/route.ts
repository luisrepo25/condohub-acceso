import { noImplementado } from '@/infrastructure/http/problemas';
import { proteger } from '@/infrastructure/http/proteger';

/** I4: alertas de visitante recurrente para el guardia. */
export const GET = proteger(['GUARDIA', 'ADMIN'], () => noImplementado('Las alertas'));