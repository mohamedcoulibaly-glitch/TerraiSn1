/**
 * Génère les icônes PWA PNG à partir du SVG source.
 * Usage: node scripts/generate-icons.mjs
 */
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const svgPath = join(publicDir, 'icons', 'icon.svg');

mkdirSync(join(publicDir, 'icons'), { recursive: true });

const svg = readFileSync(svgPath);

const sizes = [
  { name: 'favicon.png', size: 32 },
  { name: 'icons/icon-72.png', size: 72 },
  { name: 'icons/icon-96.png', size: 96 },
  { name: 'icons/icon-128.png', size: 128 },
  { name: 'icons/icon-144.png', size: 144 },
  { name: 'icons/icon-152.png', size: 152 },
  { name: 'icons/icon-192.png', size: 192 },
  { name: 'icons/icon-384.png', size: 384 },
  { name: 'icons/icon-512.png', size: 512 },
  { name: 'icons/icon-maskable-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

for (const { name, size } of sizes) {
  const out = join(publicDir, name);
  mkdirSync(dirname(out), { recursive: true });
  await sharp(svg)
    .resize(size, size)
    .png({ quality: 90, compressionLevel: 9 })
    .toFile(out);
  console.log(`✓ ${name} (${size}px)`);
}

console.log('Icônes PWA générées.');
