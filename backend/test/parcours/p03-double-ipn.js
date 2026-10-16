const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p03-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.PAYMENT_MODE = 'simulation';
process.env.WHATSAPP_MOCK = 'true';

const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde, poserReservation, spies, queryOne, runSql } = require('../helpers/fixtureDb');
const { confirmerPaiementEtNotifier } = require('../../payments/flow');
const h = createHarness('p03');

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const { reservationId } = poserReservation(db, { terrainId: monde.terrainAvance, joueurId: monde.joueurA });
  const ref = `TF-${reservationId}-P03`;
  runSql(db, `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_paytech) VALUES (?, 5000, 'paytech', 'en_attente', ?)`, [reservationId, ref]);
  const spy = spies();
  await confirmerPaiementEtNotifier(reservationId, ref, { ports: spy.ports });
  const code = queryOne(db, 'SELECT code_reservation FROM reservations WHERE id = ?', [reservationId]).code_reservation;
  await confirmerPaiementEtNotifier(reservationId, ref, { ports: spy.ports });
  h.assertEqual('wa unique', spy.calls.filter((c) => c[0] === 'wa').length, 1);
  h.assertEqual('même code', queryOne(db, 'SELECT code_reservation FROM reservations WHERE id = ?', [reservationId]).code_reservation, code);
  const payes = queryOne(db, "SELECT COUNT(*) AS n FROM paiements WHERE reservation_id = ? AND statut = 'paye'", [reservationId]);
  h.assertEqual('un paye', Number(payes.n), 1);
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
