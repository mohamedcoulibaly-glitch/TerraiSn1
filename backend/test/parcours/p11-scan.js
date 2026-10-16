const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p11-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.PAYMENT_MODE = 'simulation';
process.env.WHATSAPP_MOCK = 'true';

const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde, poserReservation, spies, queryOne, runSql } = require('../helpers/fixtureDb');
const { confirmerPaiementEtNotifier } = require('../../payments/flow');
const { marquerReservationJouee } = require('../../gerantCheckin');
const { notifyTerrain } = require('../../realtimeHub');
const h = createHarness('p11');

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const { reservationId } = poserReservation(db, { terrainId: monde.terrainAvance, joueurId: monde.joueurA });
  const ref = `TF-${reservationId}-P11`;
  runSql(db, `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_paytech) VALUES (?, 5000, 'paytech', 'en_attente', ?)`, [reservationId, ref]);
  await confirmerPaiementEtNotifier(reservationId, ref, { ports: spies().ports });
  runSql(db, 'UPDATE reservations SET reste_a_payer = 0, montant_restant = 0 WHERE id = ?', [reservationId]);
  const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  const events = [];
  const original = notifyTerrain;
  await marquerReservationJouee({ db, reservation, gerantId: monde.gerantId, methode: 'especes' });
  original(monde.terrainAvance, 'checkin', { reservation_id: reservationId });
  events.push('checkin');
  const played = queryOne(db, 'SELECT statut, qr_code_scanne_at FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('match_joue', played.statut, 'match_joue');
  h.assert('horodaté', Boolean(played.qr_code_scanne_at));
  let second = false;
  try {
    await marquerReservationJouee({ db, reservation, gerantId: monde.gerantId, methode: 'especes' });
  } catch (error) {
    second = error.statusCode === 400;
  }
  h.assert('second scan refusé', second);
  h.assertEqual('un checkin', events.length, 1);
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
