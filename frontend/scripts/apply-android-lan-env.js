#!/usr/bin/env node
/**
 * Applies LAN IP to network_security_config.xml from .env/.env.local
 * (`ANDROID_DEV_LAN_IP` or legacy `CAP_DEV_HOST`) — no git-tracked machine IP.
 * Skips silently if neither is set (emulator localhost + 10.0.2.2 still allowed).
 *
 * Wired into npm run cap:sync and cap run android (see frontend/package.json).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  patchNetworkSecurityConfig,
} from './android-network-security-patch.js';
import { applyCapEnvVarsFromFiles } from './load-frontend-env-for-cap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(__dirname, '..');

applyCapEnvVarsFromFiles(frontendRoot);

const xmlPath = join(
  frontendRoot,
  'android/app/src/main/res/xml/network_security_config.xml'
);
const ip =
  process.env.ANDROID_DEV_LAN_IP?.trim() || process.env.CAP_DEV_HOST?.trim();

if (ip) {
  patchNetworkSecurityConfig(xmlPath, ip);
  console.log(
    `[apply-android-lan-env] Patched cleartext allow-list for ANDROID_DEV/CAP_DEV host: ${ip}`
  );
}
