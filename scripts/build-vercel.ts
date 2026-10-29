/**
 * Vercel build (Build Output API v3): the web app as static files plus the city-search
 * function, bundled into one file so it doesn't depend on how Vercel compiles TypeScript.
 * Run by Vercel as `npm run build:vercel`; writes .vercel/output.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';

const OUT = '.vercel/output';

// Same policy the Node server sent, opened up only for Firebase (Auth and Firestore).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com",
  'frame-src https://*.firebaseapp.com',
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  'Content-Security-Policy': CSP,
};

rmSync(OUT, { recursive: true, force: true });
await vite({ logLevel: 'warn', build: { outDir: `${OUT}/static`, emptyOutDir: true } });

const bundle = `${OUT}/geocode.mjs`;
await esbuild({
  entryPoints: ['server/http/geocodeApi.ts'],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Some dependencies still call require(); give them one in the ESM bundle.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});
// /api/geocode and /api/geocode/reverse run the same code (the handler routes by path).
for (const fn of [`${OUT}/functions/api/geocode.func`, `${OUT}/functions/api/geocode/reverse.func`]) {
  mkdirSync(fn, { recursive: true });
  writeFileSync(`${fn}/index.mjs`, readFileSync(bundle));
  writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false }, null, 2));
}
rmSync(bundle);

writeFileSync(
  `${OUT}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/assets/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '/(.*)', headers: SECURITY_HEADERS, continue: true },
        { handle: 'filesystem' },
        { src: '/api/(.*)', status: 404, headers: { 'Content-Type': 'application/json' }, dest: '/404.json' },
        // Single-page app: every other path is the app.
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
writeFileSync(`${OUT}/static/404.json`, JSON.stringify({ error: 'not_found' }));
console.log(`Vercel output pronto em ${OUT}`);
