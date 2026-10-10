/**
 * Fixtures Postgres async + nettoyage par marqueur (anti-régression).
 * Usage : const fx = await seedParcours(db); ... await cleanupParcours(db, fx);
 */
const { runSql, queryOne, queryAll } = require('../../database');
const { enregistrerContrat } = require('../../services/contratService');

function marker() {
  return `ar_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

/**
 * @param {object} db
 * @param {object} [opts]
 */
async function seedParcours(db, opts = {}) {
  const {
    avancePct = 12.5,
    commissionPct = 10,
    payoutMode = 'auto',
    remboursementAutorise = 1,
    delaiRemboursementHeures = 24,
    politiquePaiement = 'avance',
    tag = marker(),
  } = opts;

  const emailProprio = `proprio.${tag}@terrainsn.test`;
  const emailGerant = `gerant.${tag}@terrainsn.test`;
  const emailJoueur = `joueur.${tag}@terrainsn.test`;
  const telGerant = `77${String(Date.now()).slice(-7)}`.slice(0, 9);
  const telJoueur = `78${String(Date.now()).slice(-7)}`.slice(0, 9);

  const proprio = await runSql(
    db,
    `INSERT INTO proprietaires (nom, email, password_hash, telephone, statut)
     VALUES (?, ?, 'x', ?, 'actif')`,
    [`Proprio ${tag}`, emailProprio, telGerant],
  );
  const proprioId = proprio.lastInsertRowid;

  const terrain = await runSql(
    db,
    `INSERT INTO terrains (
      proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_entier, prix_moitie,
      pourcentage_avance, commission_pourcentage, modele_revenus, is_active,
      politique_paiement, delai_remboursement_heures, delai_paiement_dette_jours
    ) VALUES (?, ?, 'Dakar', 'Dakar', 'foot', '11v11', 40000, 40000, 24000, ?, ?, 'commission', 1, ?, ?, 30)`,
    [proprioId, `Terrain AR ${tag}`, avancePct, commissionPct, politiquePaiement, delaiRemboursementHeures],
  );
  const terrainId = terrain.lastInsertRowid;

  const gerant = await runSql(
    db,
    `INSERT INTO employes (
      proprietaire_id, terrain_id, nom, email, password_hash, telephone, whatsapp_number, is_active
    ) VALUES (?, ?, ?, ?, 'x', ?, ?, 1)`,
    [proprioId, terrainId, `Gerant ${tag}`, emailGerant, telGerant, telGerant],
  );
  const gerantId = gerant.lastInsertRowid;

  const joueur = await runSql(
    db,
    `INSERT INTO users (nom, email, password_hash, telephone, role, is_active)
     VALUES (?, ?, 'x', ?, 'joueur', 1)`,
    [`Joueur ${tag}`, emailJoueur, telJoueur],
  );
  const joueurId = joueur.lastInsertRowid;

  await enregistrerContrat(
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
      canal_reversement: 'wave',
      gerant_id: gerantId,
      wave_numero: `221${telGerant}`,
      wave_statut: 'verifie',
      om_statut: 'absent',
      paiement_production: 0,
    },
    { auteurId: proprioId },
  );

  return {
    tag,
    proprioId,
    terrainId,
    gerantId,
    joueurId,
    emailProprio,
    emailGerant,
    emailJoueur,
    telGerant,
    telJoueur,
  };
}

async function creerReservationParcours(db, {
  terrainId,
  joueurId,
  joueurNom = 'Joueur AR',
  joueurTelephone = '770000000',
  avance = 5000,
  prix = 40000,
  date = '2030-06-15',
  heure = '18:00',
  statut = 'en_attente',
}) {
  const heureFin = '19:00';
  const creneau = await runSql(
    db,
    `INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut)
     VALUES (?, ?, ?, ?, 'en_attente_paiement')`,
    [terrainId, date, heure, heureFin],
  );
  const creneauId = creneau.lastInsertRowid;

  const resa = await runSql(
    db,
    `INSERT INTO reservations (
      terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
      montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant, statut, creneau_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      terrainId,
      joueurId,
      joueurNom,
      joueurTelephone,
      date,
      heure,
      heureFin,
      prix,
      prix,
      avance,
      avance,
      prix - avance,
      prix - avance,
      statut,
      creneauId,
    ],
  );

  return { reservationId: resa.lastInsertRowid, creneauId };
}

async function cleanupParcours(db, fx) {
  if (!fx?.terrainId) return;
  const { terrainId, proprioId, joueurId, gerantId } = fx;

  const resas = await queryAll(db, 'SELECT id FROM reservations WHERE terrain_id = ?', [terrainId]);
  const resaIds = resas.map((r) => r.id);
  if (resaIds.length) {
    const placeholders = resaIds.map(() => '?').join(',');
    await runSql(db, `DELETE FROM payouts WHERE reservation_id IN (${placeholders})`, resaIds);
    await runSql(db, `DELETE FROM dus WHERE reservation_id IN (${placeholders})`, resaIds);
    await runSql(db, `DELETE FROM paiements WHERE reservation_id IN (${placeholders})`, resaIds);
    await runSql(db, `DELETE FROM reversements WHERE reservation_id IN (${placeholders})`, resaIds);
    await runSql(db, `DELETE FROM dettes_commissions WHERE reservation_id IN (${placeholders})`, resaIds);
    await runSql(db, `DELETE FROM matchs WHERE reservation_id IN (${placeholders})`, resaIds);
  }

  await runSql(db, 'DELETE FROM demandes_retrait WHERE terrain_id = ?', [terrainId]);
  await runSql(db, 'DELETE FROM contrat_avenants WHERE terrain_id = ?', [terrainId]);
  await runSql(db, 'DELETE FROM creneaux WHERE terrain_id = ?', [terrainId]);
  await runSql(db, 'DELETE FROM reservations WHERE terrain_id = ?', [terrainId]);
  await runSql(db, 'DELETE FROM portefeuille_gerant WHERE terrain_id = ?', [terrainId]).catch(() => {});
  if (gerantId) await runSql(db, 'DELETE FROM employes WHERE id = ?', [gerantId]);
  await runSql(db, 'DELETE FROM terrains WHERE id = ?', [terrainId]);
  if (proprioId) await runSql(db, 'DELETE FROM proprietaires WHERE id = ?', [proprioId]);
  if (joueurId) {
    await runSql(db, 'DELETE FROM auth_otps WHERE user_id = ?', [joueurId]).catch(() => {});
    await runSql(db, 'DELETE FROM users WHERE id = ?', [joueurId]);
  }
}

async function getReservation(db, id) {
  return queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [id]);
}

module.exports = {
  marker,
  seedParcours,
  creerReservationParcours,
  cleanupParcours,
  getReservation,
};
