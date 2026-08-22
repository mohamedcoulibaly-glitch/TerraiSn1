#!/usr/bin/env node
/**
 * TerrainSN — Commande de lancement unifié (backend + frontends)
 *
 * Usage :
 *   npm run dev                → backend + frontend (8080) + admin-frontend (8081)
 *   npm run dev -- --no-admin  → backend + frontend uniquement
 *   npm run dev -- --no-frontend → backend + admin-frontend uniquement
 *   npm run accounts           → affiche uniquement les comptes de démo
 *
 * Avant de lancer les serveurs, la commande vérifie la base de données et
 * affiche les identifiants de connexion de TOUS les rôles présents en base.
 * Si la base est vide, elle exécute `npm run setup` (migrations + seed).
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const readline = require('readline');
const net = require('net');
const bcrypt = require('./backend/node_modules/bcryptjs');
const { getDb, queryAll } = require('./backend/database');

const ROOT = __dirname;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'password123';
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://terrainsn:terrainsn@localhost:5433/terrainsn';
let PG_HOST = 'localhost';
let PG_PORT = 5433;
try {
  const u = new URL(DATABASE_URL);
  if (u.hostname) PG_HOST = u.hostname;
  if (u.port) PG_PORT = Number(u.port);
} catch {
  /* defaults */
}

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const SERVICES = {
  backend: {
    name: 'Backend API',
    tag: 'API',
    color: C.magenta,
    cwd: path.join(ROOT, 'backend'),
    args: ['run', 'dev'],
    url: 'http://localhost:3001',
  },
  frontend: {
    name: 'Frontend (app joueur / backoffice)',
    tag: 'WEB',
    color: C.cyan,
    cwd: path.join(ROOT, 'frontend'),
    args: ['run', 'dev'],
    url: 'http://localhost:8080',
  },
  admin: {
    name: 'Admin Frontend (dashboard super admin)',
    tag: 'ADMIN',
    color: C.blue,
    cwd: path.join(ROOT, 'admin-frontend'),
    args: ['run', 'dev'],
    url: 'http://localhost:8081',
  },
};

const WIDTH = 74;

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const HAS_SHELL = process.platform === 'win32';

const args = process.argv.slice(2);
const ONLY_ACCOUNTS = args.includes('--accounts');
const SKIP_ADMIN = args.includes('--no-admin');
const SKIP_FRONTEND = args.includes('--no-frontend');
const SKIP_SEED = args.includes('--no-seed');

const children = [];

function logLine(color, text) {
  console.log(`${color}${text}${C.reset}`);
}

function tagLog(name, color) {
  return (line) => {
    const text = String(line).replace(/\r?\n$/, '');
    if (text.trim()) console.log(`${color}[${name}]${C.reset} ${text}`);
  };
}

function startService(spec) {
  const child = spawn(NPM, spec.args, {
    cwd: spec.cwd,
    shell: HAS_SHELL,
    env: { ...process.env },
  });
  children.push(child);

  const tag = tagLog(spec.tag, spec.color);
  const out = readline.createInterface({ input: child.stdout });
  out.on('line', tag);
  const err = readline.createInterface({ input: child.stderr });
  err.on('line', tag);

  child.on('error', (error) => tag(`ERREUR : ${error.message}`));
  child.on('exit', (code) => {
    const label = code === 0 ? `${spec.name} arrêté` : `${spec.name} arrêté (code ${code})`;
    logLine(C.yellow, `\n${label}`);
    if (children.every((c) => c.exitCode !== null)) process.exit(0);
  });
  return child;
}

function hasDependencies(cwd) {
  return require('fs').existsSync(path.join(cwd, 'node_modules'));
}

