/**
 * Tests unitaires — verrou créneaux + capacité zones A/B.
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
  confirmerAvecCapacite,
  annulerReservationsConcurrentes,
} = require('../reservationLockService');
const { syncStatutCreneaux, etatCreneau, peutReserver } = require('../services/capaciteService');

const h = createHarness('unit-reservation-lock');

function insertPending(db, { terrainId, joueurId, date, debut, fin, creneauId, format = 'entier', nom = 'Lock' }) {
  const verrouActif = Date.now() + 15 * 60 * 1000;
  return runSql(
    db,
    `INSERT INTO reservations (
      terrain_id, joueur_id, joueur_nom, date, heure_debut, heure_fin,
      montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant,
      format_terrain, zone, statut, creneau_id, verrou_expire_at
    ) VALUES (?, ?, ?, ?, ?, ?, 30000, 30000, 5000, 5000, 25000, 25000,
      ?, NULL, 'en_attente_paiement', ?, ?)`,
    [terrainId, joueurId, nom, date, debut, fin, format, creneauId, verrouActif],
  ).lastInsertRowid;
}

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

  // 1) Lock entier + insert pending → capacité complète
  let primaryId;
  let resa1;
  transaction(db, () => {
    primaryId = lockCreneauxAtomique(db, terrainId, date, '18:00', '19:00', 'entier');
    resa1 = insertPending(db, {
      terrainId,
      joueurId,
      date,
      debut: '18:00',
      fin: '19:00',
      creneauId: primaryId,
      format: 'entier',
    });
    syncStatutCreneaux(db, terrainId, date, '18:00', '19:00');
  });
  h.assert('primary creneau id', Number(primaryId) > 0);
  h.assertEqual('etat complet après entier pending', etatCreneau(db, terrainId, date, '18:00', '19:00').etat, 'complet');
  const c1 = queryOne(db, 'SELECT * FROM creneaux WHERE id = ?', [primaryId]);
  h.assertEqual('statut en_attente_paiement', c1.statut, 'en_attente_paiement');

  // 2) Second lock entier → conflit
  let conflict = false;
  try {
    transaction(db, () => {
      lockCreneauxAtomique(db, terrainId, date, '18:00', '19:00', 'entier');
    });
  } catch (e) {
    conflict = e.code === 'CRENEAU_CONFLIT' && e.statusCode === 409;
  }
  h.assert('double lock → 409', conflict);

  // 2b) Annuler pending → re-lock OK
  runSql(db, `UPDATE reservations SET statut = 'annule' WHERE id = ?`, [resa1]);
  syncStatutCreneaux(db, terrainId, date, '18:00', '19:00');
  let reclaimedId;
  transaction(db, () => {
    reclaimedId = lockCreneauxAtomique(db, terrainId, date, '18:00', '19:00', 'entier');
  });
  h.assertEqual('orphelin récupéré', reclaimedId, primaryId);
  const resa2 = insertPending(db, {
    terrainId,
    joueurId,
    date,
    debut: '18:00',
    fin: '19:00',
    creneauId: primaryId,
    format: 'entier',
    nom: 'Lock2',
  });
  syncStatutCreneaux(db, terrainId, date, '18:00', '19:00');

  // 3) Adjacent libre
  let adjacentId;
  transaction(db, () => {
    adjacentId = lockCreneauxAtomique(db, terrainId, date, '19:00', '20:00', 'entier');
  });
  h.assert('adjacent libre OK', Number(adjacentId) > 0 && adjacentId !== primaryId);

  // 4) Chevauchement multi-heures
  let overlap = false;
  try {
    transaction(db, () => {
      lockCreneauxAtomique(db, terrainId, date, '17:00', '19:00', 'entier');
    });
  } catch (e) {
    overlap = e.code === 'CRENEAU_CONFLIT';
  }
  h.assert('chevauchement 17-19 bloqué', overlap);

  // 5) Blocage gérant AB
  runSql(
    db,
    `INSERT INTO blocages_creneaux (terrain_id, date, heure_debut, heure_fin, motif, zone)
     VALUES (?, ?, '21:00', '22:00', 'Maintenance', 'AB')`,
    [terrainId, date],
  );
  let blocked = false;
  try {
    transaction(db, () => {
      lockCreneauxAtomique(db, terrainId, date, '21:00', '22:00', 'entier');
    });
  } catch (e) {
    blocked = e.code === 'CRENEAU_CONFLIT';
  }
  h.assert('blocage gérant → conflit', blocked);

  // 6) Confirmer avec capacité (zone AB)
  const capa = confirmerAvecCapacite(db, {
    id: resa2,
    terrain_id: terrainId,
    date,
    heure_debut: '18:00',
    heure_fin: '19:00',
    creneau_id: primaryId,
    format_terrain: 'entier',
  });
  h.assert('confirm capa OK', capa.ok === true && capa.zone === 'AB');
  runSql(db, `UPDATE reservations SET statut = 'confirme', zone = ? WHERE id = ?`, [capa.zone, resa2]);
  syncStatutCreneaux(db, terrainId, date, '18:00', '19:00');
  const cConfirm = queryOne(db, 'SELECT statut FROM creneaux WHERE id = ?', [primaryId]);
  h.assertEqual('statut reserve', cConfirm.statut, 'reserve');

  runSql(db, `UPDATE reservations SET statut = 'annule' WHERE id = ?`, [resa2]);
  libererCreneauxReservation(db, {
    terrain_id: terrainId,
    date,
    heure_debut: '18:00',
    heure_fin: '19:00',
    creneau_id: primaryId,
  });
  const cLibre = queryOne(db, 'SELECT statut FROM creneaux WHERE id = ?', [primaryId]);
  h.assertEqual('après libération libre', cLibre.statut, 'libre');

  // 7) Deux demis pending OK ; confirmation A n'annule pas B
  let lockA;
  transaction(db, () => {
    lockA = lockCreneauxAtomique(db, terrainId, date, '14:00', '15:00', 'moitie');
  });
  const resaA = insertPending(db, {
    terrainId,
    joueurId,
    date,
    debut: '14:00',
    fin: '15:00',
    creneauId: lockA,
    format: 'moitie',
    nom: 'A',
  });
  const joueur2 = runSql(
    db,
    `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active)
     VALUES ('J', '2', 'j2@test.sn', 'x', '221771000003', 'joueur', 1)`,
  ).lastInsertRowid;
  h.assert('2e demi encore possible', peutReserver('moitie', db, terrainId, date, '14:00', '15:00'));
  const resaB = insertPending(db, {
    terrainId,
    joueurId: joueur2,
    date,
    debut: '14:00',
    fin: '15:00',
    creneauId: lockA,
    format: 'moitie',
    nom: 'B',
  });

  const capaA = confirmerAvecCapacite(db, {
    id: resaA,
    terrain_id: terrainId,
    date,
    heure_debut: '14:00',
    heure_fin: '15:00',
    format_terrain: 'moitie',
  });
  h.assertEqual('demi A → zone A', capaA.zone, 'A');
  runSql(db, `UPDATE reservations SET statut = 'confirme', zone = 'A' WHERE id = ?`, [resaA]);
  const losers = annulerReservationsConcurrentes(db, {
    id: resaA,
    terrain_id: terrainId,
    date,
    heure_debut: '14:00',
    heure_fin: '15:00',
    format_terrain: 'moitie',
    zone: 'A',
  });
  h.assert('demi B conservée', !losers.includes(resaB));
  const bStatut = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [resaB]);
  h.assertEqual('resa B toujours pending', bStatut.statut, 'en_attente_paiement');

  // Entier concurrent refusé après 2 demis
  const capaB = confirmerAvecCapacite(db, {
    id: resaB,
    terrain_id: terrainId,
    date,
    heure_debut: '14:00',
    heure_fin: '15:00',
    format_terrain: 'moitie',
  });
  h.assertEqual('demi B → zone B', capaB.zone, 'B');
  runSql(db, `UPDATE reservations SET statut = 'confirme', zone = 'B' WHERE id = ?`, [resaB]);
  h.assert('3e demi refusée', !peutReserver('moitie', db, terrainId, date, '14:00', '15:00'));

  // 8) Multi-heures : lignes créneaux créées
  let multiId;
  transaction(db, () => {
    multiId = lockCreneauxAtomique(db, terrainId, date, '10:00', '12:00', 'entier');
  });
  const slots = queryAll(
    db,
    `SELECT * FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut IN ('10:00','11:00')`,
    [terrainId, date],
  );
  h.assert(
    'slots horaires créés',
    slots.filter((s) => s.heure_debut === '10:00' || s.heure_debut === '11:00').length >= 2,
  );
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
