/**
 * Reads frontend/.env and frontend/.env.local (later overrides earlier).
 * Applies cap-related keys to process.env for Node scripts (cap-dev, apply-android-lan-env).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CAP_KEYS = [
  'ANDROID_DEV_LAN_IP',
  'CAP_DEV_HOST',
  'CAP_DEV_PORT',
  'CAP_BACKEND_PORT',
];

/**
 * @param {string} content
 * @returns {Record<string, string>}
 */
function parseEnv(content) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of content.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1).replace(/\\n/g, '\n');
    }
    out[key] = val;
  }
  return out;
}

/**
 * @param {string} frontendRoot
 * @returns {Record<string, string>} merged .env + .env.local (local wins)
 */
export function readFrontendEnvFiles(frontendRoot) {
  const a = join(frontendRoot, '.env');
  const b = join(frontendRoot, '.env.local');
  const merged = {
    ...(existsSync(a) ? parseEnv(readFileSync(a, 'utf8')) : {}),
    ...(existsSync(b) ? parseEnv(readFileSync(b, 'utf8')) : {}),
  };
  return merged;
}

/**
 * Puts ANDROID_DEV_* and CAP_DEV_* from .env/.env.local onto process.env only when unset
 * (explicit shell exports win — same spirit as dotenv).
 *
 * @param {string} frontendRoot
 */
export function applyCapEnvVarsFromFiles(frontendRoot) {
  const merged = readFrontendEnvFiles(frontendRoot);
  for (const k of CAP_KEYS) {
    const v = merged[k];
    if (
      v !== undefined &&
      String(v).trim() !== '' &&
      process.env[k] === undefined
    ) {
      process.env[k] = String(v).trim();
    }
  }
}