function installDependencies(spec) {
  return new Promise((resolve, reject) => {
    logLine(C.yellow, `\n  ${spec.name} : node_modules absent → installation des dépendances…`);
    const child = spawn(NPM, ['install', '--no-audit', '--no-fund'], {
      cwd: spec.cwd,
      shell: HAS_SHELL,
      env: { ...process.env },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install a échoué dans ${spec.cwd} (code ${code})`));
    });
  });
}

async function ensureDependencies(spec) {
  if (!hasDependencies(spec.cwd)) await installDependencies(spec);
}

function waitForPort(host, port, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect({ host, port }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Postgres non joignable sur ${host}:${port} après ${timeoutMs}ms`));
          return;
        }
        setTimeout(tryOnce, 1000);
      });
    };
    tryOnce();
  });
}

async function ensurePostgres() {
  try {
    await waitForPort(PG_HOST, PG_PORT, 2000);
    logLine(C.green, `  ✓ PostgreSQL disponible sur ${PG_HOST}:${PG_PORT}`);
    return;
  } catch {
    /* pas encore up */
  }

  logLine(C.yellow, '  PostgreSQL indisponible → docker compose up -d…');
  try {
    execSync('docker compose up -d', {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
    });
  } catch (err) {
    throw new Error(`Impossible de démarrer Postgres via Docker : ${err.message}`);
  }
  await waitForPort(PG_HOST, PG_PORT, 90000);
  logLine(C.green, `  ✓ PostgreSQL prêt sur ${PG_HOST}:${PG_PORT}`);
}

function shutdown() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

