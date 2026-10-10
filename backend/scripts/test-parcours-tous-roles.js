/**
 * =====================================================================
 * PARCOURS A→Z TOUS RÔLES — joueur, gérant, propriétaire (Postgres async)
 * =====================================================================
 * Complète test-parcours-complet.js avec un seed multi-rôles + gates.
 * Usage: node scripts/test-parcours-tous-roles.js
 */
process.env.WHATSAPP_MOCK = process.env.WHATSAPP_MOCK || 'true';
process.env.PAYMENT_MODE = process.env.PAYMENT_MODE || 'simulation';

const { createHarness } = require('../test/helpers/harness');
const { seedMohamedCompte } = require('../test/helpers/dbFixtures');
const { getDb, queryOne, runSql, transaction } = require('../database');
const { calculerDevis } = require('../pricingService');
const { lockCreneauxAtomique, confirmerCreneauxReservation } = require('../reservationLockService');
const {
  assertStageTransition,
  resolveOperationalStage,
  playerGate,
} = require('../services/kanbanRules');
const { chargerContrat } = require('../services/contratService');
const { estDansLaFenetreCheckIn } = require('../services/checkInFenetre');

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

async function main() {
  const db = await getDb();
  const fx = await seedMohamedCompte(db, {
    avancePct: 12.5,
    commissionPct: 10,
    payoutMode: 'retrait',
  });

  const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [fx.terrainId]);
  const gerant = await queryOne(db, 'SELECT * FROM employes WHERE id = ?', [fx.gerantId]);
  const joueur = await queryOne(db, 'SELECT * FROM users WHERE id = ?', [fx.joueurId]);
  const proprio = await queryOne(db, 'SELECT * FROM proprietaires WHERE id = ?', [fx.proprioId]);
  const contrat = await chargerContrat(db, fx.terrainId);

  h.assert('seed terrain', Boolean(terrain));
  h.assert('seed gérant lié', Number(gerant?.terrain_id) === fx.terrainId);
  h.assert('seed joueur', String(joueur?.role) === 'joueur');
  h.assert('seed proprio', Boolean(proprio));
  h.assert('contrat chargé', Boolean(contrat));
  h.assertEqual('contrat avance %', Number(contrat.pourcentage_avance), 12.5);

  // JOUEUR — devis + lock + résa
  const date = '2027-03-15';
  const heure_debut = '18:00';
  const heure_fin = '19:00';
  const devis = await calculerDevis(db, terrain, {
    date,
    heure_debut,
    heure_fin,
    format_terrain: 'entier',
  });
  h.assertEqual('joueur devis total', devis.montant, 40000);
  h.assertEqual('joueur devis avance', devis.montant_avance, 5000);

  let creneauId;
  await transaction(db, async () => {
    creneauId = await lockCreneauxAtomique(db, fx.terrainId, date, heure_debut, heure_fin);
  });
  h.assert('joueur lock OK', Number(creneauId) > 0);

  const resaInsert = await runSql(
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
  );
  const reservationId = resaInsert.lastInsertRowid;
  h.assert('joueur résa créée', Number(reservationId) > 0);

  await runSql(
    db,
    `UPDATE reservations SET statut = 'confirme', operational_stage = 'reserved' WHERE id = ?`,
    [reservationId],
  );
  await confirmerCreneauxReservation(db, {
    terrain_id: fx.terrainId,
    date,
    heure_debut,
    heure_fin,
    creneau_id: creneauId,
  });
  const resa = await queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('joueur statut confirmé', resa.statut, 'confirme');

  // GÉRANT — gates CRM / fenêtre
  h.assert('gérant ban bloque', playerGate({ is_banned: true }).bloqueReservation === true);
  const inWindow = new Date(`${date}T17:45:00`).getTime();
  h.assert(
    'gérant dans fenêtre',
    estDansLaFenetreCheckIn({ date, heure_debut, heure_fin, fenetre_retard: 30 }, inWindow),
  );
  h.assertEqual(
    'gérant check-in OK',
    assertStageTransition(cardFromResa(resa), 'checkin', inWindow),
    true,
  );

  let crmBlock = false;
  try {
    assertStageTransition(
      cardFromResa(resa, { crm: { bloqueReservation: true, reason: 'Banni' }, stage: 'reserved' }),
      'checkin',
      inWindow,
    );
  } catch (e) {
    crmBlock = e.code === 'PLAYER_BLOCKED';
  }
  h.assert('gérant refuse joueur banni', crmBlock);

  // PROPRIO / SA — ownership + contrat
  h.assertEqual('proprio ownership', Number(terrain.proprietaire_id), fx.proprioId);
  h.assertEqual('contrat commission %', Number(contrat.commission_pourcentage), 10);
  h.assert('contrat payout défini', Boolean(contrat.payout_mode));

  h.exitIfFailed();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
