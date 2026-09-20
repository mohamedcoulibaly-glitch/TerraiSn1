/**
 * Suite complète cycle paiement : liens payin + dettes + PayDunya/WhatsApp (unit + intégration + E2E).
 * Usage : node scripts/run-paiement-complet-suite.js
 */
const { spawnSync } = require('child_process');
const path = require('path');

const scripts = [
  'test-liens-paiement.js',
  'test-dettes-commissions.js',
  'test-cdc-paiements.js',
  'test-paydunya-whatsapp-unit.js',
  'test-paydunya-whatsapp-integration.js',
  'test-paydunya-whatsapp-e2e.js',
];

let failed = 0;
for (const script of scripts) {
  console.log(`\n========== ${script} ==========\n`);
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    failed += 1;
    console.error(`\nSuite interrompue : ${script} a échoué (code ${result.status})`);
    break;
  }
}

if (failed) process.exit(1);
console.log('\n✅ Suite paiement complète — payin, dettes, payout, E2E : tous verts\n');
