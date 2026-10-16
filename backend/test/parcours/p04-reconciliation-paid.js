const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p04-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.PAYMENT_MODE = 'simulation';
process.env.WHATSAPP_MOCK = 'true';

const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde, poserReservation, spies, queryOne, runSql } = require('../helpers/fixtureDb');
const { confirmerPaiementEtNotifier } = require('../../payments/flow');
const { executerReconciliation } = require('../../services/ipnReconciliation');
const h = createHarness('p04');

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const { reservationId } = poserReservation(db, { terrainId: monde.terrainAvance, joueurId: monde.joueurA });
  const ref = `TF-${reservationId}-P04`;
  runSql(db, `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_paytech, created_at) VALUES (?, 5000, 'paytech', 'en_attente', ?, '2020-01-01 00:00:00')`, [reservationId, ref]);
  const spy = spies();
  const results = await executerReconciliation(db, {
    gateway: { async statutPaiement() { return 'paid'; } },
    confirmer: (id, reference) => confirmerPaiementEtNotifier(id, reference, { ports: spy.ports }),
    alerter: async () => {},
    seuilMs: 0,
  });
  h.assert('tentative', results[0] && results[0].attempts >= 1);
  h.assertEqual('confirmé', queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [reservationId]).statut, 'confirme');
  h.assert('QR', Boolean(queryOne(db, 'SELECT qr_code_payload FROM reservations WHERE id = ?', [reservationId]).qr_code_payload));
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
