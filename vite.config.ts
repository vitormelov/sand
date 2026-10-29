import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';

// The same .env the ingestion script reads (Firebase project, service account).
if (existsSync('.env')) process.loadEnvFile('.env');

/** In development, /api/geocode* runs the same handler the Vercel function runs. */
function localApi(): Plugin {
  return {
    name: 'sand-local-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/geocode')) return next();
        const { geocodeNodeHandler } = await server.ssrLoadModule('/server/http/geocodeApi.ts');
        await geocodeNodeHandler(req, res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApi()],
  server: {
    port: Number(process.env.PORT ?? 5173),
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 20000,
  },
});
