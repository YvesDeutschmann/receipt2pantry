/**
 * Detects this machine's LAN IPv4, patches Android cleartext allow-list for that
 * IP (or ANDROID_DEV_LAN_IP / CAP_DEV_HOST from .env /.env.local), and runs `cap sync`
 * (or `cap run android`) with DEV_SERVER_URL set so capacitor.config.ts points the
 * WebView at the Vite dev server.
 *
 * Usage: node scripts/cap-dev.js [--run-android]
 * Optional: CAP_DEV_PORT (default 5173), CAP_DEV_HOST / ANDROID_DEV_LAN_IP (skip auto-detect; use this IPv4),
 * CAP_BACKEND_PORT (default 5000) for Flask / API URL written to .env.local
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLanIPv4 } from './android-network-security-patch.js';
import { applyAndroidLanEnv } from './apply-android-lan-env.js';
import { applyCapEnvVarsFromFiles } from './load-frontend-env-for-cap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(__dirname, '..');

function runCap(args, env) {
  const result = spawnSync('npx', ['cap', ...args], {
    cwd: frontendRoot,
    env,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const runAndroid = process.argv.includes('--run-android');

applyCapEnvVarsFromFiles(frontendRoot);

const port = process.env.CAP_DEV_PORT || '5173';

const applied = applyAndroidLanEnv({ frontendRoot, writeApiUrl: true });
const ip = applied.ip || getLanIPv4();
const devUrl = `http://${ip}:${port}/`;

console.log(`DEV_SERVER_URL=${devUrl}`);
const env = { ...process.env, DEV_SERVER_URL: devUrl };

runCap(['sync'], env);
if (runAndroid) {
  runCap(['run', 'android'], env);
}
