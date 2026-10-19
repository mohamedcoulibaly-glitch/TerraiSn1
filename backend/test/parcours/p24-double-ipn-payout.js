const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p24-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.PAYMENT_MODE = 'simulation';
process.env.WHATSAPP_MOCK = 'true';

const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde, poserReservation, spies, queryOne, queryAll, runSql } = require('../helpers/fixtureDb');
const { confirmerPaiementEtNotifier } = require('../../payments/flow');
const h = createHarness('p24');

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const { reservationId } = poserReservation(db, { terrainId: monde.terrainAvance, joueurId: monde.joueurA });
  const ref = `TF-${reservationId}-P24`;
  runSql(
    db,
    `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_paytech)
     VALUES (?, 5000, 'paytech', 'en_attente', ?)`,
    [reservationId, ref],
  );
  const spy = spies();
  const r1 = await confirmerPaiementEtNotifier(reservationId, ref, { ports: spy.ports });
  const r2 = await confirmerPaiementEtNotifier(reservationId, ref, { ports: spy.ports });
  h.assertEqual('premier confirm', r1.action, 'confirm');
  h.assertEqual('second already', r2.action, 'already_confirmed');

  const dus = queryAll(db, 'SELECT * FROM dus WHERE reservation_id = ?', [reservationId]);
  h.assertEqual('un seul du', dus.length, 1);

  const paiements = queryAll(
    db,
    "SELECT * FROM paiements WHERE reservation_id = ? AND statut = 'paye'",
    [reservationId],
  );
  h.assertEqual('un seul paiement paye', paiements.length, 1);
  h.assertEqual('wa une fois', spy.calls.filter((c) => c[0] === 'wa').length, 1);

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
