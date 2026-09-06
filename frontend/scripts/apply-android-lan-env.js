#!/usr/bin/env node
/**
 * Patches Android *main* cleartext allow-list for this machine's LAN IP and
 * optionally writes VITE_API_BASE_URL. Debug APKs also use
 * src/debug/res/xml/network_security_config.xml (all cleartext) so a silent
 * skip here cannot block the phone.
 *
 * Resolution: ANDROID_DEV_LAN_IP or CAP_DEV_HOST, else getLanIPv4().
 * SKIP_ANDROID_LAN_ENV=1 leaves main XML unchanged (still logs).
 *
 * Wired into cap:sync, cap:run:android, and build:mobile (--write-api-url).
 * Play AAB skips this script.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getLanIPv4,
  patchNetworkSecurityConfig,
} from './android-network-security-patch.js';
import {
  applyCapEnvVarsFromFiles,
  updateEnvLocal,
} from './load-frontend-env-for-cap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultFrontendRoot = join(__dirname, '..');

/**
 * @param {{ ANDROID_DEV_LAN_IP?: string, CAP_DEV_HOST?: string }} [env]
 * @param {() => string} [detect]
 * @returns {{ ip: string, source: 'env' | 'auto' }}
 */
export function resolveDevLanIPv4(env = process.env, detect = getLanIPv4) {
  const explicit =
    env.ANDROID_DEV_LAN_IP?.trim() || env.CAP_DEV_HOST?.trim() || '';
  if (explicit) return { ip: explicit, source: 'env' };
  return { ip: detect(), source: 'auto' };
}

/**
 * @param {{
 *   frontendRoot?: string,
 *   xmlPath?: string,
 *   envLocalPath?: string,
 *   writeApiUrl?: boolean,
 *   env?: NodeJS.ProcessEnv,
 *   detect?: () => string,
 * }} [opts]
 */
export function applyAndroidLanEnv(opts = {}) {
  const frontendRoot = opts.frontendRoot ?? defaultFrontendRoot;
  const env = opts.env ?? process.env;
  const detect = opts.detect ?? getLanIPv4;
  const xmlPath =
    opts.xmlPath ??
    join(frontendRoot, 'android/app/src/main/res/xml/network_security_config.xml');
  const envLocalPath = opts.envLocalPath ?? join(frontendRoot, '.env.local');

  const { ip, source } = resolveDevLanIPv4(env, detect);

  if (env.SKIP_ANDROID_LAN_ENV === '1') {
    console.log(
      `[apply-android-lan-env] SKIP_ANDROID_LAN_ENV=1 — not patching main XML (would have used ${source} host: ${ip})`
    );
    return { skipped: true, ip, source };
  }

  patchNetworkSecurityConfig(xmlPath, ip);
  console.log(
    `[apply-android-lan-env] Patched cleartext allow-list for ${source} host: ${ip}`
  );

  if (!opts.writeApiUrl) {
    return { skipped: false, ip, source };
  }

  const backendPort = env.CAP_BACKEND_PORT?.trim() || '5000';
  const apiBaseUrl = `http://${ip}:${backendPort}/api`;
  updateEnvLocal(envLocalPath, 'VITE_API_BASE_URL', apiBaseUrl);
  console.log(
    `[apply-android-lan-env] VITE_API_BASE_URL=${apiBaseUrl}  (written to .env.local)`
  );
  return { skipped: false, ip, source, apiBaseUrl };
}

function isInvokedAsCli() {
  const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
  return invoked === fileURLToPath(import.meta.url);
}

if (isInvokedAsCli()) {
  applyCapEnvVarsFromFiles(defaultFrontendRoot);
  applyAndroidLanEnv({
    writeApiUrl: process.argv.includes('--write-api-url'),
  });
}
