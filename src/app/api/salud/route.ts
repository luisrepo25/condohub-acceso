import { proteger } from '@/infrastructure/http/proteger';

/** "Hola" del hito H1. Cualquier rol autenticado. */
export const GET = proteger('cualquiera', () => Response.json({ servicio: 'acceso', estado: 'OK' }));