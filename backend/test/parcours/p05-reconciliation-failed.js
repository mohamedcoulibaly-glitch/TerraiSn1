const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p05-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';

const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde, poserReservation, queryOne, runSql } = require('../helpers/fixtureDb');
const { executerReconciliation } = require('../../services/ipnReconciliation');
const h = createHarness('p05');

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const { reservationId } = poserReservation(db, { terrainId: monde.terrainAvance, joueurId: monde.joueurA });
  const ref = `TF-${reservationId}-P05`;
  runSql(db, `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_paytech, created_at) VALUES (?, 5000, 'paytech', 'en_attente', ?, '2020-01-01 00:00:00')`, [reservationId, ref]);
  const alertes = [];
  for (let i = 0; i < 3; i += 1) {
    await executerReconciliation(db, {
      gateway: { async statutPaiement() { return 'pending'; } },
      confirmer: async () => {},
      alerter: async (code) => alertes.push(code),
      seuilMs: 0,
    });
  }
  h.assert('alerte muet', alertes.includes('ipn_muet'));
  const row = queryOne(db, 'SELECT statut, qr_code_payload FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('pas confirmé', row.statut, 'en_attente_paiement');
  h.assert('pas de QR', !row.qr_code_payload);
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
