/**
 * =====================================================================
 * PARCOURS A→Z TOUS RÔLES — joueur, gérant, propriétaire, superadmin
 * =====================================================================
 * Couvre sans HTTP (SQLite / sql.js via DB_PATH) :
 *  - JOUEUR : seed → devis → lock → en_attente → paiement → stages → cancel OU closed
 *  - GÉRANT : CRM gate, fenêtre check-in, scan, encaisser, portefeuille, confirmer manuellement
 *  - PROPRIÉTAIRE : ownership, stats/revenus, contrat
 *  - SUPERADMIN : mode revenu, commission, abonnement, audit
 *  - CROSS : joueur book → gérant check-in → finance visible proprio/SA
 *
 * Usage: node scripts/test-parcours-tous-roles.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `terrainsn-parcours-roles-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.WHATSAPP_MOCK = 'true';
process.env.PAYMENT_MODE = 'simulation';

const { createHarness } = require('../test/helpers/harness');
const { seedMohamedCompte, creerReservationMohamed } = require('../test/helpers/dbFixtures');
const { getDb, runSql, queryOne, queryAll, transaction } = require('../database');
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
const { calculerDepuisAvance } = require('../services/calculsPaiement');
const { estDansLaFenetreCheckIn } = require('../services/checkInFenetre');
const { confirmerManuellement, resumeSuperadminMois } = require('../services/detteCommissionService');
const {
  crediterPortefeuilleGerant,
  encaisserSoldeSurPlace,
} = require('../services/portefeuilleService');
const { chargerContrat } = require('../services/contratService');
const { creerDuApresPayin, portefeuilleTerrain, duExistant } = require('../services/ledgerService');
const {
  ownerRevenueRowsSql,
  summarizeOwnerRevenue,
  periodStart,
} = require('../ownerRevenueService');
const { applyMode, resolveMode, listHistory } = require('../services/modeRevenuService');
const { evaluerRemboursement } = require('../services/annulationService');

const h = createHarness('parcours-tous-roles');

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

function insertReservationEnAttente(db, { terrainId, joueurId, date, heure_debut, heure_fin, devis, creneauId }) {
  return runSql(
    db,
    `INSERT INTO reservations (
      terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
      montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant,
      statut, creneau_id, format_terrain, operational_stage
    ) VALUES (?, ?, 'Mohamed', '778261225', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?, 'entier', 'reserved')`,
    [
      terrainId,
      joueurId,
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
}

async function main() {
  const db = await getDb();
  const fx = seedMohamedCompte(db, { avancePct: 12.5, commissionPct: 10, payoutMode: 'retrait' });
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [fx.terrainId]);
  h.assert('seed terrain actif', Number(terrain.is_active) === 1);
  h.assertEqual('seed modele commission', terrain.modele_revenus, 'commission');
  h.assertEqual('seed proprio ownership', terrain.proprietaire_id, fx.proprioId);

  // Superadmin seed
  const saId = runSql(
    db,
    `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active)
     VALUES ('Admin', 'SA', 'sa.roles@test.sn', 'x', '221700000088', 'super_admin', 1)`,
  ).lastInsertRowid;
  h.assert('SA seed OK', saId > 0);

  // ========== JOUEUR A→Z (happy path → closed) ==========
  const date = '2026-11-17'; // mardi
  const heure_debut = '18:00';
  const heure_fin = '19:00';

  const devis = calculerDevis(db, terrain, { date, heure_debut, heure_fin, format_terrain: 'entier' });
  h.assertEqual('J1 devis montant', devis.montant, 40000);
  h.assertEqual('J1 devis avance', devis.montant_avance, 5000);
  h.assertEqual('J1 devis restant', devis.montant_restant, 35000);

  let creneauId;
  transaction(db, () => {
    creneauId = lockCreneauxAtomique(db, fx.terrainId, date, heure_debut, heure_fin);
  });
  h.assert('J2 lock OK', Number(creneauId) > 0);

  const reservationId = insertReservationEnAttente(db, {
    terrainId: fx.terrainId,
    joueurId: fx.joueurId,
    date,
    heure_debut,
    heure_fin,
    devis,
    creneauId,
  });
  h.assert('J3 résa en_attente', reservationId > 0);
  let resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('J3 statut en_attente', resa.statut, 'en_attente');

  // Paiement simulé → confirmation
  runSql(
    db,
    `UPDATE reservations SET statut = 'confirme', operational_stage = 'reserved',
      confirme_at = ?, qr_code_payload = ?, reference_paytech = ?
     WHERE id = ?`,
    [`${date}T10:00:00`, `QR-ROLES-${reservationId}`, `SIM-ROLES-${reservationId}`, reservationId],
  );
  confirmerCreneauxReservation(db, {
    terrain_id: fx.terrainId,
    date,
    heure_debut,
    heure_fin,
    creneau_id: creneauId,
  });
  resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('J4 statut confirme', resa.statut, 'confirme');
  h.assertEqual(
    'J4 créneau reserve',
    queryOne(db, 'SELECT statut FROM creneaux WHERE id = ?', [creneauId]).statut,
    'reserve',
  );

  const contrat = chargerContrat(db, fx.terrainId);
  const du = creerDuApresPayin(db, { reservation: resa, contrat });
  h.assert('J4 ledger du créé', Boolean(du));
  h.assertEqual('J4 ledger avance', Number(du.avance), 5000);
  h.assertEqual('J4 ledger commission', Number(du.commission), 500);

  const finance = calculerDepuisAvance(5000, {
    commission_pourcentage: 10,
    payout_mode: 'retrait',
  });
  h.assertEqual('J5 commission 500', finance.commission, 500);
  h.assertEqual('J5 dû gérant 4500', finance.du_gerant, 4500);

  // Stages Kanban
  const inWindow = new Date(`${date}T17:45:00`).getTime();
  h.assert(
    'J6 dans fenêtre check-in',
    estDansLaFenetreCheckIn({ date, heure_debut, heure_fin, fenetre_retard: 30 }, inWindow),
  );
  h.assertEqual('J6 → checkin', assertStageTransition(cardFromResa(resa), 'checkin', inWindow), true);
  runSql(
    db,
    `UPDATE reservations SET operational_stage = 'checkin', checked_in_at = ?, qr_code_scanne_at = ?
     WHERE id = ?`,
    [`${date}T17:45:00`, `${date}T17:45:00`, reservationId],
  );
  resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('J6 stage checkin', resolveOperationalStage(resa), 'checkin');

  const duringMatch = new Date(`${date}T18:10:00`).getTime();
  h.assertEqual('J7 → match', assertStageTransition(cardFromResa(resa), 'match', duringMatch), true);
  runSql(db, `UPDATE reservations SET operational_stage = 'match' WHERE id = ?`, [reservationId]);
  resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);

  h.assertEqual('J8 → checkout', assertStageTransition(cardFromResa(resa), 'checkout', duringMatch), true);
  runSql(db, `UPDATE reservations SET operational_stage = 'checkout' WHERE id = ?`, [reservationId]);
  resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);

  let balanceBlock = false;
  try {
    assertStageTransition(cardFromResa(resa), 'closed', duringMatch);
  } catch (e) {
    balanceBlock = e.code === 'BALANCE_OPEN';
  }
  h.assert('J9 solde ouvert bloque closed', balanceBlock);

  const encaisse = encaisserSoldeSurPlace(db, resa, fx.gerantId, 'especes');
  h.assertEqual('J9 encaissement reste', encaisse, 35000);
  resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('J9 montant_restant 0', Number(resa.montant_restant), 0);

  h.assertEqual('J9 → closed', assertStageTransition(cardFromResa(resa), 'closed', duringMatch), true);
  runSql(
    db,
    `UPDATE reservations SET operational_stage = 'closed', checkout_at = ? WHERE id = ?`,
    [`${date}T19:05:00`, reservationId],
  );
  resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('J9 stage closed', resolveOperationalStage(resa), 'closed');
  h.assertEqual('J9 next après closed', nextKanbanStage('closed'), null);

  // ========== JOUEUR — chemin annulation ==========
  const dateCancel = '2026-11-18';
  let cancelLock;
  transaction(db, () => {
    cancelLock = lockCreneauxAtomique(db, fx.terrainId, dateCancel, '20:00', '21:00');
  });
  const devisCancel = calculerDevis(db, terrain, {
    date: dateCancel,
    heure_debut: '20:00',
    heure_fin: '21:00',
    format_terrain: 'entier',
  });
  const cancelResaId = insertReservationEnAttente(db, {
    terrainId: fx.terrainId,
    joueurId: fx.joueurId,
    date: dateCancel,
    heure_debut: '20:00',
    heure_fin: '21:00',
    devis: devisCancel,
    creneauId: cancelLock,
  });
  runSql(
    db,
    `UPDATE reservations SET statut = 'confirme', operational_stage = 'reserved', confirme_at = ?
     WHERE id = ?`,
    [`${dateCancel}T09:00:00`, cancelResaId],
  );
  confirmerCreneauxReservation(db, {
    terrain_id: fx.terrainId,
    date: dateCancel,
    heure_debut: '20:00',
    heure_fin: '21:00',
    creneau_id: cancelLock,
  });
  const cancelResa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [cancelResaId]);
  const cancelTerrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [fx.terrainId]);
  const evalRemb = evaluerRemboursement({
    terrain: cancelTerrain,
    reservation: cancelResa,
    now: new Date(`${dateCancel}T10:00:00`).getTime(),
  });
  h.assert('JC remboursement évaluable', typeof evalRemb.eligible === 'boolean');
  h.assertEqual('JC remboursement autorisé seed', evalRemb.remboursement_autorise, 1);

  libererCreneauxReservation(
    db,
    {
      terrain_id: fx.terrainId,
      date: dateCancel,
      heure_debut: '20:00',
      heure_fin: '21:00',
      creneau_id: cancelLock,
    },
    ['en_attente_paiement', 'reserve'],
  );
  runSql(db, `UPDATE reservations SET statut = 'annulee', operational_stage = 'closed' WHERE id = ?`, [
    cancelResaId,
  ]);
  h.assertEqual(
    'JC créneau libéré',
    queryOne(db, 'SELECT statut FROM creneaux WHERE id = ?', [cancelLock]).statut,
    'libre',
  );
  h.assertEqual(
    'JC résa annulee',
    queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [cancelResaId]).statut,
    'annulee',
  );

  // ========== GÉRANT — CRM / fenêtre / scan / portefeuille / manuel ==========
  const gateBanned = playerGate({ is_banned: true });
  h.assert('G1 ban bloque', gateBanned.bloqueReservation === true);
  const gateImpaye = playerGate({ politiqueImpaye: true, solde_ouvert: 15000 });
  h.assert('G1 impayé bloque', gateImpaye.bloqueReservation === true);

  let crmBlock = false;
  try {
    assertStageTransition(
      cardFromResa(
        {
          date,
          heure_debut,
          heure_fin,
          statut: 'confirme',
          operational_stage: 'reserved',
          checked_in_at: null,
          montant_restant: 0,
        },
        { crm: { bloqueReservation: true, reason: 'Banni' }, stage: 'reserved' },
      ),
      'checkin',
      inWindow,
    );
  } catch (e) {
    crmBlock = e.code === 'PLAYER_BLOCKED';
  }
  h.assert('G2 check-in refusé si banni', crmBlock);

  const tooEarly = new Date(`${date}T12:00:00`).getTime();
  let outWindow = false;
  try {
    assertStageTransition(
      cardFromResa(
        {
          date,
          heure_debut,
          heure_fin,
          statut: 'confirme',
          operational_stage: 'reserved',
          checked_in_at: null,
          montant_restant: 35000,
        },
        { stage: 'reserved' },
      ),
      'checkin',
      tooEarly,
    );
  } catch (e) {
    outWindow = e.code === 'OUT_OF_WINDOW';
  }
  h.assert('G3 hors fenêtre refusé', outWindow);

  // Confirmation manuelle (autre créneau)
  const manuelFx = creerReservationMohamed(db, {
    terrainId: fx.terrainId,
    joueurId: fx.joueurId,
    date: '2026-11-19',
    heure: '10:00',
  });
  const manuel = transaction(db, () =>
    confirmerManuellement(db, {
      reservationId: manuelFx.reservationId,
      gerantId: fx.gerantId,
      note: 'Cash Wave reçu au terrain',
    }),
  );
  h.assert('G4 manuel code', Boolean(manuel.code));
  h.assertEqual('G4 manuel commission', manuel.commission, 500);
  const resaManuel = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [manuelFx.reservationId]);
  h.assertEqual('G4 statut confirme', resaManuel.statut, 'confirme');
  h.assertEqual('G4 mode_paiement manuel', resaManuel.mode_paiement, 'manuel');
  h.assert('G4 scan payload QR', Boolean(resaManuel.qr_code_payload));

  const dette = queryOne(db, 'SELECT * FROM dettes_commissions WHERE reservation_id = ?', [
    manuelFx.reservationId,
  ]);
  h.assert('G4 dette commission créée', Boolean(dette));
  h.assertEqual('G4 dette en_attente', dette.statut, 'en_attente');

  const auditDette = queryAll(
    db,
    `SELECT * FROM audit_dette WHERE dette_id = ? AND action = 'creation'`,
    [dette.id],
  );
  h.assert('G4 audit dette', auditDette.length >= 1);

  // Portefeuille gérant (crédit avance nette)
  const walletCredit = crediterPortefeuilleGerant(db, {
    gerantId: fx.gerantId,
    terrainId: fx.terrainId,
    reservationId,
    montantEncaisse: 5000,
    montantCommission: 500,
  });
  h.assertEqual('G5 portefeuille reverse', walletCredit.montant_reverse, 4500);
  h.assert('G5 solde disponible > 0', Number(walletCredit.solde_disponible) >= 4500);

  const walletRow = queryOne(
    db,
    'SELECT * FROM portefeuille_gerant WHERE gerant_id = ? AND terrain_id = ?',
    [fx.gerantId, fx.terrainId],
  );
  h.assert('G5 row portefeuille', Boolean(walletRow));
  h.assert('G5 total_encaisse', Number(walletRow.total_encaisse) >= 5000);

  // ========== PROPRIÉTAIRE — ownership / revenus / contrat ==========
  h.assertEqual('P1 terrain.proprietaire_id', terrain.proprietaire_id, fx.proprioId);
  const gerant = queryOne(db, 'SELECT * FROM employes WHERE id = ?', [fx.gerantId]);
  h.assertEqual('P1 gérant lié terrain', gerant.terrain_id, fx.terrainId);
  h.assertEqual('P1 gérant lié proprio', gerant.proprietaire_id, fx.proprioId);

  const contratLoaded = chargerContrat(db, fx.terrainId);
  h.assert('P2 contrat chargé', Boolean(contratLoaded));
  h.assertEqual('P2 payout_mode', contratLoaded.payout_mode, 'retrait');
  h.assertEqual('P2 commission %', Number(contratLoaded.commission_pourcentage), 10);
  h.assertEqual('P2 avance %', Number(contratLoaded.pourcentage_avance), 12.5);

  const start = periodStart('annee');
  // Param order: dateWhere placeholder appears in JOIN before ownerWhere in WHERE
  const ownerRows = queryAll(db, ownerRevenueRowsSql({ dateWhere: 'AND r.date >= ?' }), [
    start,
    fx.proprioId,
  ]);
  h.assert('P3 rows revenus proprio', ownerRows.length >= 1);
  const ownerSummary = summarizeOwnerRevenue(ownerRows);
  h.assert('P3 au moins 1 résa revenue', ownerSummary.reservations >= 1);
  h.assertEqual('P3 avances encaissees', ownerSummary.avances_encaissees, Number(du.avance));
  h.assertEqual('P3 commissions', ownerSummary.commissions_prelevees, Number(du.commission));
  h.assert(
    'P3 montants_reverses = dû gérant',
    Number(ownerSummary.montants_reverses) === Number(du.du_gerant),
  );

  // ========== SUPERADMIN — mode revenu / flags / audit ==========
  h.assertEqual('SA1 resolveMode commission', resolveMode(terrain), 'commission');
  h.assertEqual(
    'SA1 commission prélevée',
    calculerCommissionPrelevee(terrain, 5000),
    500,
  );
  h.assertEqual(
    'SA1 abo → 0 commission',
    calculerCommissionPrelevee({ ...terrain, modele_revenus: 'abonnement' }, 5000),
    0,
  );

  const afterAbo = applyMode(db, terrain, { mode: 'abonnement', abonnement_montant: 75000, note: 'SA switch' }, saId);
  h.assertEqual('SA2 modele abonnement', afterAbo.modele_revenus, 'abonnement');
  h.assertEqual('SA2 montant abo', Number(afterAbo.abonnement_montant), 75000);
  h.assertEqual('SA2 resolveMode abo', resolveMode(afterAbo), 'abonnement');

  const afterCommission = applyMode(
    db,
    afterAbo,
    { mode: 'commission', commission_pourcentage: 12, note: 'SA restore' },
    saId,
  );
  h.assertEqual('SA3 restore commission', afterCommission.modele_revenus, 'commission');
  h.assertEqual('SA3 pct 12', Number(afterCommission.commission_pourcentage), 12);

  const history = listHistory(db);
  h.assert('SA4 history mode revenu', history.length >= 2);
  h.assert(
    'SA4 history terrain',
    history.some((row) => Number(row.terrain_id) === fx.terrainId),
  );

  const resumeSA = resumeSuperadminMois(db);
  h.assert('SA5 dettes SA visibles', resumeSA.total_en_attente >= 500);

  // Restore seed commission for cross-role invariants
  applyMode(db, afterCommission, { mode: 'commission', commission_pourcentage: 10 }, saId);

  // ========== CROSS-ROLE : book → check-in → finance visible ==========
  const crossDate = '2026-11-20';
  const crossDevis = calculerDevis(db, queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [fx.terrainId]), {
    date: crossDate,
    heure_debut: '16:00',
    heure_fin: '17:00',
    format_terrain: 'entier',
  });
  let crossLock;
  transaction(db, () => {
    crossLock = lockCreneauxAtomique(db, fx.terrainId, crossDate, '16:00', '17:00');
  });
  const crossResaId = insertReservationEnAttente(db, {
    terrainId: fx.terrainId,
    joueurId: fx.joueurId,
    date: crossDate,
    heure_debut: '16:00',
    heure_fin: '17:00',
    devis: crossDevis,
    creneauId: crossLock,
  });
  runSql(
    db,
    `UPDATE reservations SET statut = 'confirme', operational_stage = 'reserved',
      confirme_at = ?, qr_code_payload = ?
     WHERE id = ?`,
    [`${crossDate}T08:00:00`, `QR-CROSS-${crossResaId}`, crossResaId],
  );
  confirmerCreneauxReservation(db, {
    terrain_id: fx.terrainId,
    date: crossDate,
    heure_debut: '16:00',
    heure_fin: '17:00',
    creneau_id: crossLock,
  });
  let crossResa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [crossResaId]);
  const crossContrat = chargerContrat(db, fx.terrainId);
  const crossDu = creerDuApresPayin(db, { reservation: crossResa, contrat: crossContrat });
  h.assert('X1 joueur book + du', Boolean(crossDu) && Number(crossDu.avance) === 5000);

  const crossInWindow = new Date(`${crossDate}T15:50:00`).getTime();
  h.assertEqual(
    'X2 gérant check-in OK',
    assertStageTransition(cardFromResa(crossResa), 'checkin', crossInWindow),
    true,
  );
  runSql(
    db,
    `UPDATE reservations SET operational_stage = 'checkin', checked_in_at = ?, qr_code_scanne_at = ?
     WHERE id = ?`,
    [`${crossDate}T15:50:00`, `${crossDate}T15:50:00`, crossResaId],
  );
  crossResa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [crossResaId]);
  h.assertEqual('X2 stage checkin', resolveOperationalStage(crossResa), 'checkin');

  const walletLedger = portefeuilleTerrain(db, fx.terrainId, fx.gerantId);
  h.assert('X3 portefeuille ledger agégats', Boolean(walletLedger));
  h.assert('X3 total_avances > 0', Number(walletLedger.total_avances) >= 5000);
  h.assert('X3 total_commission > 0', Number(walletLedger.total_commission) >= 500);

  const crossOwnerRows = queryAll(db, ownerRevenueRowsSql({ dateWhere: 'AND r.date >= ?' }), [
    start,
    fx.proprioId,
  ]);
  const crossSummary = summarizeOwnerRevenue(crossOwnerRows);
  h.assert('X4 proprio voit ≥2 résas', crossSummary.reservations >= 2);
  h.assert('X4 avances proprio ≥ 10000', crossSummary.avances_encaissees >= 10000);

  const duRecheck = duExistant(db, crossResaId);
  h.assertEqual('X4 SA/ledger du_gerant', Number(duRecheck.du_gerant), 4500);
  h.assert('X4 SA dette mois toujours visible', resumeSuperadminMois(db).total_en_attente >= 500);

  // Moitié terrain invariant
  const devisMoitie = calculerDevis(db, queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [fx.terrainId]), {
    date: '2026-11-21',
    heure_debut: '17:00',
    heure_fin: '18:00',
    format_terrain: 'moitie',
  });
  h.assertEqual('PM montant moitié', devisMoitie.montant, 24000);
  h.assertEqual(
    'PM avance moitié',
    devisMoitie.montant_avance,
    calculerMontantAvance(queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [fx.terrainId]), 24000),
  );

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
