const { queryAll, queryOne } = require('../database');
const {
  calculerCommissionPrelevee,
  calculerAvanceReference,
} = require('../pricingService');
const { crediterPortefeuilleGerant } = require('./portefeuilleService');
const {
  confirmerCreneauxReservation,
  annulerReservationsConcurrentes,
  rowsModified,
} = require('../reservationLockService');
const { calculerFenetreCheckIn } = require('./checkInFenetre');
const { serializeQrPayload } = require('./qrPayload');
const { dateEcheanceDette } = require('./politiquePaiement');
const { essaiActif } = require('./essaiService');

function genererCodeReservation(db) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = `TF-${Math.floor(100000 + Math.random() * 900000)}`;
    if (!queryOne(db, 'SELECT id FROM reservations WHERE code_reservation = ?', [code])) return code;
  }
  throw new Error('Impossible de générer un code de réservation unique');
}

function periodeCivile(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function lastInsertId(db) {
  return Number(queryOne(db, 'SELECT last_insert_rowid() AS id')?.id || 0);
}

function getSetting(db, cle, fallback = '') {
  const row = queryOne(db, 'SELECT valeur FROM plateforme_settings WHERE cle = ?', [cle]);
  return row?.valeur != null ? String(row.valeur) : fallback;
}

function setSetting(db, cle, valeur) {
  db.run(
    `INSERT INTO plateforme_settings (cle, valeur, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, updated_at = CURRENT_TIMESTAMP`,
    [cle, String(valeur || '')],
  );
}

function instructionsPaiementDette(db) {
  return getSetting(
    db,
    'dette_instructions',
    '',
  );
}

const TERRAIN_COMMISSION_COLS = `
  t.commission_pourcentage, t.pourcentage_avance, t.modele_revenus, t.commission,
  t.acompte, t.montant_acompte, t.politique_paiement, t.delai_paiement_dette_jours,
  t.mode_essai, t.essai_debut_at, t.essai_fin_at, t.essai_suspendu_auto, t.essai_duree_jours,
  t.delai_negociation_jours, t.gerant_id
`;

/**
 * Crée une dette commission pour une résa confirmée sans payin joueur
 * (politique sans_avance, ou confirmation manuelle).
 * Commission = % de l'avance de référence ; 0 si essai actif.
 */
function creerDettePourReservation(db, {
  reservation,
  terrain,
  gerantId,
  note = null,
  source = 'sans_avance',
}) {
  if (!reservation?.id || !terrain?.id) return null;
  const existingDette = queryOne(db, 'SELECT id FROM dettes_commissions WHERE reservation_id = ?', [reservation.id]);
  if (existingDette) return existingDette;

  const prix = Number(reservation.prix_total || reservation.montant || 0);
  const avanceRef = Number(reservation.montant_avance || reservation.acompte || 0) > 0
    ? Number(reservation.montant_avance || reservation.acompte || 0)
    : calculerAvanceReference(terrain, prix);
  const commission = calculerCommissionPrelevee(terrain, avanceRef);
  // En essai : pas de dette commission (plateforme ne facture rien)
  if (commission <= 0 && essaiActif(terrain)) {
    return { id: null, skipped: true, reason: 'essai_actif', commission: 0, montantAvance: avanceRef };
  }
  if (commission <= 0) {
    return { id: null, skipped: true, reason: 'commission_zero', commission: 0, montantAvance: avanceRef };
  }

  const periode = periodeCivile();
  const echeance = dateEcheanceDette(terrain);
  const noteFinale = note
    ? String(note).slice(0, 500)
    : (source === 'sans_avance'
      ? `Sans avance — commission sur avance de référence ${avanceRef} FCFA`
      : null);

  const gid = Number(gerantId || terrain.gerant_id || 0);
  if (!gid) {
    const error = new Error('Aucun gérant pour enregistrer la dette commission');
    error.statusCode = 400;
    throw error;
  }

  db.run(
    `INSERT INTO dettes_commissions
       (terrain_id, gerant_id, reservation_id, montant_commission, montant_avance_manuelle,
        statut, periode, note, date_echeance)
     VALUES (?, ?, ?, ?, ?, 'en_attente', ?, ?, ?)`,
    [terrain.id, gid, reservation.id, commission, avanceRef, periode, noteFinale, echeance],
  );
  const detteId = lastInsertId(db);
  db.run(
    `INSERT INTO audit_dette
       (dette_id, terrain_id, action, montant_concerne, fait_par, role_fait_par, detail)
     VALUES (?, ?, 'creation', ?, ?, 'systeme', ?)`,
    [detteId, terrain.id, commission, gid, `Source=${source}. Avance réf. ${avanceRef} FCFA`],
  );
  return { id: detteId, commission, montantAvance: avanceRef, periode, date_echeance: echeance };
}

function confirmerManuellement(db, { reservationId, gerantId, note }) {
  const reservation = queryOne(
    db,
    `SELECT r.*, ${TERRAIN_COMMISSION_COLS}
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

  const existingDette = queryOne(db, 'SELECT id FROM dettes_commissions WHERE reservation_id = ?', [reservationId]);
  if (existingDette) {
    const error = new Error('Cette réservation a déjà une commission en dette.');
    error.statusCode = 409;
    throw error;
  }

  const prix = Number(reservation.prix_total || reservation.montant || 0);
  const montantAvance = Number(reservation.montant_avance || reservation.acompte || 0) > 0
    ? Number(reservation.montant_avance || reservation.acompte || 0)
    : calculerAvanceReference(reservation, prix);
  const commission = calculerCommissionPrelevee(reservation, montantAvance);
  const periode = periodeCivile();
  const echeance = dateEcheanceDette(reservation);
  const noteGerant = note ? String(note).slice(0, 500) : null;

  let code = reservation.code_reservation;
  if (!code) code = genererCodeReservation(db);

  const retardRow = reservation.creneau_id
    ? queryOne(db, 'SELECT fenetre_retard FROM creneaux WHERE id = ?', [reservation.creneau_id])
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

  db.run(
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

  const confirmedCount = confirmerCreneauxReservation(db, reservation);
  if (confirmedCount < 1) {
    db.run("UPDATE reservations SET statut = 'en_attente', mode_paiement = 'en_ligne' WHERE id = ?", [reservationId]);
    const error = new Error('Créneau indisponible — confirmation manuelle impossible.');
    error.statusCode = 409;
    throw error;
  }

  const loserIds = annulerReservationsConcurrentes(db, { ...reservation, id: reservationId });

  let detteId = null;
  if (commission > 0) {
    db.run(
      `INSERT INTO dettes_commissions
         (terrain_id, gerant_id, reservation_id, montant_commission, montant_avance_manuelle,
          statut, periode, note, date_echeance)
       VALUES (?, ?, ?, ?, ?, 'en_attente', ?, ?, ?)`,
      [reservation.terrain_id, gerantId, reservationId, commission, montantAvance, periode, noteGerant, echeance],
    );
    detteId = lastInsertId(db);

    db.run(
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
  }

  db.run(
    `INSERT INTO paiements
       (reservation_id, montant, methode, statut, reference_externe, montant_acompte, montant_commission, montant_reverse, statut_reversement)
     VALUES (?, ?, 'manuel', 'paye', ?, ?, ?, ?, 'effectue')`,
    [reservationId, montantAvance, `MANUEL-GERANT-${reservationId}-${Date.now()}`, montantAvance, commission, Math.max(0, montantAvance - commission)],
  );

  crediterPortefeuilleGerant(db, {
    gerantId,
    terrainId: reservation.terrain_id,
    reservationId,
    montantEncaisse: montantAvance,
    montantCommission: 0,
  });

  return { code, commission, montantAvance, terrainId: reservation.terrain_id, loserIds };
}

function resumeGerant(db, gerantId, periode) {
  const p = periode || periodeCivile();
  const resume = queryOne(
    db,
    `SELECT COUNT(*) as nb_reservations_manuelles,
            COALESCE(SUM(montant_commission), 0) as total_dette,
            COALESCE(SUM(CASE WHEN statut='en_attente' THEN montant_commission ELSE 0 END), 0) as dette_en_cours,
            COALESCE(SUM(CASE WHEN statut='payee' THEN montant_commission ELSE 0 END), 0) as dette_payee
     FROM dettes_commissions
     WHERE gerant_id = ? AND periode = ?`,
    [gerantId, p],
  ) || {};
  const detail = queryAll(
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
  const historique = queryAll(
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
    instructions: instructionsPaiementDette(db),
  };
}

function resumeSuperadminMois(db, periode) {
  const p = periode || periodeCivile();
  const row = queryOne(
    db,
    `SELECT COALESCE(SUM(montant_commission), 0) AS total,
            COUNT(DISTINCT terrain_id) AS terrains
     FROM dettes_commissions
     WHERE statut = 'en_attente' AND periode = ?`,
    [p],
  ) || {};
  return {
    periode: p,
    total_en_attente: Number(row.total || 0),
    terrains_concernes: Number(row.terrains || 0),
  };
}

function listDettesAdmin(db, { periode, terrainId, statut }) {
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

  const parTerrain = queryAll(
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

  const lignes = queryAll(
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

  const audit = queryAll(
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
    resume: resumeSuperadminMois(db, p),
    par_terrain: parTerrain,
    lignes,
    audit,
    instructions: instructionsPaiementDette(db),
  };
}

function remiseAZero(db, { terrainId, superAdminId, note, montantRecu, periode }) {
  const p = periode || periodeCivile();
  const pending = queryOne(
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
  db.run(
    `UPDATE dettes_commissions SET
       statut = 'payee',
       payee_at = CURRENT_TIMESTAMP,
       remise_a_zero_par = ?,
       remise_a_zero_at = CURRENT_TIMESTAMP,
       note = COALESCE(?, note)
     WHERE terrain_id = ? AND statut = 'en_attente' AND periode = ?`,
    [superAdminId, noteFinale, terrainId, p],
  );

  db.run(
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

function confirmationsManuellesProprio(db, terrainIds, periode) {
  const ids = (terrainIds || []).map(Number).filter((n) => n > 0);
  if (!ids.length) {
    return { nb_confirmations_manuelles: 0, avances_manuelles: 0, periode: periode || periodeCivile() };
  }
  const p = periode || periodeCivile();
  const placeholders = ids.map(() => '?').join(',');
  const row = queryOne(
    db,
    `SELECT COUNT(*) AS nb, COALESCE(SUM(montant_avance_manuelle), 0) AS avances
     FROM dettes_commissions
     WHERE terrain_id IN (${placeholders}) AND periode = ?`,
    [...ids, p],
  ) || {};
  return {
    nb_confirmations_manuelles: Number(row.nb || 0),
    avances_manuelles: Number(row.avances || 0),
    periode: p,
  };
}

/** Dette commission encore ouverte pour un terrain (toutes périodes). */
function detteOuverteTerrain(db, terrainId) {
  const row = queryOne(
    db,
    `SELECT COALESCE(SUM(montant_commission), 0) AS total, COUNT(*) AS nb
     FROM dettes_commissions
     WHERE terrain_id = ? AND statut = 'en_attente'`,
    [Number(terrainId)],
  ) || {};
  return {
    total: Number(row.total || 0),
    nb: Number(row.nb || 0),
  };
}

/**
 * Compense la dette ouverte sur un montant de payout (FIFO).
 * Retourne le montant réellement à verser au gérant et le détail compensé.
 */
function preparerCompensationDette(db, { terrainId, montantDisponible }) {
  const dispo = Math.max(0, Math.round(Number(montantDisponible || 0)));
  const ouvertes = queryAll(
    db,
    `SELECT id, montant_commission, periode
     FROM dettes_commissions
     WHERE terrain_id = ? AND statut = 'en_attente'
     ORDER BY created_at ASC, id ASC`,
    [Number(terrainId)],
  );
  let reste = dispo;
  let compense = 0;
  const lignes = [];
  for (const d of ouvertes) {
    if (reste <= 0) break;
    const due = Number(d.montant_commission || 0);
    const prise = Math.min(due, reste);
    if (prise <= 0) continue;
    lignes.push({ dette_id: d.id, montant: prise, periode: d.periode, total_dette: due });
    compense += prise;
    reste -= prise;
  }
  return {
    montant_brut: dispo,
    montant_compense: compense,
    montant_net: dispo - compense,
    dette_ouverte_avant: ouvertes.reduce((s, d) => s + Number(d.montant_commission || 0), 0),
    lignes,
  };
}

/**
 * Applique la compensation préparée : marque les dettes payées (totales) ou
 * réduit via audit si partiel (on marque payée uniquement si montant couvert intégralement).
 * Pour simplicité métier : une dette n'est soldée que si prise >= montant_commission.
 */
function appliquerCompensationDette(db, { terrainId, lignes, faitPar, roleFaitPar = 'systeme', payoutId = null, detail = '' }) {
  if (!lignes?.length) return { soldées: 0, montant: 0 };
  let soldées = 0;
  let montant = 0;
  for (const ligne of lignes) {
    const dette = queryOne(db, 'SELECT * FROM dettes_commissions WHERE id = ? AND statut = ?', [
      ligne.dette_id,
      'en_attente',
    ]);
    if (!dette) continue;
    const due = Number(dette.montant_commission || 0);
    const prise = Math.min(due, Number(ligne.montant || 0));
    if (prise < due) {
      // Paiement partiel : on enregistre l'audit et on réduit le montant restant
      db.run(
        `UPDATE dettes_commissions SET montant_commission = montant_commission - ? WHERE id = ? AND statut = 'en_attente'`,
        [prise, dette.id],
      );
      db.run(
        `INSERT INTO audit_dette
           (dette_id, terrain_id, action, montant_concerne, fait_par, role_fait_par, detail)
         VALUES (?, ?, 'paiement_partiel', ?, ?, ?, ?)`,
        [
          dette.id,
          Number(terrainId),
          prise,
          faitPar || null,
          roleFaitPar,
          `Compensation payout #${payoutId || '—'}. ${detail || ''}`.trim(),
        ],
      );
    } else {
      db.run(
        `UPDATE dettes_commissions SET
           statut = 'payee',
           payee_at = CURRENT_TIMESTAMP,
           remise_a_zero_par = ?,
           remise_a_zero_at = CURRENT_TIMESTAMP
         WHERE id = ? AND statut = 'en_attente'`,
        [faitPar || null, dette.id],
      );
      db.run(
        `INSERT INTO audit_dette
           (dette_id, terrain_id, action, montant_concerne, fait_par, role_fait_par, detail)
         VALUES (?, ?, 'paiement_total', ?, ?, ?, ?)`,
        [
          dette.id,
          Number(terrainId),
          prise,
          faitPar || null,
          roleFaitPar,
          `Compensation automatique via payout #${payoutId || '—'}. ${detail || ''}`.trim(),
        ],
      );
      soldées += 1;
    }
    montant += prise;
  }
  return { soldées, montant };
}

