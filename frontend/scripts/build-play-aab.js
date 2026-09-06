#!/usr/bin/env node
/**
 * Build a signed Play Internal-testing AAB + run Area 5 pre-upload checks.
 *
 * From frontend/:
 *   npm run build:play-aab
 *
 * Steps:
 *   1. Bump versionCode / versionName in android/app/build.gradle
 *   2. Strip any LAN IP from network_security_config (release must not ship cleartext LAN)
 *   3. Mobile production bundle + cap sync (no apply-android-lan-env)
 *   4. ./gradlew bundleRelease
 *   5. rg secrets check on dist/assets → zero hits (excluding .map SDK docs)
 *   6. Fail if AAB (or source XML) still contains a non-emulator LAN IP
 *      (AAB scan excludes *.map — source maps are not loaded by the WebView)
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripLanDomainsFromNetworkSecurityConfig } from './android-network-security-patch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(__dirname, '..');
const androidRoot = join(frontendRoot, 'android');
const xmlPath = join(
  androidRoot,
  'app/src/main/res/xml/network_security_config.xml'
);
const aabPath = join(
  androidRoot,
  'app/build/outputs/bundle/release/app-release.aab'
);
const buildGradlePath = join(androidRoot, 'app/build.gradle');
const distAssets = join(frontendRoot, 'dist/assets');

/** Same pattern as Play Internal testing plan pre-upload check. */
const SECRET_RG_PATTERN =
  'sk-|eyJhbGciOiJIUzI1NiI|SUPABASE_SERVICE_ROLE|SERVICE_ROLE';
/** Private LAN ranges; 10.0.2.2 filtered out in findLanIps (emulator loopback). */
const LAN_IP_RE =
  /(?:192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})/g;

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? frontendRoot,
    env: opts.env ?? process.env,
    stdio: 'inherit',
    shell: opts.shell ?? false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readProductionApiBaseUrl() {
  const envPath = join(frontendRoot, '.env.production');
  const match = readFileSync(envPath, 'utf8').match(/^VITE_API_BASE_URL=(.+)$/m);
  const url = match?.[1]?.trim();
  if (!url) {
    console.error('FAIL: VITE_API_BASE_URL missing from frontend/.env.production');
    process.exit(1);
  }
  return url;
}

function readVersion(gradle = readFileSync(buildGradlePath, 'utf8')) {
  const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
  const versionName = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
  if (!Number.isFinite(versionCode) || !versionName) {
    console.error('FAIL: could not parse versionCode / versionName from app/build.gradle');
    process.exit(1);
  }
  return { versionCode, versionName };
}

/** Bump last numeric segment of a dotted versionName (1.0 → 1.1, 1.0.1 → 1.0.2). */
function bumpVersionName(name) {
  const parts = name.split('.');
  const last = parts.length - 1;
  const n = Number(parts[last]);
  if (!Number.isFinite(n)) {
    return `${name}.1`;
  }
  parts[last] = String(n + 1);
  return parts.join('.');
}

