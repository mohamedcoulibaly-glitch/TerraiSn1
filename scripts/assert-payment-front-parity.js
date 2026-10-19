/**
 * Vérifie la parité des fichiers paiement critiques entre :
 * - frontend-joueur ↔ frontend (miroir joueur)
 * - frontend-pro ↔ frontend (miroir pro)
 *
 * Usage : node scripts/assert-payment-front-parity.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');

const pairs = [
  {
    label: 'joueur/ReservationSuccess',
    a: 'frontend-joueur/src/espaces/joueur/pages/ReservationSuccess.tsx',
    b: 'frontend/src/espaces/joueur/pages/ReservationSuccess.tsx',
  },
  {
    label: 'pro/Finances',
    a: 'frontend-pro/src/espaces/backoffice/pages/gerant/Finances.tsx',
    b: 'frontend/src/espaces/backoffice/pages/gerant/Finances.tsx',
  },
];

/** Fichiers qui doivent exister et contenir des marqueurs métier (pas forcément byte-identiques). */
const markers = [
  {
    label: 'frontend-joueur Reservation canal + https',
    file: 'frontend-joueur/src/espaces/joueur/pages/Reservation.tsx',
    mustInclude: ['PAYTECH_CHECKOUT_FAILED', 'https:\\/\\/'],
  },
  {
    label: 'frontend Reservation code toast',
    file: 'frontend/src/espaces/joueur/pages/Reservation.tsx',
    mustInclude: ['PAYTECH_CHECKOUT_FAILED'],
  },
  {
    label: 'frontend-pro demanderRetrait API',
    file: 'frontend-pro/src/lib/api.ts',
    mustInclude: ["'/gerant/portefeuille/retirer'"],
  },
  {
    label: 'frontend demanderRetrait API',
    file: 'frontend/src/lib/api.ts',
    mustInclude: ["'/gerant/portefeuille/retirer'"],
  },
  {
    label: 'frontend-pro toast production',
    file: 'frontend-pro/src/espaces/backoffice/components/superadmin/ContratPaiementTab.tsx',
    mustInclude: ['fenêtre de remboursement'],
    mustNotInclude: ['moteur à brancher'],
  },
  {
    label: 'frontend toast production',
    file: 'frontend/src/espaces/backoffice/components/superadmin/ContratPaiementTab.tsx',
    mustInclude: ['fenêtre de remboursement'],
    mustNotInclude: ['moteur à brancher'],
  },
];

function hashFile(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  const buf = fs.readFileSync(abs);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

let failed = 0;

for (const pair of pairs) {
  const ha = hashFile(pair.a);
  const hb = hashFile(pair.b);
  if (!ha || !hb) {
    console.error(`FAIL  ${pair.label} — fichier manquant (${!ha ? pair.a : pair.b})`);
    failed += 1;
    continue;
  }
  if (ha !== hb) {
    console.error(`FAIL  ${pair.label} — drift hash\n  ${pair.a}\n  ${pair.b}`);
    failed += 1;
  } else {
    console.log(`OK    ${pair.label}`);
  }
}

for (const m of markers) {
  const content = read(m.file);
  if (content == null) {
    console.error(`FAIL  ${m.label} — manquant ${m.file}`);
    failed += 1;
    continue;
  }
  let ok = true;
  for (const needle of m.mustInclude || []) {
    if (!content.includes(needle)) {
      console.error(`FAIL  ${m.label} — manque « ${needle} »`);
      ok = false;
      failed += 1;
    }
  }
  for (const needle of m.mustNotInclude || []) {
    if (content.includes(needle)) {
      console.error(`FAIL  ${m.label} — contient encore « ${needle} »`);
      ok = false;
      failed += 1;
    }
  }
  if (ok) console.log(`OK    ${m.label}`);
}

if (failed > 0) {
  console.error(`\nParité paiement : ${failed} échec(s)`);
  process.exit(1);
}
console.log('\nParité paiement OK');