function runSetup() {
  return new Promise((resolve, reject) => {
    logLine(C.yellow, '\nBase de données vide → exécution de `npm run setup` (migrations + seed)…');
    const child = spawn(NPM, ['run', 'setup'], {
      cwd: path.join(ROOT, 'backend'),
      shell: HAS_SHELL,
      env: { ...process.env },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm run setup a échoué (code ${code})`));
    });
  });
}

function demoPasswordIfKnown(hash) {
  if (typeof hash !== 'string' || hash.length < 10) return '?';
  try {
    return bcrypt.compareSync(DEMO_PASSWORD, hash) ? DEMO_PASSWORD : '?';
  } catch {
    return '?';
  }
}

async function countAccounts(db) {
  const sum = async (sql) => Number((await queryAll(db, sql))[0].n);
  const users = await sum('SELECT COUNT(*) AS n FROM users');
  const proprietaires = await sum('SELECT COUNT(*) AS n FROM proprietaires');
  const employes = await sum('SELECT COUNT(*) AS n FROM employes');
  return users + proprietaires + employes;
}

async function loadAccounts(db) {
  const accounts = [];

  const users = await queryAll(
    db,
    "SELECT nom, email, telephone, role, password_hash FROM users WHERE is_active = 1 ORDER BY id"
  );
  for (const u of users) {
    if (String(u.email || '').includes('demo.flux.')) continue;
    accounts.push({
      role: u.role === 'superadmin' ? 'super_admin' : u.role,
      nom: u.nom,
      identifiant: u.email || u.telephone,
      telephone: u.telephone,
      password: demoPasswordIfKnown(u.password_hash),
    });
  }

  const proprietaires = await queryAll(
    db,
    "SELECT nom, email, telephone, password_hash FROM proprietaires WHERE statut = 'actif' ORDER BY id"
  );
  for (const p of proprietaires) {
    accounts.push({
      role: 'proprietaire',
      nom: p.nom,
      identifiant: p.email || p.telephone,
      telephone: p.telephone,
      password: demoPasswordIfKnown(p.password_hash),
    });
  }

  const employes = await queryAll(
    db,
    "SELECT nom, email, telephone, password_hash FROM employes WHERE is_active = 1 ORDER BY id"
  );
  for (const e of employes) {
    accounts.push({
      role: 'gerant',
      nom: e.nom,
      identifiant: e.email || e.telephone,
      telephone: e.telephone,
      password: demoPasswordIfKnown(e.password_hash),
    });
  }

  return accounts;
}

const ROLE_INFO = {
  super_admin: { label: 'SUPER ADMIN', url: 'Admin Dashboard', href: SERVICES.admin.url },
  proprietaire: { label: 'PROPRIÉTAIRE', url: 'Application TerrainSN', href: SERVICES.frontend.url },
  gerant: { label: 'GÉRANT', url: 'Application TerrainSN', href: SERVICES.frontend.url },
  joueur: { label: 'JOUEUR', url: 'Application TerrainSN', href: SERVICES.frontend.url },
};

function printAccounts(accounts) {
  const width = WIDTH;
  logLine(C.green, '='.repeat(width));
  logLine(C.green + C.bold, '  COMPTES DE DÉMONSTRATION — TerrainSN');
  logLine(C.dim, '  Identifiants de connexion pour chaque rôle présent en base.');
  logLine(C.dim, '  (mot de passe affiché uniquement si le hash correspond au mot de passe démo)');
  logLine(C.green, '='.repeat(width));

  const order = ['super_admin', 'proprietaire', 'gerant', 'joueur'];
  const groups = {};
  for (const a of accounts) {
    const role = a.role || 'joueur';
    if (!groups[role]) groups[role] = [];
    groups[role].push(a);
  }

  const pad = (str, len) => String(str).padEnd(len);
  let printed = 0;
  for (const role of order) {
    const list = groups[role];
    if (!list || list.length === 0) continue;
    printed += 1;
    const info = ROLE_INFO[role];
    logLine('', '');
    logLine(C.yellow + C.bold, `  ┌─ ${info.label}  —  connexion : ${info.href}`);
    logLine(C.yellow, `  │`);
    logLine(C.yellow, `  │  ${pad('Email / identifiant', 26)}${pad('Téléphone', 18)}Mot de passe`);
    logLine(C.yellow, `  │  ${'-'.repeat(58)}`);
    for (const a of list) {
      const pass = a.password === '?' ? 'mot de passe inconnu' : a.password;
      const ident = a.identifiant || a.telephone || '?';
      logLine(C.yellow, `  │  ${pad(ident, 26)}${pad(a.telephone || '-', 18)}${pass}`);
    }
    logLine(C.yellow, `  └─`);
  }

  if (printed === 0) {
    logLine(C.red, '  Aucun compte trouvé dans la base de données.');
    logLine(C.red, '  La base va être initialisée automatiquement (npm run setup).');
  }
}

async function main() {
  console.log('');
  logLine(C.green + C.bold, '  🏟️  TerrainSN — Lancement du développement');
  logLine('', '');

  try {
    await ensurePostgres();
  } catch (error) {
    logLine(C.red, `  ${error.message}`);
    process.exit(1);
  }

  let db;
  try {
    db = await getDb();
  } catch (error) {
    logLine(C.red, `  Impossible d'ouvrir la base de données : ${error.message}`);
    process.exit(1);
  }

  let accounts = await loadAccounts(db);
  if (accounts.length === 0 && !SKIP_SEED) {
    await runSetup();
    db = await getDb();
    accounts = await loadAccounts(db);
  }

  printAccounts(accounts);

  if (ONLY_ACCOUNTS) {
    console.log('');
    return;
  }

  logLine('', '');
  logLine(C.green, '='.repeat(WIDTH));
  logLine(C.bold, '  Démarrage des services…');
  logLine(C.dim, `  Appui Ctrl+C pour tout arrêter.`);
  logLine(C.green, '='.repeat(WIDTH));

  const toStart = ['backend'];
  if (!SKIP_FRONTEND) toStart.push('frontend');
  if (!SKIP_ADMIN) toStart.push('admin');

  for (const key of toStart) {
    const spec = SERVICES[key];
    await ensureDependencies(spec);
  }

  for (const key of toStart) {
    const spec = SERVICES[key];
    logLine(C.green, `  ▶ ${spec.name} → ${spec.url}`);
    startService(spec);
  }

  logLine('', '');
  logLine(C.dim, `  WhatsApp : scannez le QR via http://localhost:3001/whatsapp-qr (si besoin)`);

  process.on('SIGINT', () => {
    logLine(C.yellow, '\n  Arrêt des services…');
    shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });
}

main().catch((error) => {
  logLine(C.red, `  Erreur : ${error.message}`);
  process.exit(1);
});
