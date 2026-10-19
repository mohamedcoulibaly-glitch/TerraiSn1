/**
 * Suite Mohamed : unitaires, parcours, puis scripts historiques.
 * Usage : node scripts/run-mohamed-suite.js
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

const files = [
  'test/unit/us05-state-machine.js',
  'test/unit/us01-ipn.js',
  'test/unit/us03-auth.js',
  'test/unit/us06-gerant-notify.js',
  'test/unit/us08-lock.js',
  'test/unit/us10-openwa.js',
  'test/unit/us12-wa-status.js',
  'test/unit/us14-sans-avance.js',
  'test/unit/us16-qr.js',
  'test/unit/us19-photos.js',
  'test/unit/us21-prix-carte.js',
  'test/unit/us23-config-events.js',
  'test/unit/us25-ratelimit.js',
  'test/unit/us28-fixtures.js',
  'test/unit/us29-payout-blocages.js',
  'test/unit/us30-payin-checkout.js',
  'test/unit/us31-portefeuille-api.js',
  'test/parcours/p01-verrou.js',
  'test/parcours/p02-ipn-confirm.js',
  'test/parcours/p03-double-ipn.js',
  'test/parcours/p04-reconciliation-paid.js',
  'test/parcours/p05-reconciliation-failed.js',
  'test/parcours/p06-wa-echec.js',
  'test/parcours/p07-profils-isoles.js',
  'test/parcours/p08-otp-faux.js',
  'test/parcours/p09-sans-avance.js',
  'test/parcours/p10-mode-paiement.js',
  'test/parcours/p11-scan.js',
  'test/parcours/p12-scan-refuse.js',
  'test/parcours/p13-qr-avant-paiement.js',
  'test/parcours/p14-openwa-reboot.js',
  'test/parcours/p15-prix-etag.js',
  'test/parcours/p16-ratelimit.js',
  'test/parcours/p17-e2e-mode.js',
  'test/parcours/p18-annulation.js',
  'test/parcours/p19-payin-ipn-ledger.js',
  'test/parcours/p20-fenetre-puis-auto.js',
  'test/parcours/p21-auto-bloque-prod.js',
  'test/parcours/p22-retrait-manuel.js',
  'test/parcours/p23-retrait-canal-refuse.js',
  'test/parcours/p24-double-ipn-payout.js',
];

const legacy = [
  'scripts/test-reservation-lock.js',
  'scripts/test-paytech-payin-unit.js',
  'scripts/test-paydunya-ipn.js',
  'scripts/test-otp-auth.js',
  'scripts/test-checkin-rules.js',
  'scripts/test-pricing.js',
  'scripts/test-kanban-rules.js',
];

function run(rel) {
  const result = spawnSync(process.execPath, [path.join(root, rel)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`\nECHEC ${rel}`);
    process.exit(result.status || 1);
  }
}

for (const file of files) run(file);
if (!process.argv.includes('--skip-legacy')) {
  for (const file of legacy) run(file);
}
console.log('\nSuite Mohamed OK');
