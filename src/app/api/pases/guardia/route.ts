import { noImplementado } from '@/infrastructure/http/problemas';
import { proteger } from '@/infrastructure/http/proteger';

/** Pases vigentes para cachear en la PWA del guardia (O6). */
export const GET = proteger(['GUARDIA', 'ADMIN'], () => noImplementado('La descarga de pases vigentes'));