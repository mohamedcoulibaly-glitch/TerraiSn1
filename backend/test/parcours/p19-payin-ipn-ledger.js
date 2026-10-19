const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p19-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.PAYMENT_MODE = 'simulation';
process.env.WHATSAPP_MOCK = 'true';

const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde, poserReservation, spies, queryOne, runSql } = require('../helpers/fixtureDb');
const { confirmerPaiementEtNotifier } = require('../../payments/flow');
const h = createHarness('p19');

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const { reservationId } = poserReservation(db, { terrainId: monde.terrainAvance, joueurId: monde.joueurA });
  const ref = `TF-${reservationId}-P19`;
  runSql(
    db,
    `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_paytech)
     VALUES (?, 5000, 'paytech', 'en_attente', ?)`,
    [reservationId, ref],
  );
  const spy = spies();
  const result = await confirmerPaiementEtNotifier(reservationId, ref, { ports: spy.ports });
  h.assertEqual('action confirm', result.action, 'confirm');

  const resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('statut confirme', resa.statut, 'confirme');

  const paiement = queryOne(
    db,
    "SELECT * FROM paiements WHERE reservation_id = ? AND statut = 'paye'",
    [reservationId],
  );
  h.assert('paiement paye', Boolean(paiement));

  const du = queryOne(db, 'SELECT * FROM dus WHERE reservation_id = ?', [reservationId]);
  h.assert('du cree', Boolean(du));
  h.assert('du en_fenetre ou payable', du.statut === 'en_fenetre' || du.statut === 'payable');

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
