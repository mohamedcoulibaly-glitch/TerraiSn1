const { queryAll, queryOne, runSql, rowsModified } = require('../database');
const { calculerCommissionPrelevee } = require('../pricingService');
const { crediterPortefeuilleGerant } = require('./portefeuilleService');
const {
  confirmerCreneauxReservation,
  annulerReservationsConcurrentes,
} = require('../reservationLockService');
const { calculerFenetreCheckIn } = require('./checkInFenetre');
const { serializeQrPayload } = require('./qrPayload');

async function genererCodeReservation(db) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = `TF-${Math.floor(100000 + Math.random() * 900000)}`;
    if (!(await queryOne(db, 'SELECT id FROM reservations WHERE code_reservation = ?', [code]))) return code;
  }
  throw new Error('Impossible de générer un code de réservation unique');
}

function periodeCivile(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

async function getSetting(db, cle, fallback = '') {
  const row = await queryOne(db, 'SELECT valeur FROM plateforme_settings WHERE cle = ?', [cle]);
  return row?.valeur != null ? String(row.valeur) : fallback;
}

async function setSetting(db, cle, valeur) {
  await runSql(
    db,
    `INSERT INTO plateforme_settings (cle, valeur, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, updated_at = CURRENT_TIMESTAMP`,
    [cle, String(valeur || '')],
  );
}

async function instructionsPaiementDette(db) {
  return getSetting(
    db,
    'dette_instructions',
    '',
  );
}

async function confirmerManuellement(db, { reservationId, gerantId, note }) {
  const reservation = await queryOne(
    db,
    `SELECT r.*, t.commission_pourcentage, t.pourcentage_avance, t.modele_revenus, t.commission,
            t.acompte, t.montant_acompte
     FROM reservations r
     JOIN terrains t ON t.id = r.terrain_id
     JOIN employes e ON e.terrain_id = t.id AND e.id = ?
     WHERE r.id = ? AND r.statut = 'en_attente'`,
    [gerantId, reservationId],
  );

  if (!reservation) {
    const error = new Error('Réservation introuvable ou déjà traitée.');
    error.statusCode = 404;
    throw error;
  }

  const existingDette = await queryOne(db, 'SELECT id FROM dettes_commissions WHERE reservation_id = ?', [reservationId]);
  if (existingDette) {
    const error = new Error('Cette réservation a déjà une commission en dette.');
    error.statusCode = 409;
    throw error;
  }

  const montantAvance = Number(reservation.montant_avance || reservation.acompte || 0);
  const commission = calculerCommissionPrelevee(reservation, montantAvance);
  const periode = periodeCivile();
  const noteGerant = note ? String(note).slice(0, 500) : null;

  let code = reservation.code_reservation;
  if (!code) code = await genererCodeReservation(db);

  const retardRow = reservation.creneau_id
    ? await queryOne(db, 'SELECT fenetre_retard FROM creneaux WHERE id = ?', [reservation.creneau_id])
    : null;
  const fenetre = calculerFenetreCheckIn({
    date: reservation.date,
    heure_debut: reservation.heure_debut,
    heure_fin: reservation.heure_fin,
    fenetre_retard: retardRow?.fenetre_retard,
  });
  const qrPayload = serializeQrPayload({
    reservation_id: reservationId,
    code,
    creneau_id: reservation.creneau_id,
    terrain_id: reservation.terrain_id,
    expire_at: Math.floor(fenetre.finFenetre / 1000),
  });

  await runSql(
    db,
    `UPDATE reservations SET
       statut = 'confirme',
       code_reservation = ?,
       qr_code_payload = ?,
       mode_paiement = 'manuel',
       confirme_manuellement_par = ?,
       confirme_manuellement_at = CURRENT_TIMESTAMP,
       confirme_at = COALESCE(confirme_at, CURRENT_TIMESTAMP),
       note_gerant = ?
     WHERE id = ? AND statut = 'en_attente'`,
    [code, qrPayload, gerantId, noteGerant, reservationId],
  );
  if (rowsModified(db) !== 1) {
    const error = new Error('Réservation introuvable ou déjà traitée.');
    error.statusCode = 409;
    throw error;
  }

  const confirmedCount = await confirmerCreneauxReservation(db, reservation);
  if (confirmedCount < 1) {
    await runSql(db, "UPDATE reservations SET statut = 'en_attente', mode_paiement = 'en_ligne' WHERE id = ?", [reservationId]);
    const error = new Error('Créneau indisponible — confirmation manuelle impossible.');
    error.statusCode = 409;
    throw error;
  }

  const loserIds = await annulerReservationsConcurrentes(db, { ...reservation, id: reservationId });

  const detteResult = await runSql(
    db,
    `INSERT INTO dettes_commissions
       (terrain_id, gerant_id, reservation_id, montant_commission, montant_avance_manuelle, statut, periode, note)
     VALUES (?, ?, ?, ?, ?, 'en_attente', ?, ?)`,
    [reservation.terrain_id, gerantId, reservationId, commission, montantAvance, periode, noteGerant],
  );
  const detteId = Number(detteResult.lastInsertRowid || 0);

  await runSql(
    db,
    `INSERT INTO audit_dette
       (dette_id, terrain_id, action, montant_concerne, fait_par, role_fait_par, detail)
     VALUES (?, ?, 'creation', ?, ?, 'gerant', ?)`,
    [
      detteId,
      reservation.terrain_id,
      commission,
      gerantId,
      `Confirmation manuelle. Avance reçue hors PayTech : ${montantAvance} FCFA`,
    ],
  );

  await runSql(
    db,
    `INSERT INTO paiements
       (reservation_id, montant, methode, statut, reference_externe, montant_acompte, montant_commission, montant_reverse, statut_reversement)
     VALUES (?, ?, 'manuel', 'paye', ?, ?, 0, ?, 'effectue')`,
    [reservationId, montantAvance, `MANUEL-GERANT-${reservationId}-${Date.now()}`, montantAvance, montantAvance],
  );

  await crediterPortefeuilleGerant(db, {
    gerantId,
    terrainId: reservation.terrain_id,
    reservationId,
    montantEncaisse: montantAvance,
    montantCommission: 0,
  });

  return { code, commission, montantAvance, terrainId: reservation.terrain_id, loserIds };
}

async function resumeGerant(db, gerantId, periode) {
  const p = periode || periodeCivile();
  const resume = (await queryOne(
    db,
    `SELECT COUNT(*) as nb_reservations_manuelles,
            COALESCE(SUM(montant_commission), 0) as total_dette,
            COALESCE(SUM(CASE WHEN statut='en_attente' THEN montant_commission ELSE 0 END), 0) as dette_en_cours,
            COALESCE(SUM(CASE WHEN statut='payee' THEN montant_commission ELSE 0 END), 0) as dette_payee
     FROM dettes_commissions
     WHERE gerant_id = ? AND periode = ?`,
    [gerantId, p],
  )) || {};
  const detail = await queryAll(
    db,
    `SELECT d.*, r.code_reservation, r.created_at as resa_date, r.note_gerant,
            r.date as match_date, r.heure_debut,
            COALESCE(u.prenom, r.joueur_nom) as joueur_nom
     FROM dettes_commissions d
     JOIN reservations r ON r.id = d.reservation_id
     LEFT JOIN users u ON u.id = r.joueur_id
     WHERE d.gerant_id = ? AND d.periode = ?
     ORDER BY d.created_at DESC`,
    [gerantId, p],
  );
  const historique = await queryAll(
    db,
    `SELECT periode,
            COALESCE(SUM(montant_commission), 0) AS total,
            SUM(CASE WHEN statut='en_attente' THEN 1 ELSE 0 END) AS nb_attente
     FROM dettes_commissions
     WHERE gerant_id = ? AND periode < ?
     GROUP BY periode
     ORDER BY periode DESC
     LIMIT 6`,
    [gerantId, p],
  );
  return {
    resume: {
      nb_reservations_manuelles: Number(resume.nb_reservations_manuelles || 0),
      total_dette: Number(resume.total_dette || 0),
      dette_en_cours: Number(resume.dette_en_cours || 0),
      dette_payee: Number(resume.dette_payee || 0),
    },
    detail,
    historique,
    periode: p,
    instructions: await instructionsPaiementDette(db),
  };
}

async function resumeSuperadminMois(db, periode) {
  const p = periode || periodeCivile();
  const row = (await queryOne(
    db,
    `SELECT COALESCE(SUM(montant_commission), 0) AS total,
            COUNT(DISTINCT terrain_id) AS terrains
     FROM dettes_commissions
     WHERE statut = 'en_attente' AND periode = ?`,
    [p],
  )) || {};
  return {
    periode: p,
    total_en_attente: Number(row.total || 0),
    terrains_concernes: Number(row.terrains || 0),
  };
}

async function listDettesAdmin(db, { periode, terrainId, statut }) {
  const p = periode || periodeCivile();
  const params = [p];
  let where = 'd.periode = ?';
  if (terrainId) {
    where += ' AND d.terrain_id = ?';
    params.push(Number(terrainId));
  }
  if (statut && ['en_attente', 'payee', 'annulee'].includes(statut)) {
    where += ' AND d.statut = ?';
    params.push(statut);
  }

  const parTerrain = await queryAll(
    db,
    `SELECT d.terrain_id, t.nom AS terrain_nom, t.ville,
            d.gerant_id, e.nom AS gerant_nom, e.prenom AS gerant_prenom, e.telephone AS gerant_telephone,
            d.periode,
            COUNT(*) AS nb_reservations,
            COALESCE(SUM(d.montant_commission), 0) AS commission_due,
            COALESCE(SUM(d.montant_avance_manuelle), 0) AS avances_manuelles,
            CASE
              WHEN SUM(CASE WHEN d.statut = 'en_attente' THEN 1 ELSE 0 END) > 0 THEN 'en_attente'
              ELSE 'payee'
            END AS statut,
            MAX(d.payee_at) AS payee_at,
            MAX(d.remise_a_zero_par) AS remise_a_zero_par,
            u.nom AS remise_par_nom
     FROM dettes_commissions d
     JOIN terrains t ON t.id = d.terrain_id
     LEFT JOIN employes e ON e.id = d.gerant_id
     LEFT JOIN users u ON u.id = d.remise_a_zero_par
     WHERE ${where}
     GROUP BY d.terrain_id, d.periode
     ORDER BY statut ASC, commission_due DESC`,
    params,
  );

  const lignes = await queryAll(
    db,
    `SELECT d.*, r.code_reservation, r.date AS match_date, r.heure_debut, r.note_gerant,
            COALESCE(u.prenom, r.joueur_nom) AS joueur_nom,
            t.nom AS terrain_nom
     FROM dettes_commissions d
     JOIN reservations r ON r.id = d.reservation_id
     JOIN terrains t ON t.id = d.terrain_id
     LEFT JOIN users u ON u.id = r.joueur_id
     WHERE ${where}
     ORDER BY d.created_at DESC`,
    params,
  );

  const audit = await queryAll(
    db,
    `SELECT a.*, t.nom AS terrain_nom,
            COALESCE(u.nom, e.nom) AS fait_par_nom
     FROM audit_dette a
     LEFT JOIN terrains t ON t.id = a.terrain_id
     LEFT JOIN users u ON u.id = a.fait_par AND a.role_fait_par = 'super_admin'
     LEFT JOIN employes e ON e.id = a.fait_par AND a.role_fait_par = 'gerant'
     ORDER BY a.created_at DESC
     LIMIT 200`,
  );

  return {
    periode: p,
    resume: await resumeSuperadminMois(db, p),
    par_terrain: parTerrain,
    lignes,
    audit,
    instructions: await instructionsPaiementDette(db),
  };
}

async function remiseAZero(db, { terrainId, superAdminId, note, montantRecu, periode }) {
  const p = periode || periodeCivile();
  const pending = await queryOne(
    db,
    `SELECT COUNT(*) AS nb, COALESCE(SUM(montant_commission), 0) AS total
     FROM dettes_commissions
     WHERE terrain_id = ? AND statut = 'en_attente' AND periode = ?`,
    [terrainId, p],
  );
  if (!Number(pending?.nb)) {
    const error = new Error('Aucune dette en attente pour ce terrain sur cette période.');
    error.statusCode = 404;
    throw error;
  }

  const noteFinale = note ? String(note).slice(0, 500) : null;
  await runSql(
    db,
    `UPDATE dettes_commissions SET
       statut = 'payee',
       payee_at = CURRENT_TIMESTAMP,
       remise_a_zero_par = ?,
       remise_a_zero_at = CURRENT_TIMESTAMP,
       note = COALESCE(?, note)
     WHERE terrain_id = ? AND statut = 'en_attente' AND periode = ?`,
    [superAdminId, noteFinale, terrainId, p],
  );

  await runSql(
    db,
    `INSERT INTO audit_dette
       (terrain_id, action, montant_concerne, fait_par, role_fait_par, detail)
     VALUES (?, 'remise_a_zero', ?, ?, 'super_admin', ?)`,
    [
      terrainId,
      Number(montantRecu || pending.total || 0),
      superAdminId,
      `Remise à zéro période ${p}. Montant reçu : ${Number(montantRecu || 0)} FCFA. ${noteFinale || ''}`,
    ],
  );

  return { success: true, periode: p, montant: Number(pending.total || 0) };
}

async function confirmationsManuellesProprio(db, terrainIds, periode) {
  const ids = (terrainIds || []).map(Number).filter((n) => n > 0);
  if (!ids.length) {
    return { nb_confirmations_manuelles: 0, avances_manuelles: 0, periode: periode || periodeCivile() };
  }
  const p = periode || periodeCivile();
  const placeholders = ids.map(() => '?').join(',');
  const row = (await queryOne(
    db,
    `SELECT COUNT(*) AS nb, COALESCE(SUM(montant_avance_manuelle), 0) AS avances
     FROM dettes_commissions
     WHERE terrain_id IN (${placeholders}) AND periode = ?`,
    [...ids, p],
  )) || {};
  return {
    nb_confirmations_manuelles: Number(row.nb || 0),
    avances_manuelles: Number(row.avances || 0),
    periode: p,
  };
}

module.exports = {
  periodeCivile,
  confirmerManuellement,
  resumeGerant,
  resumeSuperadminMois,
  listDettesAdmin,
  remiseAZero,
  confirmationsManuellesProprio,
  instructionsPaiementDette,
  setSetting,
  getSetting,
};
