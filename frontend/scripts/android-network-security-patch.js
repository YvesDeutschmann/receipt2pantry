/**
 * Patches Android res/xml/network_security_config.xml so cleartext HTTP is allowed
 * to your dev machine LAN IP (physical device hitting host machine).
 *
 * Shared by cap-dev.js and apply-android-lan-env.js (run before cap sync).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';

/** Matches LAN <domain> entries (not emulator 10.0.2.2). */
export const LAN_DOMAIN_RE =
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

export function getLanIPv4() {
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

export function patchNetworkSecurityConfig(xmlPath, newIp) {
  let xml = readFileSync(xmlPath, 'utf8');
  const original = xml;

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
