#!/usr/bin/env node
/**
 * Build Render (plan free / Node natif) :
 * installe backend + frontends et compile les SPA servies par Express.
 *
 * Mono-host :
 *   /        → frontend-joueur/dist
 *   /pro     → frontend-pro/dist (VITE_BASE=/pro/)
 *   /admin   → admin-frontend/dist (legacy)
 *
 * Domaines séparés (cible) : Nginx sert chaque dist sur son host ;
 * alors builder pro avec VITE_BASE=/ (défaut).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function run(cmd, cwd, env = {}) {
  console.log(`\n==> ${cmd}`);
  execSync(cmd, {
    stdio: 'inherit',
    cwd,
    env: { ...process.env, ...env },
  });
}

function install(dir) {
  const lock = path.join(dir, 'package-lock.json');
  const cmd = fs.existsSync(lock) ? 'npm ci --include=dev' : 'npm install --include=dev';
  run(cmd, dir, { NODE_ENV: 'development' });
}

console.log('TerrainSN — build Render (joueur + pro + admin)');
install(path.join(root, 'backend'));
install(path.join(root, 'frontend-joueur'));
install(path.join(root, 'frontend-pro'));
install(path.join(root, 'admin-frontend'));

run('npm run build', path.join(root, 'frontend-joueur'), {
  NODE_ENV: 'production',
  VITE_API_URL: '/api',
});

run('npm run build', path.join(root, 'frontend-pro'), {
  NODE_ENV: 'production',
  VITE_API_URL: '/api',
  VITE_BASE: '/pro/',
});

run('npm run build', path.join(root, 'admin-frontend'), {
  NODE_ENV: 'production',
  VITE_API_URL: '/api',
  VITE_BASE: '/admin/',
});

const joueurDist = path.join(root, 'frontend-joueur', 'dist', 'index.html');
const proDist = path.join(root, 'frontend-pro', 'dist', 'index.html');
const adminDist = path.join(root, 'admin-frontend', 'dist', 'index.html');

if (!fs.existsSync(joueurDist)) {
  console.error('Build frontend-joueur manquant:', joueurDist);
  process.exit(1);
}
if (!fs.existsSync(proDist)) {
  console.error('Build frontend-pro manquant:', proDist);
  process.exit(1);
}
if (!fs.existsSync(adminDist)) {
  console.error('Build admin manquant:', adminDist);
  process.exit(1);
}

const proHtml = fs.readFileSync(proDist, 'utf8');
if (!proHtml.includes('/pro/assets')) {
  console.error(
    'Build frontend-pro invalide: assets sans préfixe /pro/ (VITE_BASE manquant).\n' +
      'Les pages /pro/* renverront 404. Relancer avec VITE_BASE=/pro/.',
  );
  process.exit(1);
}

console.log('\nBuild Render OK — joueur (/) + pro (/pro) + admin (/admin).');
