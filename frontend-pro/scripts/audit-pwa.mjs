/**
 * Audit PWA local / CI — vérifie installabilité (manifest, SW, icônes).
 * Compatible Lighthouse 10+ (catégorie PWA retirée du core).
 *
 * Usage: node scripts/audit-pwa.mjs
 * Prérequis: npm run build
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, '..', 'dist');
const errors = [];
const warnings = [];

function ok(msg) {
  console.log(`✓ ${msg}`);
}
function fail(msg) {
  errors.push(msg);
  console.error(`✗ ${msg}`);
}
function warn(msg) {
  warnings.push(msg);
  console.warn(`⚠ ${msg}`);
}

if (!existsSync(dist)) {
  fail('Dossier dist/ introuvable — lancez npm run build');
  process.exit(1);
}

const indexPath = join(dist, 'index.html');
if (!existsSync(indexPath)) {
  fail('dist/index.html manquant');
} else {
  const html = readFileSync(indexPath, 'utf8');
  if (!/rel=["']manifest["']/i.test(html)) fail('Lien <link rel="manifest"> absent de index.html');
  else ok('Manifest lié dans index.html');

  if (!/name=["']theme-color["']/i.test(html)) warn('meta theme-color absent');
  else ok('theme-color présent');

  if (!/apple-mobile-web-app-capable/i.test(html)) warn('apple-mobile-web-app-capable absent');
  else ok('Meta Apple Web App présente');
}

const manifestCandidates = [
  join(dist, 'manifest.webmanifest'),
  join(dist, 'manifest.json'),
];
const manifestPath = manifestCandidates.find((p) => existsSync(p));
if (!manifestPath) {
  fail('manifest.webmanifest / manifest.json introuvable dans dist/');
} else {
  ok(`Manifest trouvé: ${manifestPath.split(/[/\\]/).pop()}`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    fail('Manifest JSON invalide');
    manifest = null;
  }

  if (manifest) {
    for (const key of ['name', 'short_name', 'start_url', 'display', 'icons']) {
      if (manifest[key] == null || manifest[key] === '') fail(`Manifest: champ requis manquant "${key}"`);
    }

    if (!['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display)) {
      fail(`Manifest display="${manifest.display}" — attendu standalone/fullscreen/minimal-ui`);
    } else {
      ok(`display=${manifest.display}`);
    }

    if (!manifest.theme_color) warn('theme_color absent du manifest');
    else ok(`theme_color=${manifest.theme_color}`);

    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    if (!icons.some((i) => String(i.sizes || '').includes('192'))) fail('Icône 192x192 manquante');
    else ok('Icône 192x192');
    if (!icons.some((i) => String(i.sizes || '').includes('512'))) fail('Icône 512x512 manquante');
    else ok('Icône 512x512');
    if (!icons.some((i) => String(i.purpose || '').includes('maskable'))) warn('Icône maskable absente');
    else ok('Icône maskable');
  }
}

const distFiles = readdirSync(dist);
const swFile = distFiles.find((f) => /^sw\.(js|mjs)$/.test(f));
const hasWorkbox = distFiles.some((f) => f.startsWith('workbox-') || f === 'registerSW.js');

if (swFile) {
  ok(`Service Worker: ${swFile}`);
  const swContent = readFileSync(join(dist, swFile), 'utf8');
  if (!/precache|caches\.|workbox/i.test(swContent)) warn('SW sans stratégie de cache explicite');
  else ok('Stratégie de cache présente dans le SW');
  if (!/addEventListener\(["']push["']/i.test(swContent) && !/\.on\(["']push["']/i.test(swContent) && !/push/i.test(swContent)) {
    warn('Handlers push absents du SW');
  } else {
    ok('Handlers Web Push présents dans le SW');
  }
} else if (hasWorkbox) {
  ok('Artefacts Service Worker / Workbox détectés');
} else {
  fail('Service Worker introuvable dans dist/ (sw.js)');
}

for (const rel of ['icons/icon-192.png', 'icons/icon-512.png', 'favicon.png']) {
  if (!existsSync(join(dist, rel))) fail(`Asset manquant: dist/${rel}`);
  else ok(`Asset: ${rel}`);
}

console.log('\n--- Résumé audit PWA ---');
console.log(`Erreurs: ${errors.length} | Avertissements: ${warnings.length}`);
if (errors.length) {
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
console.log('PWA installable: OK');
process.exit(0);
