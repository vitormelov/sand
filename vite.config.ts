import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';

// Same .env as the API, so the proxy targets the right SAND_API_PORT.
if (existsSync('.env')) process.loadEnvFile('.env');

const apiPort = Number(process.env.SAND_API_PORT ?? 8787);

export default defineConfig({
  plugins: [react()],
  server: {
    // PORT (if set) belongs to the web dev server; the API uses SAND_API_PORT.
    port: Number(process.env.PORT ?? 5173),
    proxy: {
      '/api': { target: `http://localhost:${apiPort}`, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 20000,
  },
});
