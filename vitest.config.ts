import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    // Las pruebas nunca llaman a la Gestión ni a la IA reales (usan dobles): un puerto cerrado por si alguna se escapa.
    env: { GESTION_GRAPHQL_URL: 'http://127.0.0.1:9/gestion/graphql', IA_URL: 'http://127.0.0.1:9/ia' },
  },
});
