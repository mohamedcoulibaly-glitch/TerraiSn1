#!/usr/bin/env node
/**
 * Build frontend-pro pour mono-host (/pro/).
 * Override : VITE_BASE=/ npm run build:pro  (domaine dédié)
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const proDir = path.join(root, 'frontend-pro');
const base = process.env.VITE_BASE || '/pro/';

execSync('npm run build', {
  cwd: proDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    VITE_API_URL: process.env.VITE_API_URL || '/api',
    VITE_BASE: base,
  },
});

const indexHtml = path.join(proDir, 'dist', 'index.html');
if (!fs.existsSync(indexHtml)) {
  console.error('Build pro manquant:', indexHtml);
  process.exit(1);
}

const html = fs.readFileSync(indexHtml, 'utf8');
const normalized = base.replace(/\/$/, '');
if (normalized && normalized !== '/') {
  const assetPrefix = `${normalized}/assets/`;
  if (!html.includes(assetPrefix) && !html.includes(`"${normalized}/assets/`)) {
    // Vite peut émettre src="/pro/assets/..." ou src="/pro/assets/..."
    if (!html.includes(`${normalized}/assets`)) {
      console.error(
        `ERREUR: dist pro sans préfixe ${assetPrefix} — assets 404 sous mono-host.\n` +
          `Relancer avec VITE_BASE=${base}`,
      );
      process.exit(1);
    }
  }
}

console.log(`Build pro OK (VITE_BASE=${base})`);
