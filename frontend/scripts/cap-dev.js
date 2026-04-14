/**
 * Detects this machine's LAN IPv4, patches Android cleartext allow-list for that
 * IP, and runs `cap sync` (or `cap run android`) with DEV_SERVER_URL set so
 * capacitor.config.ts points the WebView at the Vite dev server.
 *
 * Usage: node scripts/cap-dev.js [--run-android]
 * Optional: CAP_DEV_PORT (default 5173), CAP_DEV_HOST (skip auto-detect; use this IPv4),
 * CAP_BACKEND_PORT (default 5000) for Flask / API URL written to .env.local
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(__dirname, '..');

/** Matches <domain> entries that look like a dev machine LAN IP (not 10.0.2.2 emulator). */
const LAN_DOMAIN_RE =
  /<domain includeSubdomains="true">(192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|10\.(?:\d{1,3}\.){2}\d{1,3})<\/domain>/g;

/**
 * Prefer Wi‑Fi / typical LAN IPs over Hyper‑V, WSL, Docker bridges, etc.
 * @returns {number} higher = better candidate
 */
function scoreCandidate(ifaceName, address) {
  const name = ifaceName.toLowerCase();
  if (
    name.includes('vethernet') ||
    name.includes('v ethernet') ||
    name.includes('hyper-v') ||
    name.includes('wsl') ||
    name.includes('virtualbox') ||
    name.includes('vmnet') ||
    name.includes('vmware') ||
    name.includes('docker') ||
    name.includes('br-') ||
    name.includes('vboxnet')
  ) {
    return -1;
  }
  if (address.startsWith('169.254.')) return -1;
  let score = 0;
  if (address.startsWith('192.168.')) score = 100;
  else if (address.startsWith('10.') && address !== '10.0.2.2') score = 80;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score = 60;
  else score = 10;
  // Prefer adapters that look like physical Wi‑Fi / Ethernet (not WSL/Hyper‑V).
  if (
    name.includes('wi-fi') ||
    name.includes('wifi') ||
    name.includes('wireless') ||
    name.includes('wlan') ||
    name.includes('wlp') ||
    name.includes('ethernet') ||
    name.endsWith(' ethernet') ||
    /^en\d/.test(name)
  ) {
    score += 50;
  }
  return score;
}

function getLanIPv4() {
  const nets = os.networkInterfaces();
  /** @type {{ address: string; score: number }[]} */
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      const family = net.family;
      const isV4 = family === 'IPv4' || family === 4;
      if (!isV4 || net.internal) continue;
      const score = scoreCandidate(name, net.address);
      if (score >= 0) {
        candidates.push({ address: net.address, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > 0) {
    return candidates[0].address;
  }
  throw new Error(
    'No non-internal IPv4 address found. Connect to Wi-Fi or ethernet, then retry.'
  );
}

function patchNetworkSecurityConfig(xmlPath, newIp) {
  const original = readFileSync(xmlPath, 'utf8');
  let xml = original;

  xml = xml.replace(LAN_DOMAIN_RE, (full, ip) => {
    if (ip === '10.0.2.2') return full;
    return `<domain includeSubdomains="true">${newIp}</domain>`;
  });

  const marker = `>${newIp}<`;
  if (!xml.includes(marker)) {
    xml = xml.replace(
      /(<domain includeSubdomains="true">localhost<\/domain>)/,
      `$1\n    <domain includeSubdomains="true">${newIp}</domain>`
    );
  }

  if (xml !== original) {
    writeFileSync(xmlPath, xml, 'utf8');
  }
}

/**
 * Upsert KEY=value in .env.local so `vite build` bakes in the LAN API base URL.
 * Production bundles load from https://localhost/ in the WebView; without this,
 * apiClient would use localhost:5000 (the phone), not the dev machine.
 * @param {string} envPath
 * @param {string} key
 * @param {string} value
 */
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
const port = process.env.CAP_DEV_PORT || '5173';

const ip = process.env.CAP_DEV_HOST?.trim() || getLanIPv4();
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
