/**
 * Builds source PNGs in frontend/assets for @capacitor/assets.
 * Prefers assets/meald-logo-source.png; falls back to iOS AppIcon copy during migration.
 */
import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(__dirname, '..', 'assets');

const CREAM = { r: 245, g: 240, b: 232, alpha: 1 };
const NAVY = { r: 26, g: 26, b: 46, alpha: 1 };

function resolveLogoPath() {
  const candidates = [
    join(assetsDir, 'meald-logo-source.png'),
    join(
      __dirname,
      '..',
      'ios',
      'App',
      'App',
      'Assets.xcassets',
      'AppIcon.appiconset',
      'Meald-Logo.png',
    ),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    'No logo source found. Add frontend/assets/meald-logo-source.png (1024×1024, terracotta mark, transparent or cream background).',
  );
}

/**
 * Resize so the longest edge equals maxEdge; preserve alpha.
 */
async function resizeLogoPreserveAlpha(inputPath, maxEdge) {
  const meta = await sharp(inputPath).metadata();
  const w = meta.width ?? maxEdge;
  const h = meta.height ?? maxEdge;
  const scale = maxEdge / Math.max(w, h);
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);
  return sharp(inputPath).ensureAlpha().resize(nw, nh).png().toBuffer();
}

async function compositeCenterOpaque(canvasSize, background, logoBuffer) {
  const meta = await sharp(logoBuffer).metadata();
  const lw = meta.width ?? 0;
  const lh = meta.height ?? 0;
  const left = Math.round((canvasSize - lw) / 2);
  const top = Math.round((canvasSize - lh) / 2);
  return sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background,
    },
  }).composite([{ input: logoBuffer, left, top }]);
}

async function compositeCenterTransparent(canvasSize, logoBuffer) {
  const meta = await sharp(logoBuffer).metadata();
  const lw = meta.width ?? 0;
  const lh = meta.height ?? 0;
  const left = Math.round((canvasSize - lw) / 2);
  const top = Math.round((canvasSize - lh) / 2);
  return sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: logoBuffer, left, top }]);
}

/** Recolor non-transparent pixels (for cream mark on dark splash). */
async function recolorOpaqueLogo(logoBuffer, r, g, b) {
  const { data, info } = await sharp(logoBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  for (let i = 0; i < data.length; i += ch) {
    const a = data[i + 3];
    if (a > 0) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: ch },
  })
    .png()
    .toBuffer();
}

const logoPath = resolveLogoPath();
await mkdir(assetsDir, { recursive: true });

console.log('Using logo source:', logoPath);

// icon.png → Logo kind for @capacitor/assets (iOS icons + Android legacy); opaque cream
const iconEdge = Math.round(1024 * 0.7);
const iconLogoBuf = await resizeLogoPreserveAlpha(logoPath, iconEdge);
await (await compositeCenterOpaque(1024, CREAM, iconLogoBuf))
  .png()
  .toFile(join(assetsDir, 'icon.png'));

// Adaptive icon layers (overwrite Android adaptive output from logo)
const fgEdge = Math.round(1024 * 0.62);
const fgLogoBuf = await resizeLogoPreserveAlpha(logoPath, fgEdge);
await (await compositeCenterTransparent(1024, fgLogoBuf))
  .png()
  .toFile(join(assetsDir, 'icon-foreground.png'));

await sharp({
  create: {
    width: 1024,
    height: 1024,
    channels: 4,
    background: CREAM,
  },
})
  .png()
  .toFile(join(assetsDir, 'icon-background.png'));

// Full splash sources (overwrite logo-composited splashes from capacitor-assets)
const splashSize = 2732;
const splashEdge = Math.round(splashSize * 0.33);
const splashLogoBuf = await resizeLogoPreserveAlpha(logoPath, splashEdge);
await (await compositeCenterOpaque(splashSize, CREAM, splashLogoBuf))
  .png()
  .toFile(join(assetsDir, 'splash.png'));

const creamMarkBuf = await recolorOpaqueLogo(splashLogoBuf, CREAM.r, CREAM.g, CREAM.b);
await (await compositeCenterOpaque(splashSize, NAVY, creamMarkBuf))
  .png()
  .toFile(join(assetsDir, 'splash-dark.png'));

console.log(
  'Generated icon.png, icon-foreground.png, icon-background.png, splash.png, splash-dark.png',
);
