const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p18-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.PAYMENT_MODE = 'simulation';
process.env.WHATSAPP_MOCK = 'true';

const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde, poserReservation, queryOne, transaction } = require('../helpers/fixtureDb');
const { annulerReservationApresAnnulationPaytech } = require('../../payments/flow');
const { lockCreneauxAtomique } = require('../../reservationLockService');
const h = createHarness('p18');

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const date = '2026-11-21';
  const { reservationId } = poserReservation(db, { terrainId: monde.terrainAvance, joueurId: monde.joueurA, date });
  const result = await annulerReservationApresAnnulationPaytech(reservationId, `TF-${reservationId}-CANCEL`);
  h.assertEqual('annulé', result.action, 'canceled');
  const row = queryOne(db, 'SELECT statut, qr_code_payload FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('statut', row.statut, 'annule');
  h.assert('pas de QR', !row.qr_code_payload);
  let next = null;
  transaction(db, () => {
    next = lockCreneauxAtomique(db, monde.terrainAvance, date, '18:00', '19:00');
  });
  h.assert('créneau repris', Number(next) > 0);
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}
main().catch((e) => { console.error(e); process.exit(1); });
