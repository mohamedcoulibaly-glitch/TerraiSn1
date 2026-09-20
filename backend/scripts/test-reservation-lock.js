/**
 * Tests unitaires — verrou créneaux atomique (anti double-booking).
 * Usage: node scripts/test-reservation-lock.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `terrainsn-lock-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;

const { createHarness } = require('../test/helpers/harness');
const { getDb, runSql, queryOne, queryAll, transaction } = require('../database');
const {
  lockCreneauxAtomique,
  libererCreneauxReservation,
  confirmerCreneauxReservation,
  annulerReservationsConcurrentes,
} = require('../reservationLockService');

const h = createHarness('unit-reservation-lock');

async function seedTerrain(db) {
  const proprioId = runSql(
    db,
    `INSERT INTO proprietaires (nom, prenom, email, password_hash, telephone, statut)
     VALUES ('L', 'P', 'lock@test.sn', 'x', '221771000001', 'actif')`,
  ).lastInsertRowid;
  const terrainId = runSql(
    db,
    `INSERT INTO terrains (
      proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_entier, prix_moitie, is_active
    ) VALUES (?, 'Lock Arena', 'Dakar', 'Dakar', 'foot', '5v5', 30000, 30000, 18000, 1)`,
    [proprioId],
  ).lastInsertRowid;
  const joueurId = runSql(
    db,
    `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active)
     VALUES ('J', '1', 'j1@test.sn', 'x', '221771000002', 'joueur', 1)`,
  ).lastInsertRowid;
  return { terrainId, joueurId };
}

async function main() {
  const db = await getDb();
  const { terrainId, joueurId } = await seedTerrain(db);
  const date = '2026-10-05';

  // 1) Premier verrou OK
  let primaryId;
  transaction(db, () => {
    primaryId = lockCreneauxAtomique(db, terrainId, date, '18:00', '19:00');
  });
  h.assert('primary creneau id', Number(primaryId) > 0);
  const c1 = queryOne(db, 'SELECT * FROM creneaux WHERE id = ?', [primaryId]);
  h.assertEqual('statut en_attente_paiement', c1.statut, 'en_attente_paiement');

  // 2) Second verrou même créneau → conflit
  let conflict = false;
  try {
    transaction(db, () => {
      lockCreneauxAtomique(db, terrainId, date, '18:00', '19:00');
    });
  } catch (e) {
    conflict = e.code === 'CRENEAU_CONFLIT' && e.statusCode === 409;
  }
  h.assert('double lock → 409', conflict);

  // 3) Créneau adjacent libre
  let adjacentId;
  transaction(db, () => {
    adjacentId = lockCreneauxAtomique(db, terrainId, date, '19:00', '20:00');
  });
  h.assert('adjacent libre OK', Number(adjacentId) > 0 && adjacentId !== primaryId);

  // 4) Chevauchement multi-heures
  let overlap = false;
  try {
    transaction(db, () => {
      lockCreneauxAtomique(db, terrainId, date, '17:00', '19:00');
    });
  } catch (e) {
    overlap = e.code === 'CRENEAU_CONFLIT';
  }
  h.assert('chevauchement 17-19 bloqué', overlap);

  // 5) Blocage gérant
  runSql(
    db,
    `INSERT INTO blocages_creneaux (terrain_id, date, heure_debut, heure_fin, motif)
     VALUES (?, ?, '21:00', '22:00', 'Maintenance')`,
    [terrainId, date],
  );
  let blocked = false;
  try {
    transaction(db, () => {
      lockCreneauxAtomique(db, terrainId, date, '21:00', '22:00');
    });
  } catch (e) {
    blocked = e.message.includes('bloqué');
  }
  h.assert('blocage gérant → conflit', blocked);

  // 6) Confirmer + libérer
  const resa = {
    id: 1,
    terrain_id: terrainId,
    date,
    heure_debut: '18:00',
    heure_fin: '19:00',
    creneau_id: primaryId,
  };
  const confirmed = confirmerCreneauxReservation(db, resa);
  h.assert('confirm > 0', confirmed >= 1);
  const cConfirm = queryOne(db, 'SELECT statut FROM creneaux WHERE id = ?', [primaryId]);
  h.assertEqual('statut reserve', cConfirm.statut, 'reserve');

  libererCreneauxReservation(db, resa, ['reserve', 'en_attente_paiement']);
  const cLibre = queryOne(db, 'SELECT statut FROM creneaux WHERE id = ?', [primaryId]);
  h.assertEqual('après libération libre', cLibre.statut, 'libre');

  // 7) Concurrents en_attente annulés à la confirmation
  let lockA;
  let lockB;
  transaction(db, () => {
    lockA = lockCreneauxAtomique(db, terrainId, date, '14:00', '15:00');
  });
  // Simuler 2 résas en_attente sur le même créneau (cas course) via insert manuel pour B
  const resaA = runSql(
    db,
    `INSERT INTO reservations (
      terrain_id, joueur_id, joueur_nom, date, heure_debut, heure_fin,
      montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant, statut, creneau_id
    ) VALUES (?, ?, 'A', ?, '14:00', '15:00', 30000, 30000, 5000, 5000, 25000, 25000, 'en_attente', ?)`,
    [terrainId, joueurId, date, lockA],
  ).lastInsertRowid;

  const joueur2 = runSql(
    db,
    `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active)
     VALUES ('J', '2', 'j2@test.sn', 'x', '221771000003', 'joueur', 1)`,
  ).lastInsertRowid;
  const resaB = runSql(
    db,
    `INSERT INTO reservations (
      terrain_id, joueur_id, joueur_nom, date, heure_debut, heure_fin,
      montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant, statut, creneau_id
    ) VALUES (?, ?, 'B', ?, '14:00', '15:00', 30000, 30000, 5000, 5000, 25000, 25000, 'en_attente', ?)`,
    [terrainId, joueur2, date, lockA],
  ).lastInsertRowid;

  runSql(db, `UPDATE reservations SET statut = 'confirme' WHERE id = ?`, [resaA]);
  const losers = annulerReservationsConcurrentes(db, {
    id: resaA,
    terrain_id: terrainId,
    date,
    heure_debut: '14:00',
    heure_fin: '15:00',
  });
  h.assert('concurrent annulé', losers.includes(resaB));
  const bStatut = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [resaB]);
  h.assertEqual('resa B annule', bStatut.statut, 'annule');

  // 8) Multi-heures lock
  let multiId;
  transaction(db, () => {
    multiId = lockCreneauxAtomique(db, terrainId, date, '10:00', '12:00');
  });
  const slots = queryAll(
    db,
    `SELECT * FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut IN ('10:00','11:00')`,
    [terrainId, date],
  );
  h.assertEqual('2 slots verrouillés', slots.filter((s) => s.statut === 'en_attente_paiement').length, 2);
  h.assert('multi primary', Number(multiId) > 0);

  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }
  h.exitIfFailed();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
