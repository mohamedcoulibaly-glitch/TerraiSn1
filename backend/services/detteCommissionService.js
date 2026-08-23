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

/** Fin du mois de la période (YYYY-MM) + délai en jours → date ISO YYYY-MM-DD */
function calculerDateEcheance(periodeYYYYMM, delaiJours = 7) {
  const parts = String(periodeYYYYMM || periodeCivile()).split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    const now = new Date();
    const fin = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    fin.setDate(fin.getDate() + Math.max(0, Number(delaiJours) || 0));
    const yy = fin.getFullYear();
    const mm = String(fin.getMonth() + 1).padStart(2, '0');
    const dd = String(fin.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }
  const finMois = new Date(y, m, 0);
  finMois.setDate(finMois.getDate() + Math.max(0, Number(delaiJours) || 0));
  const yy = finMois.getFullYear();
  const mm = String(finMois.getMonth() + 1).padStart(2, '0');
  const dd = String(finMois.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function joursRestantsDepuis(dateEcheance) {
  if (!dateEcheance) return null;
  const echeance = new Date(`${String(dateEcheance).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(echeance.getTime())) return null;
  const auj = new Date();
  const aujMidi = new Date(auj.getFullYear(), auj.getMonth(), auj.getDate(), 12, 0, 0);
  return Math.ceil((echeance.getTime() - aujMidi.getTime()) / (1000 * 60 * 60 * 24));
}

async function resoudreGerantTerrain(db, terrainId) {
  const { getGerantPrincipal } = require('./gerantService');
  try {
    const principal = await getGerantPrincipal(terrainId);
    if (principal?.gerant_id) return Number(principal.gerant_id);
  } catch (_) {
    /* fallback ci-dessous */
  }
  const row = await queryOne(
    db,
    `SELECT e.id FROM employes e
     WHERE e.terrain_id = ? AND COALESCE(e.is_active, 1) = 1
     ORDER BY e.id ASC LIMIT 1`,
    [terrainId],
  );
  return row ? Number(row.id) : null;
}

/**
 * Enregistre une ligne de dette commission + upsert résumé période.
 * Utilisé par confirmation manuelle et flux sans_avance.
 */
async function enregistrerDetteCommission(db, {
  terrainId,
  gerantId,
  reservationId,
  montantCommission,
  montantAvanceManuelle = 0,
  periode,
  dateEcheance,
  note = null,
  faitPar = null,
  roleFaitPar = 'gerant',
  detailAudit = null,
}) {
  const p = periode || periodeCivile();
  const commission = Math.max(0, Math.round(Number(montantCommission) || 0));
  const avance = Math.max(0, Math.round(Number(montantAvanceManuelle) || 0));
  const echeance = dateEcheance || null;

  const detteResult = await runSql(
    db,
    `INSERT INTO dettes_commissions
       (terrain_id, gerant_id, reservation_id, montant_commission, montant_avance_manuelle,
        statut, periode, date_echeance, montant_regle, note, derniere_mise_a_jour)
     VALUES (?, ?, ?, ?, ?, 'en_attente', ?, ?, 0, ?, CURRENT_TIMESTAMP)`,
    [terrainId, gerantId, reservationId, commission, avance, p, echeance, note],
  );
  const detteId = Number(detteResult.lastInsertRowid || 0);

  await runSql(
    db,
    `INSERT INTO resume_dette_periode
       (terrain_id, gerant_id, periode, total_commission, total_regle, date_echeance, statut, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, 'en_cours', CURRENT_TIMESTAMP)
     ON CONFLICT (terrain_id, gerant_id, periode) DO UPDATE SET
       total_commission = resume_dette_periode.total_commission + EXCLUDED.total_commission,
       date_echeance = COALESCE(resume_dette_periode.date_echeance, EXCLUDED.date_echeance),
       updated_at = CURRENT_TIMESTAMP`,
    [terrainId, gerantId, p, commission, echeance],
  );

  await runSql(
    db,
    `INSERT INTO audit_dette
       (dette_id, terrain_id, action, montant_concerne, fait_par, role_fait_par, detail)
     VALUES (?, ?, 'creation', ?, ?, ?, ?)`,
    [
      detteId,
      terrainId,
      commission,
      faitPar != null ? faitPar : gerantId,
      roleFaitPar || 'gerant',
      detailAudit || note || 'Commission en dette',
    ],
  );

  return { detteId, commission, periode: p, dateEcheance: echeance };
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
  return getSetting(db, 'dette_instructions', '');
}

async function confirmerManuellement(db, { reservationId, gerantId, note }) {
  const reservation = await queryOne(
    db,
    `SELECT r.*, t.commission_pourcentage, t.pourcentage_avance, t.modele_revenus, t.commission,
            t.acompte, t.montant_acompte, t.delai_paiement_dette_jours
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
  const delaiJours = Math.max(7, Math.min(90, Number(reservation.delai_paiement_dette_jours) || 30));
  const dateEcheance = calculerDateEcheance(periode, delaiJours);
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

  await enregistrerDetteCommission(db, {
    terrainId: reservation.terrain_id,
    gerantId,
    reservationId,
    montantCommission: commission,
    montantAvanceManuelle: montantAvance,
    periode,
    dateEcheance,
    note: noteGerant,
    faitPar: gerantId,
    roleFaitPar: 'gerant',
    detailAudit: `Confirmation manuelle. Avance reçue hors PayTech : ${montantAvance} FCFA`,
  });

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
            COALESCE(SUM(CASE WHEN statut='en_attente'
              THEN montant_commission - COALESCE(montant_regle, 0) ELSE 0 END), 0) as dette_en_cours,
            COALESCE(SUM(CASE WHEN statut='payee' THEN montant_commission ELSE 0 END), 0) as dette_payee,
            MIN(date_echeance) FILTER (WHERE statut = 'en_attente') as date_echeance_dettes
     FROM dettes_commissions
     WHERE gerant_id = ? AND periode = ?`,
    [gerantId, p],
  )) || {};

  const rdp = (await queryOne(
    db,
    `SELECT
       COALESCE(SUM(rdp.total_commission), 0) AS total_commission,
       COALESCE(SUM(rdp.total_regle), 0) AS total_regle,
       COALESCE(SUM(rdp.total_commission - rdp.total_regle), 0) AS solde_restant,
       MIN(rdp.date_echeance) AS date_echeance,
       MAX(t.delai_paiement_dette_jours) AS delai_paiement_dette_jours
     FROM resume_dette_periode rdp
     JOIN terrains t ON t.id = rdp.terrain_id
     WHERE rdp.gerant_id = ? AND rdp.periode = ?`,
    [gerantId, p],
  )) || {};

  let dateEcheance = rdp.date_echeance || resume.date_echeance_dettes || null;
  let delaiJours = Number(rdp.delai_paiement_dette_jours);
  if (!Number.isFinite(delaiJours) || delaiJours < 1) {
    const terrainDelai = await queryOne(
      db,
      `SELECT t.delai_paiement_dette_jours
       FROM employes e JOIN terrains t ON t.id = e.terrain_id
       WHERE e.id = ? LIMIT 1`,
      [gerantId],
    );
    delaiJours = Number(terrainDelai?.delai_paiement_dette_jours) || 30;
  }
  if (!dateEcheance && Number(resume.dette_en_cours) > 0) {
    dateEcheance = calculerDateEcheance(p, delaiJours);
  }

  const soldeFromRdp = Number(rdp.solde_restant);
  const hasRdp = Number(rdp.total_commission || 0) > 0 || Number(rdp.total_regle || 0) > 0;
  const detteEnCours = hasRdp ? Math.max(0, soldeFromRdp) : Number(resume.dette_en_cours || 0);

  const detail = await queryAll(
    db,
    `SELECT d.*, r.code_reservation, r.created_at as resa_date, r.note_gerant,
            r.date as match_date, r.heure_debut,
            COALESCE(u.prenom, r.joueur_nom) as joueur_nom,
            (COALESCE(d.montant_commission, 0) - COALESCE(d.montant_regle, 0)) as solde_ligne
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
            COALESCE(SUM(CASE WHEN statut='en_attente'
              THEN montant_commission - COALESCE(montant_regle, 0) ELSE 0 END), 0) AS solde,
            SUM(CASE WHEN statut='en_attente' THEN 1 ELSE 0 END) AS nb_attente,
            MAX(payee_at) AS date_reglement
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
      dette_en_cours: detteEnCours,
      dette_payee: Number(resume.dette_payee || 0),
      total_commission: Number(rdp.total_commission || resume.total_dette || 0),
      total_regle: Number(rdp.total_regle || 0),
      solde_restant: detteEnCours,
      date_echeance: dateEcheance,
      jours_restants: joursRestantsDepuis(dateEcheance),
      delai_paiement_dette_jours: delaiJours,
      statut_periode: detteEnCours <= 0 ? 'solde' : 'en_cours',
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
  calculerDateEcheance,
  joursRestantsDepuis,
  resoudreGerantTerrain,
  enregistrerDetteCommission,
  creerLigneDette: enregistrerDetteCommission,
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