/**
 * Marque toutes les dettes en_attente d'un gérant/période comme payées (après payin dette).
 */
function confirmerPaiementDetteEnLigne(db, {
  gerantId,
  periode,
  reference,
  montantPaye,
  faitPar = null,
}) {
  const p = periode || periodeCivile();
  const pending = queryOne(
    db,
    `SELECT COUNT(*) AS nb, COALESCE(SUM(montant_commission), 0) AS total
     FROM dettes_commissions
     WHERE gerant_id = ? AND statut = 'en_attente' AND periode = ?`,
    [Number(gerantId), p],
  );
  const total = Number(pending?.total || 0);
  if (!Number(pending?.nb) || total <= 0) {
    return { action: 'already_paid', periode: p, montant: 0 };
  }

  const rows = queryAll(
    db,
    `SELECT id, terrain_id, montant_commission FROM dettes_commissions
     WHERE gerant_id = ? AND statut = 'en_attente' AND periode = ?`,
    [Number(gerantId), p],
  );

  db.run(
    `UPDATE dettes_commissions SET
       statut = 'payee',
       payee_at = CURRENT_TIMESTAMP,
       montant_regle = montant_commission,
       derniere_mise_a_jour = CURRENT_TIMESTAMP
     WHERE gerant_id = ? AND statut = 'en_attente' AND periode = ?`,
    [Number(gerantId), p],
  );

  for (const row of rows) {
    db.run(
      `INSERT INTO audit_dette
         (dette_id, terrain_id, action, montant_concerne, fait_par, role_fait_par, detail)
       VALUES (?, ?, 'paiement_total', ?, ?, 'gerant', ?)`,
      [
        row.id,
        row.terrain_id,
        Number(row.montant_commission || 0),
        faitPar || Number(gerantId),
        `Paiement en ligne dette. Ref=${reference || '—'}. Montant IPN=${Number(montantPaye || total)}`,
      ],
    );
  }

  db.run(
    `UPDATE paiements_dettes SET statut = 'paye', payee_at = CURRENT_TIMESTAMP
     WHERE reference = ? AND statut = 'en_attente'`,
    [String(reference || '')],
  );

  return {
    action: 'confirm',
    periode: p,
    montant: total,
    nb: rows.length,
    gerant_id: Number(gerantId),
  };
}

