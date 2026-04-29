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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getLanIPv4,
  patchNetworkSecurityConfig,
} from './android-network-security-patch.js';
import { applyCapEnvVarsFromFiles } from './load-frontend-env-for-cap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(__dirname, '..');

function updateEnvLocal(envPath, key, value) {
  let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const lineRE = new RegExp(`^${key.replace(/\\/g, '\\\\').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm');
  const newLine = `${key}=${value}`;
  if (lineRE.test(content)) {
    content = content.replace(lineRE, newLine);
  } else {
    content += (content && !content.endsWith('\n') ? '\n' : '') + newLine + '\n';
  }
  writeFileSync(envPath, content, 'utf8');
}

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

const ip =
  process.env.ANDROID_DEV_LAN_IP?.trim() ||
  process.env.CAP_DEV_HOST?.trim() ||
  getLanIPv4();
const devUrl = `http://${ip}:${port}/`;

const xmlPath = join(
  frontendRoot,
  'android',
  'app',
  'src',
  'main',
  'res',
  'xml',
  'network_security_config.xml'
);
patchNetworkSecurityConfig(xmlPath, ip);

const backendPort = process.env.CAP_BACKEND_PORT || '5000';
const apiBaseUrl = `http://${ip}:${backendPort}/api`;
const envLocalPath = join(frontendRoot, '.env.local');
updateEnvLocal(envLocalPath, 'VITE_API_BASE_URL', apiBaseUrl);
console.log(`VITE_API_BASE_URL=${apiBaseUrl}  (written to .env.local)`);

console.log(`DEV_SERVER_URL=${devUrl}`);
const env = { ...process.env, DEV_SERVER_URL: devUrl };

runCap(['sync'], env);
if (runAndroid) {
  runCap(['run', 'android'], env);
}
