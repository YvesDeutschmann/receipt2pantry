#!/usr/bin/env node
/**
 * Post-build checks for store/release bundles.
 * Ensures prod Supabase + api.meald.app, no DEV ref, LAN/ngrok, dev settings, or secret patterns.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(__dirname, '..');
const distAssets = join(frontendRoot, 'dist/assets');

const PROD_SUPABASE_REF = 'pvmezsxdqotxaqfymmzd';
const DEV_SUPABASE_REF = 'zydabsxcbetbhrgpiaxb';
const REQUIRED_API_HOST = 'api.meald.app';

const SECRET_RG =
  /sk-proj-|AWS_SECRET_ACCESS_KEY|SUPABASE_SERVICE_ROLE|sb_secret_[A-Za-z0-9]/;

const LAN_IP_RE =
  /(?:192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|10\.(?!0\.2\.2\b)\d{1,3}\.\d{1,3}\.\d{1,3})/;

function readProductionEnv() {
  const envPath = join(frontendRoot, '.env.production');
  const text = readFileSync(envPath, 'utf8');
  const url = text.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1]?.trim();
  const api = text.match(/^VITE_API_BASE_URL=(.+)$/m)?.[1]?.trim();
  if (!url || !api) {
    console.error('FAIL: VITE_SUPABASE_URL and VITE_API_BASE_URL required in .env.production');
    process.exit(1);
  }
  return { url, api };
}

function collectAssetFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectAssetFiles(p, out);
    else if (!name.endsWith('.map')) out.push(p);
  }
  return out;
}

function main() {
  const { url: prodSupabaseUrl, api: prodApiBase } = readProductionEnv();

  if (!prodSupabaseUrl.includes(PROD_SUPABASE_REF)) {
    console.error(
      `FAIL: frontend/.env.production VITE_SUPABASE_URL must contain ${PROD_SUPABASE_REF}`
    );
    process.exit(1);
  }
  if (!prodApiBase.includes(REQUIRED_API_HOST)) {
    console.error(
      `FAIL: frontend/.env.production VITE_API_BASE_URL must use ${REQUIRED_API_HOST}`
    );
    process.exit(1);
  }

  if (!existsSync(distAssets)) {
    console.error('FAIL: dist/assets missing — run vite build first.');
    process.exit(1);
  }

  const files = collectAssetFiles(distAssets);
  let body = '';
  for (const f of files) {
    body += readFileSync(f, 'utf8');
  }

  if (!body.includes(PROD_SUPABASE_REF)) {
    console.error(`FAIL: bundle missing prod Supabase ref ${PROD_SUPABASE_REF}`);
    process.exit(1);
  }
  if (body.includes(DEV_SUPABASE_REF)) {
    console.error(`FAIL: bundle contains DEV Supabase ref ${DEV_SUPABASE_REF}`);
    process.exit(1);
  }
  if (!body.includes(REQUIRED_API_HOST)) {
    console.error(`FAIL: bundle missing API host ${REQUIRED_API_HOST}`);
    process.exit(1);
  }
  if (
    body.includes('VITE_ENABLE_DEV_SETTINGS=1') ||
    body.includes('VITE_ENABLE_DEV_SETTINGS":"1"')
  ) {
    console.error('FAIL: bundle enables VITE_ENABLE_DEV_SETTINGS');
    process.exit(1);
  }
  if (LAN_IP_RE.test(body)) {
    console.error('FAIL: bundle contains a non-emulator LAN IP');
    process.exit(1);
  }
  if (SECRET_RG.test(body)) {
    console.error('FAIL: bundle matched secret pattern (see assert-bundle-target.js)');
    process.exit(1);
  }

  console.log('OK: assert-bundle-target (prod Supabase, api.meald.app, no DEV/LAN/secrets)');
}

main();