function enregistrerPaiementDettePending(db, {
  gerantId,
  terrainId,
  periode,
  montant,
  reference,
}) {
  db.run(
    `UPDATE paiements_dettes SET statut = 'annule'
     WHERE gerant_id = ? AND periode = ? AND statut = 'en_attente'`,
    [Number(gerantId), String(periode)],
  );
  db.run(
    `INSERT INTO paiements_dettes
       (terrain_id, gerant_id, periode, montant, reference, statut)
     VALUES (?, ?, ?, ?, ?, 'en_attente')`,
    [terrainId ? Number(terrainId) : null, Number(gerantId), String(periode), Number(montant), String(reference)],
  );
  return queryOne(db, 'SELECT * FROM paiements_dettes WHERE reference = ?', [String(reference)]);
}

function paiementDetteParReference(db, reference) {
  return queryOne(db, 'SELECT * FROM paiements_dettes WHERE reference = ?', [String(reference || '')]);
}

module.exports = {
  periodeCivile,
  confirmerManuellement,
  creerDettePourReservation,
  resumeGerant,
  resumeSuperadminMois,
  listDettesAdmin,
  remiseAZero,
  confirmationsManuellesProprio,
  instructionsPaiementDette,
  setSetting,
  getSetting,
  detteOuverteTerrain,
  preparerCompensationDette,
  appliquerCompensationDette,
  confirmerPaiementDetteEnLigne,
  enregistrerPaiementDettePending,
  paiementDetteParReference,
};
