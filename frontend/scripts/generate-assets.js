/**
 * Generates placeholder icon/logo for @capacitor/assets.
 * Replace assets/logo.png with your final app icon before release.
 */
import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(__dirname, '..', 'assets');

await mkdir(assetsDir, { recursive: true });

// 1024x1024 logo: green rounded square (GrocerySync placeholder)
const size = 1024;
const innerSize = 624;
const inner = await sharp({
  create: {
    width: innerSize,
    height: innerSize,
    channels: 4,
    background: { r: 76, g: 175, b: 80, alpha: 1 },
  },
})
  .png()
  .toBuffer();

await sharp({
  create: {
    width: size,
    height: size,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  },
})
  .composite([{ input: inner, left: 200, top: 200 }])
  .png()
  .toFile(join(assetsDir, 'logo.png'));

console.log('Generated assets/logo.png (1024x1024 placeholder)');
