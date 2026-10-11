/**
 * Vérification statique merge-final : env + routes FE↔BE
 * Usage: node backend/scripts/verify-merge-static.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'uploads' || name === 'data') continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

// --- 1.2 ENV ---
const backendFiles = walk(path.join(ROOT, 'backend'), ['.js']).filter(
  (f) => !f.includes(`${path.sep}scripts${path.sep}`) && !f.includes(`${path.sep}test${path.sep}`),
);
const envUsed = new Set();
const envRe = /process\.env\.([A-Z0-9_]+)/g;
for (const f of backendFiles) {
  const s = read(f);
  let m;
  while ((m = envRe.exec(s))) envUsed.add(m[1]);
}

const envExampleRaw = read(path.join(ROOT, 'backend', '.env.example'));
const envDocumented = new Set();
for (const line of envExampleRaw.split(/\r?\n/)) {
  const m = line.match(/^\s*#?\s*([A-Z0-9_]+)=/);
  if (m) envDocumented.add(m[1]);
}

const envMissing = [...envUsed].filter((e) => !envDocumented.has(e)).sort();
const envDocumentedUnused = [...envDocumented].filter((e) => !envUsed.has(e)).sort();

const feFiles = walk(path.join(ROOT, 'frontend', 'src'), ['.ts', '.tsx', '.js', '.jsx']);
const viteUsed = new Set();
const viteRe = /import\.meta\.env\.(VITE_[A-Z0-9_]+)/g;
for (const f of feFiles) {
  const s = read(f);
  let m;
  while ((m = viteRe.exec(s))) viteUsed.add(m[1]);
}
const feEnvExample = read(path.join(ROOT, 'frontend', '.env.example'));
const viteDoc = new Set();
for (const line of feEnvExample.split(/\r?\n/)) {
  const m = line.match(/^\s*#?\s*(VITE_[A-Z0-9_]+)=/);
  if (m) viteDoc.add(m[1]);
}
const viteMissing = [...viteUsed].filter((e) => !viteDoc.has(e)).sort();

// --- 1.3 Routes ---
const apiFiles = [
  path.join(ROOT, 'frontend', 'src', 'lib', 'api.ts'),
  path.join(ROOT, 'frontend', 'src', 'services', 'superAdminApi.ts'),
];
const fePaths = new Set();
const pathRe = /(?:request|adminRequest)\(\s*[`'"](\/[^`'"]+)/g;
for (const f of apiFiles) {
  const s = read(f);
  let m;
  while ((m = pathRe.exec(s))) {
    let p = m[1]
      .replace(/\$\{[^}]+\}/g, ':param')
      .split('?')[0]
      .replace(/\/+$/, '');
    fePaths.add(p);
  }
}

const beRouteFiles = [
  'backend/index.js',
  'backend/routes/admin.js',
  'backend/routes/adminPaiements.js',
  'backend/routes/roles.js',
  'backend/routes/multiGerants.js',
  'backend/payments/routes.js',
  'backend/gerantCrm.js',
  'backend/gerantCheckin.js',
  'backend/gerantExtras.js',
].map((p) => path.join(ROOT, p));

const beCorpus = beRouteFiles.map((f) => (fs.existsSync(f) ? read(f) : '')).join('\n');

function pathLikelyExists(fePath) {
  // Normalize FE paths (relative to /api)
  const candidates = [];
  let p = fePath;
  if (!p.startsWith('/api') && !p.startsWith('/admin') && !p.startsWith('/webhook') && !p.startsWith('/paytech') && !p.startsWith('/paydunya')) {
    candidates.push(`/api${p}`);
  }
  candidates.push(p);
  if (p.startsWith('/admin')) candidates.push(`/api${p}`);
  if (p.startsWith('/api/admin')) candidates.push(p.replace(/^\/api/, ''));

  for (const c of candidates) {
    // Strip :param segments for loose match
    const core = c
      .replace(/:param/g, '')
      .replace(/\/+/g, '/')
      .replace(/\(.*?\)/g, '');
    const parts = core.split('/').filter(Boolean);
    // Need last meaningful segment present in backend as route string
    const needles = [
      c,
      c.replace(/:param/g, ':id'),
      `'${parts.slice(-2).join('/')}'`,
      `"${parts.slice(-2).join('/')}"`,
      `'/${parts.join('/')}'`,
      `"/${parts.join('/')}"`,
      `/${parts.slice(-3).join('/')}`,
      `/${parts.slice(-2).join('/')}`,
      `/${parts[parts.length - 1]}`,
    ];
    for (const n of needles) {
      if (n.length > 3 && beCorpus.includes(n.replace(/:id/g, ''))) return true;
      if (n.length > 3 && beCorpus.includes(n)) return true;
    }
    // Special known mounts
    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];
    if (prev && last && (beCorpus.includes(`/${prev}/${last}`) || beCorpus.includes(`'/${prev}/`) || beCorpus.includes(`"/${prev}/`))) {
      return true;
    }
  }
  return false;
}

const unmatched = [];
const matched = [];
for (const p of [...fePaths].sort()) {
  if (pathLikelyExists(p)) matched.push(p);
  else unmatched.push(p);
}

// Manual overrides for known aliases
const knownOk = [
  '/backoffice/auth/login', // mounted as /api/backoffice/auth/login
  '/webhook/paytech/simulate',
  '/paytech/mock/complete',
];
const stillUnmatched = unmatched.filter((p) => {
  if (knownOk.some((k) => p.includes(k.replace(/^\//, '')) || p === k)) return false;
  // Re-check with /api prefix string in corpus
  const bare = p.replace(/^\/api/, '');
  return !(
    beCorpus.includes(p) ||
    beCorpus.includes(`/api${bare}`) ||
    beCorpus.includes(bare) ||
    beCorpus.includes(bare.replace(/:param/g, ':id')) ||
    beCorpus.includes(bare.replace(/:param/g, '${'))
  );
});

console.log(JSON.stringify({
  env: {
    usedRuntime: [...envUsed].sort(),
    missingFromExample: envMissing,
    documentedButMaybeScriptsOnly: envDocumentedUnused.slice(0, 30),
  },
  vite: { used: [...viteUsed], missingFromExample: viteMissing },
  routes: {
    feCount: fePaths.size,
    matchedCount: matched.length,
    unmatched: stillUnmatched,
    unmatchedLoose: unmatched,
  },
}, null, 2));
