/**
 * Fixtures BDD async (Postgres) pour Mohamed Joueur/Gérant.
 */
const { runSql, transaction } = require('../../database');
const { enregistrerContrat } = require('../../services/contratService');
const { MOHAMED } = require('./mohamed');

/**
 * @param {object} db
 * @param {object} [opts]
 * @returns {Promise<{ proprioId: number, terrainId: number, gerantId: number, joueurId: number }>}
 */
async function seedMohamedCompte(db, opts = {}) {
  const {
    avancePct = 12.5,
    commissionPct = 10,
    payoutMode = 'retrait',
    paiementProduction = 0,
    remboursementAutorise = 1,
    delaiRemboursementHeures = 48,
  } = opts;

  const tag = `moh_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const emailProprio = `mohamed.proprietaire.${tag}@test.sn`;
  const emailGerant = MOHAMED.emailGerant.replace('@gmail.com', `.${tag}@test.sn`);
  const emailJoueur = MOHAMED.emailJoueur.replace('@gmail.com', `.${tag}@test.sn`);

  const proprio = await runSql(
    db,
    `INSERT INTO proprietaires (nom, prenom, email, password_hash, telephone, plan, statut)
     VALUES (?, ?, ?, 'x', ?, 'premium', 'actif')`,
    [MOHAMED.nom, MOHAMED.prenom, emailProprio, MOHAMED.telephoneStore],
  );
  const proprioId = proprio.lastInsertRowid;

  const terrain = await runSql(
    db,
    `INSERT INTO terrains (
      proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_entier, prix_moitie,
      pourcentage_avance, commission_pourcentage, modele_revenus, is_active,
      politique_paiement, delai_remboursement_heures
    ) VALUES (?, ?, 'Parcelles Assainies', 'Dakar', 'foot', '11v11',
      40000, 40000, 24000, ?, ?, 'commission', 1, 'avance', ?)`,
    [proprioId, `Arena Mohamed ${tag}`, avancePct, commissionPct, delaiRemboursementHeures],
  );
  const terrainId = terrain.lastInsertRowid;

  const gerant = await runSql(
    db,
    `INSERT INTO employes (
      proprietaire_id, terrain_id, nom, prenom, email, password_hash, telephone, whatsapp_number, is_active
    ) VALUES (?, ?, ?, ?, ?, 'x', ?, ?, 1)`,
    [
      proprioId,
      terrainId,
      MOHAMED.nom,
      MOHAMED.prenom,
      emailGerant,
      MOHAMED.telephoneStore,
      MOHAMED.telephoneLocal9,
    ],
  );
  const gerantId = gerant.lastInsertRowid;

  const joueur = await runSql(
    db,
    `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active, telephone_verified)
     VALUES (?, ?, ?, 'x', ?, 'joueur', 1, 1)`,
    [MOHAMED.nom, MOHAMED.prenom, emailJoueur, MOHAMED.telephoneStore],
  );
  const joueurId = joueur.lastInsertRowid;

  await transaction(db, async () =>
    enregistrerContrat(
      db,
      terrainId,
      {
        pourcentage_avance: avancePct,
        commission_pourcentage: commissionPct,
        remboursement_autorise: remboursementAutorise,
        delai_remboursement_heures: delaiRemboursementHeures,
        payout_mode: payoutMode,
        payout_frais_politique: 'partage',
        frais_payout_pct_gerant: 1,
        frais_payout_pct_plateforme: 1,
        numeros_identiques_whatsapp: 1,
        canal_reversement: 'wave',
        gerant_id: gerantId,
        wave_statut: 'verifie',
        om_statut: 'verifie',
        paiement_production: paiementProduction,
      },
      { auteurId: proprioId },
    ),
  );

  return { proprioId, terrainId, gerantId, joueurId, tag };
}

/**
 * @param {object} db
 * @param {{ terrainId: number, joueurId: number, avance?: number, prix?: number, date?: string, heure?: string }} params
 */
async function creerReservationMohamed(db, params) {
  const {
    terrainId,
    joueurId,
    avance = MOHAMED.montants.avancePayin,
    prix = MOHAMED.montants.prixTotal,
    date = '2026-09-15',
    heure = '18:00',
  } = params;
  const heureFin = '19:00';
  const creneau = await runSql(
    db,
    `INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut)
     VALUES (?, ?, ?, ?, 'en_attente_paiement')`,
    [terrainId, date, heure, heureFin],
  );
  const creneauId = creneau.lastInsertRowid;

  const reservation = await runSql(
    db,
    `INSERT INTO reservations (
      terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
      montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant, statut, creneau_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?)`,
    [
      terrainId,
      joueurId,
      MOHAMED.nom,
      MOHAMED.telephoneLocal9,
      date,
      heure,
      heureFin,
      prix,
      prix,
      avance,
      avance,
      prix - avance,
      prix - avance,
      creneauId,
    ],
  );
  const reservationId = reservation.lastInsertRowid;

  return { reservationId, creneauId, refCommand: `TF-${reservationId}-MOH-PAYIN` };
}

module.exports = { seedMohamedCompte, creerReservationMohamed };
