/**
 * =====================================================================
 * PARCOURS UNITAIRES COMPLETS — simulation A→Z de tous les rôles
 * =====================================================================
 * Couvre sans HTTP :
 *  - Joueur : devis → lock → résa → confirme → Kanban → closed
 *  - Double booking
 *  - Gérant : gate CRM / fenêtre check-in / encaissement
 *  - Calculs finance avance → commission → dû
 *  - Propriétaire / SA : seed + contrat + mode revenu
 *
 * Usage: node scripts/test-parcours-complet.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `terrainsn-parcours-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.WHATSAPP_MOCK = 'true';
process.env.PAYMENT_MODE = 'simulation';

const { createHarness } = require('../test/helpers/harness');
const { seedMohamedCompte } = require('../test/helpers/dbFixtures');
const { getDb, runSql, queryOne, transaction } = require('../database');
const { calculerDevis, calculerMontantAvance, calculerCommissionPrelevee } = require('../pricingService');
const {
  lockCreneauxAtomique,
  confirmerCreneauxReservation,
  libererCreneauxReservation,
} = require('../reservationLockService');
const {
  assertStageTransition,
  resolveOperationalStage,
  nextKanbanStage,
  playerGate,
} = require('../services/kanbanRules');
const { calculerDepuisAvance, calculerDecomposition } = require('../services/calculsPaiement');
const { estDansLaFenetreCheckIn } = require('../services/checkInFenetre');

const h = createHarness('parcours-complet');

function cardFromResa(resa, extras = {}) {
  return {
    stage: resolveOperationalStage(resa),
    statut: resa.statut,
    date: resa.date,
    heure_debut: resa.heure_debut,
    heure_fin: resa.heure_fin,
    fenetre_retard: 30,
    checked_in_at: resa.checked_in_at || null,
    montant_restant: Number(resa.montant_restant || 0),
    crm: { bloqueReservation: false },
    ...extras,
  };
}

async function main() {
  const db = await getDb();
  const fx = seedMohamedCompte(db, { avancePct: 12.5, commissionPct: 10, payoutMode: 'retrait' });
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [fx.terrainId]);
  h.assert('seed terrain actif', Number(terrain.is_active) === 1);
  h.assertEqual('seed modele commission', terrain.modele_revenus, 'commission');

  // ========== PARCOURS JOUEUR A→Z ==========
  const date = '2026-11-10'; // mardi
  const heure_debut = '18:00';
  const heure_fin = '19:00';

  // Étape 1 — Devis
  const devis = calculerDevis(db, terrain, { date, heure_debut, heure_fin, format_terrain: 'entier' });
  h.assertEqual('P1 devis montant', devis.montant, 40000);
  h.assertEqual('P1 devis avance', devis.montant_avance, 5000);
  h.assertEqual('P1 devis restant', devis.montant_restant, 35000);

  // Étape 2 — Lock créneau
  let creneauId;
  transaction(db, () => {
    creneauId = lockCreneauxAtomique(db, fx.terrainId, date, heure_debut, heure_fin);
  });
  h.assert('P2 lock OK', Number(creneauId) > 0);

  // Étape 3 — Création réservation en_attente
  const reservationId = runSql(
    db,
    `INSERT INTO reservations (
      terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
      montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant,
      statut, creneau_id, format_terrain, operational_stage
    ) VALUES (?, ?, 'Mohamed', '778261225', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?, 'entier', 'reserved')`,
    [
      fx.terrainId,
      fx.joueurId,
      date,
      heure_debut,
      heure_fin,
      devis.montant,
      devis.montant,
      devis.montant_avance,
      devis.montant_avance,
      devis.montant_restant,
      devis.montant_restant,
      creneauId,
    ],
  ).lastInsertRowid;
  h.assert('P3 résa créée', reservationId > 0);

  // Étape 4 — Paiement simulé → confirmation
  runSql(
    db,
    `UPDATE reservations SET statut = 'confirme', operational_stage = 'reserved',
      qr_code_payload = ?, reference_paytech = ?
     WHERE id = ?`,
    [`QR-TEST-${reservationId}`, `SIM-${reservationId}`, reservationId],
  );
  confirmerCreneauxReservation(db, {
    terrain_id: fx.terrainId,
    date,
    heure_debut,
    heure_fin,
    creneau_id: creneauId,
  });
  let resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('P4 statut confirme', resa.statut, 'confirme');
  h.assertEqual('P4 créneau reserve', queryOne(db, 'SELECT statut FROM creneaux WHERE id = ?', [creneauId]).statut, 'reserve');

  // Étape 5 — Finance plateforme (commission sur avance)
  const finance = calculerDepuisAvance(devis.montant_avance, {
    commission_pourcentage: 10,
    payout_mode: 'retrait',
  });
  h.assertEqual('P5 commission 500', finance.commission, 500);
  h.assertEqual('P5 dû gérant 4500', finance.du_gerant, 4500);

  const decomp = calculerDecomposition(
    { pourcentage_avance: 12.5, commission_pourcentage: 10, payout_mode: 'retrait' },
    40000,
  );
  h.assertEqual('P5 decomp avance', decomp.avance, 5000);

  // Étape 6 — Kanban reserved → checkin (dans fenêtre)
  const inWindow = new Date(`${date}T17:45:00`).getTime();
  h.assert('P6 dans fenêtre check-in', estDansLaFenetreCheckIn({
    date,
    heure_debut,
    heure_fin,
    fenetre_retard: 30,
  }, inWindow));

  h.assertEqual(
    'P6 transition checkin',
    assertStageTransition(cardFromResa(resa), 'checkin', inWindow),
    true,
  );
  runSql(
    db,
    `UPDATE reservations SET operational_stage = 'checkin', checked_in_at = ?, qr_code_scanne_at = ?
     WHERE id = ?`,
    [`${date}T17:45:00`, `${date}T17:45:00`, reservationId],
  );
  resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('P6 stage checkin', resolveOperationalStage(resa), 'checkin');

  // Étape 7 — match
  const duringMatch = new Date(`${date}T18:10:00`).getTime();
  h.assertEqual(
    'P7 transition match',
    assertStageTransition(cardFromResa(resa), 'match', duringMatch),
    true,
  );
  runSql(db, `UPDATE reservations SET operational_stage = 'match' WHERE id = ?`, [reservationId]);
  resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);

  // Étape 8 — checkout
  h.assertEqual(
    'P8 transition checkout',
    assertStageTransition(cardFromResa(resa), 'checkout', duringMatch),
    true,
  );
  runSql(db, `UPDATE reservations SET operational_stage = 'checkout' WHERE id = ?`, [reservationId]);
  resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);

  // Étape 9 — closed (encaisser reste)
  let balanceBlock = false;
  try {
    assertStageTransition(cardFromResa(resa), 'closed', duringMatch);
  } catch (e) {
    balanceBlock = e.code === 'BALANCE_OPEN';
  }
  h.assert('P9 solde ouvert bloque closed', balanceBlock);

  runSql(db, `UPDATE reservations SET montant_restant = 0, reste_a_payer = 0 WHERE id = ?`, [reservationId]);
  resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual(
    'P9 closed après encaissement',
    assertStageTransition(cardFromResa(resa), 'closed', duringMatch),
    true,
  );
  runSql(
    db,
    `UPDATE reservations SET operational_stage = 'closed', checkout_at = ? WHERE id = ?`,
    [`${date}T19:05:00`, reservationId],
  );
  resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('P9 stage closed', resolveOperationalStage(resa), 'closed');
  h.assertEqual('P9 next après closed', nextKanbanStage('closed'), null);

  // ========== PARCOURS DOUBLE BOOKING ==========
  let dbConflict = false;
  try {
    transaction(db, () => {
      lockCreneauxAtomique(db, fx.terrainId, date, heure_debut, heure_fin);
    });
  } catch (e) {
    dbConflict = e.code === 'CRENEAU_CONFLIT';
  }
  h.assert('P-DB créneau déjà pris', dbConflict);

  // Créneau libre autre heure
  let otherLock;
  transaction(db, () => {
    otherLock = lockCreneauxAtomique(db, fx.terrainId, date, '20:00', '21:00');
  });
  h.assert('P-DB autre créneau OK', Number(otherLock) > 0);

  // ========== PARCOURS GÉRANT — CRM gate ==========
  const gateBanned = playerGate({ is_banned: true });
  h.assert('PG ban bloque', gateBanned.bloqueReservation === true);

  const gateImpaye = playerGate({ politiqueImpaye: true, solde_ouvert: 15000 });
  h.assert('PG impayé bloque', gateImpaye.bloqueReservation === true);

  let crmBlock = false;
  try {
    assertStageTransition(
      cardFromResa(
        { ...resa, statut: 'confirme', operational_stage: 'reserved', checked_in_at: null, montant_restant: 0 },
        { crm: { bloqueReservation: true, reason: 'Banni' }, stage: 'reserved' },
      ),
      'checkin',
      inWindow,
    );
  } catch (e) {
    crmBlock = e.code === 'PLAYER_BLOCKED';
  }
  h.assert('PG check-in refusé si banni', crmBlock);

  // Hors fenêtre
  const tooEarly = new Date(`${date}T12:00:00`).getTime();
  let outWindow = false;
  try {
    assertStageTransition(
      cardFromResa(
        { date, heure_debut, heure_fin, statut: 'confirme', operational_stage: 'reserved', checked_in_at: null, montant_restant: 35000 },
        { stage: 'reserved' },
      ),
      'checkin',
      tooEarly,
    );
  } catch (e) {
    outWindow = e.code === 'OUT_OF_WINDOW';
  }
  h.assert('PG hors fenêtre refusé', outWindow);

  // ========== PARCOURS ANNULATION (libération) ==========
  libererCreneauxReservation(
    db,
    { terrain_id: fx.terrainId, date, heure_debut: '20:00', heure_fin: '21:00', creneau_id: otherLock },
    ['en_attente_paiement', 'reserve'],
  );
  h.assertEqual(
    'PA créneau relâché',
    queryOne(db, 'SELECT statut FROM creneaux WHERE id = ?', [otherLock]).statut,
    'libre',
  );

  // ========== PARCOURS MOITIÉ TERRAIN ==========
  const devisMoitie = calculerDevis(db, terrain, {
    date: '2026-11-11',
    heure_debut: '17:00',
    heure_fin: '18:00',
    format_terrain: 'moitie',
  });
  h.assertEqual('PM montant moitié', devisMoitie.montant, 24000);
  h.assertEqual('PM avance moitié', devisMoitie.montant_avance, calculerMontantAvance(terrain, 24000));

  // ========== COMMISSION MODE ==========
  h.assertEqual(
    'PC commission prélevée',
    calculerCommissionPrelevee(terrain, 5000),
    500,
  );
  h.assertEqual(
    'PC abo → 0 commission',
    calculerCommissionPrelevee({ ...terrain, modele_revenus: 'abonnement' }, 5000),
    0,
  );

  // ========== SA / PROPRIO seed invariants ==========
  h.assert('SA terrain lié proprio', terrain.proprietaire_id === fx.proprioId);
  const gerant = queryOne(db, 'SELECT * FROM employes WHERE id = ?', [fx.gerantId]);
  h.assertEqual('SA gérant terrain', gerant.terrain_id, fx.terrainId);
  h.assert('SA contrat payout_mode', String(terrain.payout_mode || 'retrait').length > 0);

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
