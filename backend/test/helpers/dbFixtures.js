/**
 * Fixtures BDD isolées (DB temporaire) pour Mohamed Joueur/Gérant.
 */
const { runSql, transaction } = require('../../database');
const { enregistrerContrat } = require('../../services/contratService');
const { MOHAMED } = require('./mohamed');

/**
 * @param {object} db
 * @param {object} [opts]
 * @returns {{ proprioId: number, terrainId: number, gerantId: number, joueurId: number }}
 */
function seedMohamedCompte(db, opts = {}) {
  const {
    avancePct = 12.5,
    commissionPct = 10,
    payoutMode = 'retrait',
    paiementProduction = 0,
    remboursementAutorise = 1,
    delaiRemboursementHeures = 48,
  } = opts;

  const proprioId = runSql(
    db,
    `INSERT INTO proprietaires (nom, prenom, email, password_hash, telephone, plan, statut)
     VALUES (?, ?, 'mohamed.proprietaire@test.sn', 'x', ?, 'premium', 'actif')`,
    [MOHAMED.nom, MOHAMED.prenom, MOHAMED.telephoneStore],
  ).lastInsertRowid;

  const terrainId = runSql(
    db,
    `INSERT INTO terrains (
      proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_entier, prix_moitie,
      pourcentage_avance, commission_pourcentage, modele_revenus, is_active
    ) VALUES (?, 'Arena Mohamed Parcelles', 'Parcelles Assainies', 'Dakar', 'foot', '11v11',
      40000, 40000, 24000, ?, ?, 'commission', 1)`,
    [proprioId, avancePct, commissionPct],
  ).lastInsertRowid;

  const gerantId = runSql(
    db,
    `INSERT INTO employes (
      proprietaire_id, terrain_id, nom, prenom, email, password_hash, telephone, whatsapp_number, is_active
    ) VALUES (?, ?, ?, ?, ?, 'x', ?, ?, 1)`,
    [
      proprioId,
      terrainId,
      MOHAMED.nom,
      MOHAMED.prenom,
      MOHAMED.emailGerant.replace('@gmail.com', '@test.sn'),
      MOHAMED.telephoneStore,
      MOHAMED.telephoneLocal9,
    ],
  ).lastInsertRowid;

  const joueurId = runSql(
    db,
    `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active, telephone_verified)
     VALUES (?, ?, ?, 'x', ?, 'joueur', 1, 1)`,
    [
      MOHAMED.nom,
      MOHAMED.prenom,
      MOHAMED.emailJoueur.replace('@gmail.com', '@test.sn'),
      MOHAMED.telephoneStore,
    ],
  ).lastInsertRowid;

  transaction(db, () =>
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
      { auteurId: 1 },
    ),
  );

  return { proprioId, terrainId, gerantId, joueurId };
}

/**
 * @param {object} db
 * @param {{ terrainId: number, joueurId: number, avance?: number, prix?: number, date?: string, heure?: string }} params
 */
function creerReservationMohamed(db, params) {
  const {
    terrainId,
    joueurId,
    avance = MOHAMED.montants.avancePayin,
    prix = MOHAMED.montants.prixTotal,
    date = '2026-09-15',
    heure = '18:00',
  } = params;
  const heureFin = '19:00';
  const creneauId = runSql(
    db,
    `INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut)
     VALUES (?, ?, ?, ?, 'en_attente_paiement')`,
    [terrainId, date, heure, heureFin],
  ).lastInsertRowid;

  const reservationId = runSql(
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
  ).lastInsertRowid;

  return { reservationId, creneauId, refCommand: `TF-${reservationId}-MOH-PAYIN` };
}

module.exports = { seedMohamedCompte, creerReservationMohamed };
