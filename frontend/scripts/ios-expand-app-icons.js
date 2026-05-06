/**
 * @capacitor/assets v3 only emits a single iOS 1024 marketing icon. App Store validation
 * for universal apps with deployment target below iOS 17 still expects the full catalog. This
 * script runs after `capacitor-assets generate` and rebuilds AppIcon.appiconset from
 * assets/icon.png (opaque sRGB).
 */
import sharp from 'sharp';
import { writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const sourcePath = join(root, 'assets', 'icon.png');
const appIconSet = join(root, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');

/** @type {{ filename: string; px: number }[]} */
const outputs = [
  { filename: 'AppIcon-20x20@1x.png', px: 20 },
  { filename: 'AppIcon-20x20@2x.png', px: 40 },
  { filename: 'AppIcon-20x20@3x.png', px: 60 },
  { filename: 'AppIcon-29x29@1x.png', px: 29 },
  { filename: 'AppIcon-29x29@2x.png', px: 58 },
  { filename: 'AppIcon-29x29@3x.png', px: 87 },
  { filename: 'AppIcon-40x40@1x.png', px: 40 },
  { filename: 'AppIcon-40x40@2x.png', px: 80 },
  { filename: 'AppIcon-40x40@3x.png', px: 120 },
  { filename: 'AppIcon-60x60@2x.png', px: 120 },
  { filename: 'AppIcon-60x60@3x.png', px: 180 },
  { filename: 'AppIcon-76x76@1x.png', px: 76 },
  { filename: 'AppIcon-76x76@2x.png', px: 152 },
  { filename: 'AppIcon-83.5x83.5@2x.png', px: 167 },
  { filename: 'AppIcon-512@2x.png', px: 1024 },
];

const contents = {
  images: [
    {
      size: '20x20',
      idiom: 'iphone',
      filename: 'AppIcon-20x20@2x.png',
      scale: '2x',
    },
    {
      size: '20x20',
      idiom: 'iphone',
      filename: 'AppIcon-20x20@3x.png',
      scale: '3x',
    },
    {
      size: '29x29',
      idiom: 'iphone',
      filename: 'AppIcon-29x29@2x.png',
      scale: '2x',
    },
    {
      size: '29x29',
      idiom: 'iphone',
      filename: 'AppIcon-29x29@3x.png',
      scale: '3x',
    },
    {
      size: '40x40',
      idiom: 'iphone',
      filename: 'AppIcon-40x40@2x.png',
      scale: '2x',
    },
    {
      size: '40x40',
      idiom: 'iphone',
      filename: 'AppIcon-40x40@3x.png',
      scale: '3x',
    },
    {
      size: '60x60',
      idiom: 'iphone',
      filename: 'AppIcon-60x60@2x.png',
      scale: '2x',
    },
    {
      size: '60x60',
      idiom: 'iphone',
      filename: 'AppIcon-60x60@3x.png',
      scale: '3x',
    },
    {
      size: '20x20',
      idiom: 'ipad',
      filename: 'AppIcon-20x20@1x.png',
      scale: '1x',
    },
    {
      size: '20x20',
      idiom: 'ipad',
      filename: 'AppIcon-20x20@2x.png',
      scale: '2x',
    },
    {
      size: '29x29',
      idiom: 'ipad',
      filename: 'AppIcon-29x29@1x.png',
      scale: '1x',
    },
    {
      size: '29x29',
      idiom: 'ipad',
      filename: 'AppIcon-29x29@2x.png',
      scale: '2x',
    },
    {
      size: '40x40',
      idiom: 'ipad',
      filename: 'AppIcon-40x40@1x.png',
      scale: '1x',
    },
    {
      size: '40x40',
      idiom: 'ipad',
      filename: 'AppIcon-40x40@2x.png',
      scale: '2x',
    },
    {
      size: '76x76',
      idiom: 'ipad',
      filename: 'AppIcon-76x76@1x.png',
      scale: '1x',
    },
    {
      size: '76x76',
      idiom: 'ipad',
      filename: 'AppIcon-76x76@2x.png',
      scale: '2x',
    },
    {
      size: '83.5x83.5',
      idiom: 'ipad',
      filename: 'AppIcon-83.5x83.5@2x.png',
      scale: '2x',
    },
    {
      size: '1024x1024',
      idiom: 'ios-marketing',
      filename: 'AppIcon-512@2x.png',
      scale: '1x',
    },
  ],
  info: {
    author: 'xcode',
    version: 1,
  },
};

async function writeOpaqueIconPng(px, dest) {
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .flatten({ background: '#F5F0E8' })
    .resize(px, px)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toFile(dest);
}

for (const { filename, px } of outputs) {
  await writeOpaqueIconPng(px, join(appIconSet, filename));
}

await writeFile(join(appIconSet, 'Contents.json'), `${JSON.stringify(contents, null, 2)}\n`);

console.log('Expanded iOS AppIcon.appiconset with', outputs.length, 'PNGs + Contents.json');
