import './env';
import { existsSync } from 'node:fs';
import { createApp } from './app';
import { buildConnectors, config } from './config';

// node:sqlite still prints an ExperimentalWarning on Node 24; it is expected and harmless.
const origEmit = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : warning.message;
  if (/SQLite is an experimental feature/.test(msg)) return;
  return (origEmit as (...a: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;

const connectors = buildConnectors();
const app = createApp({
  databasePath: config.databasePath,
  retentionHours: config.retentionHours,
  snapshotLimit: config.snapshotLimit,
  connectors,
  ingestion: config.ingestion,
  staticDir: config.production && existsSync('dist') ? 'dist' : undefined,
  maxSseClients: config.maxSseClients,
  maxSsePerIp: config.maxSsePerIp,
  corsOrigin: config.corsOrigin,
  llm: config.llm,
  secureCookies: config.production && process.env.COOKIE_SECURE !== 'false',
});

await app.start(config.port, config.host);
console.log(`SAND ${config.production ? 'app' : 'API'} on http://localhost:${config.port}${config.production ? '' : ' (interface: Vite, see the [web] output)'}`);
for (const c of connectors) console.log(`  ${c.enabled ? '●' : '○'} ${c.name}${c.enabled ? '' : ` — ${c.disabledReason}`}`);
console.log(
  `  IA: ${
    config.llm.anthropicKey
      ? `ativada (${config.llm.model}, até ${config.llm.maxCallsPerHour} chamadas/h)`
      : config.llm.enabled
        ? 'LLM_ENABLED=true, mas ANTHROPIC_API_KEY ausente — classificação só por regras'
        : 'desativada (LLM_ENABLED=false) — classificação só por regras, zero tokens'
  }`,
);

const shutdown = async () => {
  console.log('\nencerrando…');
  await app.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