function bumpVersions() {
  const gradle = readFileSync(buildGradlePath, 'utf8');
  const { versionCode, versionName } = readVersion(gradle);
  const nextCode = versionCode + 1;
  const nextName = bumpVersionName(versionName);
  const updated = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${nextCode}`)
    .replace(/versionName\s+"[^"]+"/, `versionName "${nextName}"`);
  writeFileSync(buildGradlePath, updated, 'utf8');
  console.log(
    `Bumped versionCode ${versionCode} → ${nextCode}, versionName "${versionName}" → "${nextName}"`
  );
  return { versionCode: nextCode, versionName: nextName };
}

function collectFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectFiles(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * Plan check: rg "sk-|eyJhbGciOiJIUzI1NiI|SUPABASE_SERVICE_ROLE|SERVICE_ROLE" dist/assets/
 * Exclude *.map — vite hidden source maps include Supabase SDK docs that mention
 * SERVICE_ROLE; they are not linked into the WebView bundle.
 */
function checkDistSecrets() {
  console.log(
    `\n[check] rg "${SECRET_RG_PATTERN}" dist/assets/ (excluding *.map) → zero hits`
  );
  if (!existsSync(distAssets)) {
    console.error('FAIL: dist/assets missing — vite build did not produce assets.');
    process.exit(1);
  }
  const result = spawnSync(
    'rg',
    [
      SECRET_RG_PATTERN,
      distAssets,
      '--glob',
      '!**/*.map',
      '--line-number',
      '--color',
      'never',
    ],
    { cwd: frontendRoot, encoding: 'utf8' }
  );
  // rg exit 0 = matches, 1 = no matches, 2 = error
  if (result.status === 2 || result.error) {
    console.error(
      `FAIL: rg could not scan dist/assets (${result.error?.message || result.stderr || 'exit 2'})`
    );
    process.exit(1);
  }
  if (result.status === 0 && result.stdout?.trim()) {
    console.error('FAIL: secret-like patterns found (expected zero hits):\n');
    console.error(result.stdout.trim());
    process.exit(1);
  }
  console.log('OK: zero hits in dist/assets');
}

function findLanIps(text) {
  const found = new Set();
  for (const m of text.matchAll(LAN_IP_RE)) {
    if (m[0] === '10.0.2.2') continue;
    found.add(m[0]);
  }
  return [...found];
}

function checkSourceNetworkSecurity() {
  console.log('\n[check] Source network_security_config.xml…');
  const xml = readFileSync(xmlPath, 'utf8');
  const ips = findLanIps(xml);
  if (ips.length) {
    console.error(`FAIL: LAN IP(s) still in source XML: ${ips.join(', ')}`);
    process.exit(1);
  }
  console.log('OK: source XML has only localhost / 10.0.2.2 (no LAN IP)');
}

function checkAabNetworkSecurity() {
  console.log('\n[check] Unpacking AAB for LAN IP strings…');
  if (!existsSync(aabPath)) {
    console.error(`FAIL: AAB not found at ${aabPath}`);
    process.exit(1);
  }
  const tmp = mkdtempSync(join(tmpdir(), 'meald-aab-'));
  try {
    const unzip = spawnSync('unzip', ['-qq', aabPath, '-d', tmp], {
      stdio: 'inherit',
    });
    if (unzip.status !== 0) {
      console.error('FAIL: could not unzip AAB');
      process.exit(1);
    }
    const hits = [];
    for (const file of collectFiles(tmp)) {
      // Skip source maps — Vite hidden maps include SDK docs with example LAN IPs
      // (e.g. 192.168.0.1). Maps are not loaded by the WebView.
      if (file.endsWith('.map')) continue;
      let buf;
      try {
        buf = readFileSync(file);
      } catch {
        continue;
      }
      // Binary resources may still embed domain strings as UTF-8
      const text = buf.toString('utf8');
      const ips = findLanIps(text);
      if (ips.length) {
        hits.push({
          file: file.replace(tmp + '/', ''),
          ips,
        });
      }
    }
    if (hits.length) {
      console.error('FAIL: LAN IP(s) found inside AAB:');
      for (const h of hits) {
        console.error(`  - ${h.file}: ${h.ips.join(', ')}`);
      }
      process.exit(1);
    }
    console.log('OK: no LAN IP strings in AAB payload');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --- main ---
const { versionCode, versionName } = bumpVersions();
console.log(
  `Meald Play AAB build (versionCode=${versionCode}, versionName=${versionName})`
);

const stripped = stripLanDomainsFromNetworkSecurityConfig(xmlPath);
if (stripped) {
  console.log('Stripped LAN cleartext domain(s) from network_security_config.xml');
} else {
  console.log('network_security_config.xml already has no LAN domains');
}

run('npm', ['run', 'cap:patch']);
const productionApiBase = readProductionApiBaseUrl();
// Force the production API URL so a leftover LAN line in .env.local cannot win.
run('npx', ['vite', 'build'], {
  env: { ...process.env, VITE_API_BASE_URL: productionApiBase },
});
// Intentionally skip apply-android-lan-env.js — Play builds must not inject LAN cleartext.
run('npx', ['cap', 'sync']);

run('bash', ['./gradlew', 'bundleRelease'], { cwd: androidRoot });

checkDistSecrets();
checkSourceNetworkSecurity();
checkAabNetworkSecurity();

console.log(`
BUILD OK
  AAB: ${aabPath}
  versionCode=${versionCode}  versionName=${versionName}

Next: upload this AAB to Play Console → Testing → Internal testing.
`);
