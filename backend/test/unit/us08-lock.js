const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = path.join(os.tmpdir(), `us08-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;

const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde, poserReservation, queryOne, transaction } = require('../helpers/fixtureDb');
const {
  lockCreneauxAtomique,
  libererVerrousExpires,
  normaliserDelaiVerrouPaiementMin,
} = require('../../reservationLockService');

const h = createHarness('us08');

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const date = '2026-12-01';
  poserReservation(db, {
    terrainId: monde.terrainAvance,
    joueurId: monde.joueurA,
    date,
    verrouExpireAt: Date.now() + 60 * 1000,
  });

  let conflict = false;
  try {
    transaction(db, () => lockCreneauxAtomique(db, monde.terrainAvance, date, '18:30', '19:30'));
  } catch (error) {
    conflict = error.code === 'CRENEAU_CONFLIT';
  }
  h.assert('chevauchement 409', conflict);

  const expiredId = poserReservation(db, {
    terrainId: monde.terrainAvance,
    joueurId: monde.joueurA,
    date,
    heureDebut: '10:00',
    heureFin: '11:00',
    verrouExpireAt: Date.now() - 1000,
  }).reservationId;
  const freed = transaction(db, () => libererVerrousExpires(db, Date.now()));
  h.assert('verrou expiré libéré', freed.includes(expiredId));
  const row = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [expiredId]);
  h.assertEqual('statut expire', row.statut, 'expire');

  let after = null;
  transaction(db, () => {
    after = lockCreneauxAtomique(db, monde.terrainAvance, date, '10:00', '11:00');
  });
  h.assert('créneau repris', Number(after) > 0);

  h.assertEqual('délai défaut', normaliserDelaiVerrouPaiementMin(undefined), 15);
  h.assertEqual('délai 30', normaliserDelaiVerrouPaiementMin(30), 30);
  h.assertEqual('plancher', normaliserDelaiVerrouPaiementMin(0), 15);
  h.assertEqual('plafond', normaliserDelaiVerrouPaiementMin(500), 120);

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
