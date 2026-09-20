#!/usr/bin/env node
/**
 * Build Render (plan free / Node natif) :
 * installe backend + frontends et compile les SPA servies par Express.
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
  const cmd = fs.existsSync(lock) ? 'npm ci' : 'npm install';
  run(cmd, dir);
}

console.log('TerrainSN — build Render');
install(path.join(root, 'backend'));
install(path.join(root, 'frontend'));
install(path.join(root, 'admin-frontend'));

run('npm run build', path.join(root, 'frontend'), {
  VITE_API_URL: '/api',
});

run('npm run build', path.join(root, 'admin-frontend'), {
  VITE_API_URL: '/api',
  VITE_BASE: '/admin/',
});

const frontDist = path.join(root, 'frontend', 'dist', 'index.html');
const adminDist = path.join(root, 'admin-frontend', 'dist', 'index.html');
if (!fs.existsSync(frontDist)) {
  console.error('Build frontend manquant:', frontDist);
  process.exit(1);
}
if (!fs.existsSync(adminDist)) {
  console.error('Build admin manquant:', adminDist);
  process.exit(1);
}

console.log('\nBuild Render OK — frontend + admin prêts.');
