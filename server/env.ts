import { existsSync } from 'node:fs';

// Load .env (if present) before any module reads process.env. Real environment
// variables win: loadEnvFile does not overwrite values that are already set.
if (existsSync('.env')) process.loadEnvFile('.env');
