const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p01-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';

const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde, poserReservation, queryOne, transaction } = require('../helpers/fixtureDb');
const { lockCreneauxAtomique } = require('../../reservationLockService');
const h = createHarness('p01');

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const date = '2026-11-20';
  const first = poserReservation(db, {
    terrainId: monde.terrainAvance, joueurId: monde.joueurA, date, verrouExpireAt: Date.now() + 15 * 60 * 1000,
  });
  h.assert('A sans QR', queryOne(db, 'SELECT qr_code_payload FROM reservations WHERE id = ?', [first.reservationId]).qr_code_payload == null);
  let blocked = false;
  try {
    transaction(db, () => lockCreneauxAtomique(db, monde.terrainAvance, date, '18:00', '19:00'));
  } catch (error) {
    blocked = error.code === 'CRENEAU_CONFLIT';
  }
  h.assert('B bloqué', blocked);
  runExpire(db, first.reservationId);
  const second = poserReservation(db, {
    terrainId: monde.terrainAvance, joueurId: monde.joueurB, date, heureDebut: '18:00', heureFin: '19:00',
  });
  h.assert('B passe après expiration', second.reservationId !== first.reservationId);
  h.assertEqual('A expire', queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [first.reservationId]).statut, 'expire');
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

function runExpire(db, id) {
  const { libererVerrousExpires } = require('../../reservationLockService');
  require('../../database').runSql(db, 'UPDATE reservations SET verrou_expire_at = ? WHERE id = ?', [Date.now() - 1000, id]);
  transaction(db, () => libererVerrousExpires(db, Date.now()));
}

main().catch((e) => { console.error(e); process.exit(1); });
