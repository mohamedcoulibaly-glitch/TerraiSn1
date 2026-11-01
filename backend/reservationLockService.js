const { queryAll, queryOne } = require('./database');
const { peutConfirmer } = require('./domain/reservationState');
const {
  parseHour,
  formatHour,
  normalizeHourString,
  hourlySlots,
} = require('./scheduleService');

const DEFAULT_DELAI_VERROU_PAIEMENT_MIN = 15;

/** Délai (minutes) pendant lequel un créneau reste verrouillé en attente de paiement : 1..120, défaut 15. */
function normaliserDelaiVerrouPaiementMin(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DELAI_VERROU_PAIEMENT_MIN;
  if (n > 120) return 120;
  return Math.round(n);
}

function rowsModified(database) {
  if (typeof database.getRowsModified === 'function') {
    return database.getRowsModified();
  }
  return 0;
}

function conflictError(message = 'Créneau déjà réservé ou en attente de paiement') {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = 'CRENEAU_CONFLIT';
  return error;
}

/**
 * Verrouille atomiquement tous les créneaux horaires d'une plage.
 * À appeler uniquement à l'intérieur de transaction() (BEGIN IMMEDIATE).
 * @returns {number} creneau_id principal (1ère heure)
 */
function libererVerrousExpires(database, now = Date.now()) {
  // verrou_expire_at NULL = legacy / bug : traité comme expiré pour ne plus
  // bloquer le créneau à vie (lockCreneauxAtomique ne bloque plus sur NULL).
  const expired = queryAll(
    database,
    `SELECT id, creneau_id, terrain_id, date, heure_debut, heure_fin, statut
     FROM reservations
     WHERE statut IN ('en_attente', 'en_attente_paiement')
       AND (
         verrou_expire_at IS NULL
         OR verrou_expire_at <= ?
       )`,
    [now],
  );
  const ids = [];
  for (const reservation of expired) {
    database.run(
      `UPDATE reservations SET statut = 'expire'
       WHERE id = ? AND statut IN ('en_attente', 'en_attente_paiement')`,
      [reservation.id],
    );
    if (rowsModified(database) !== 1) continue;
    libererCreneauxReservation(database, reservation, ['en_attente_paiement']);
    ids.push(reservation.id);
    // Temps réel : le gérant (et la fiche joueur) voient le créneau se libérer
    // dès l'expiration du verrou, sans attendre un refresh.
    try {
      require('./services/sseManager').emettrePourTerrain(reservation.terrain_id, 'creneau_libere', {
        reservation_id: reservation.id,
        creneau_id: reservation.creneau_id || null,
        statut: 'libre',
        raison: 'verrou_expire',
      });
    } catch {
      // best-effort
    }
  }
  return ids;
}

function lockCreneauxAtomique(database, terrainId, date, heureDebut, heureFin) {
  libererVerrousExpires(database);
  const slots = hourlySlots(heureDebut, heureFin);
  if (!slots.length) throw conflictError('Créneau invalide');

  const now = Date.now();
  const chevauchementResa = queryAll(
    database,
    `SELECT id FROM reservations
      WHERE terrain_id = ? AND date = ?
        AND (
          statut IN ('confirme', 'acceptee')
          OR (
            statut IN ('en_attente', 'en_attente_paiement')
            AND verrou_expire_at IS NOT NULL
            AND verrou_expire_at > ?
          )
        )
        AND heure_debut < ? AND heure_fin > ?`,
    [terrainId, date, now, heureFin, heureDebut],
  );
  if (chevauchementResa.length) throw conflictError();

  // Libère les en_attente_paiement orphelins (retour navigateur / verrou expiré non nettoyé)
  const orphans = queryAll(
    database,
    `SELECT id, heure_debut, heure_fin FROM creneaux
      WHERE terrain_id = ? AND date = ?
        AND statut = 'en_attente_paiement'
        AND substr(heure_debut,1,5) < ? AND substr(heure_fin,1,5) > ?`,
    [terrainId, date, heureFin, heureDebut],
  );
  for (const slotOrphelin of orphans) {
    const active = queryOne(
      database,
      `SELECT id FROM reservations
        WHERE terrain_id = ? AND date = ?
          AND statut IN ('en_attente', 'en_attente_paiement')
          AND verrou_expire_at IS NOT NULL
          AND verrou_expire_at > ?
          AND heure_debut < ? AND heure_fin > ?`,
      [terrainId, date, now, slotOrphelin.heure_fin, slotOrphelin.heure_debut],
    );
    if (!active) {
      database.run(
        "UPDATE creneaux SET statut = 'libre' WHERE id = ? AND statut = 'en_attente_paiement'",
        [slotOrphelin.id],
      );
    }
  }

  const chevauchementCreneau = queryAll(
    database,
    `SELECT id FROM creneaux
      WHERE terrain_id = ? AND date = ?
        AND statut != 'libre'
        AND substr(heure_debut,1,5) < ? AND substr(heure_fin,1,5) > ?`,
    [terrainId, date, heureFin, heureDebut],
  );
  if (chevauchementCreneau.length) throw conflictError();

  const blocages = queryAll(
    database,
    `SELECT id FROM blocages_creneaux
      WHERE terrain_id = ? AND date = ?
        AND substr(heure_debut,1,5) < ? AND substr(heure_fin,1,5) > ?`,
    [terrainId, date, heureFin, heureDebut],
  );
  if (blocages.length) {
    throw conflictError('Créneau bloqué par le gérant');
  }

  let primaryId = null;
  for (const slot of slots) {
    let creneau = queryOne(
      database,
      'SELECT * FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?',
      [terrainId, date, slot.heure_debut, slot.heure_fin],
    );
    if (!creneau) {
      database.run(
        'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)',
        [terrainId, date, slot.heure_debut, slot.heure_fin, 'libre'],
      );
      creneau = queryOne(
        database,
        'SELECT * FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?',
        [terrainId, date, slot.heure_debut, slot.heure_fin],
      );
    }

    database.run(
      "UPDATE creneaux SET statut = 'en_attente_paiement' WHERE id = ? AND statut = 'libre'",
      [creneau.id],
    );
    if (rowsModified(database) !== 1) throw conflictError();
    if (primaryId == null) primaryId = creneau.id;
  }

  // Si une ancienne ligne multi-heures existe encore pour la plage exacte, la verrouiller aussi
  const exact = queryOne(
    database,
    'SELECT * FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?',
    [terrainId, date, heureDebut, heureFin],
  );
  if (exact && exact.statut === 'libre' && slots.length > 1) {
    database.run(
      "UPDATE creneaux SET statut = 'en_attente_paiement' WHERE id = ? AND statut = 'libre'",
      [exact.id],
    );
  }

  return primaryId;
}

function libererCreneauxReservation(database, reservation, statuts = ['en_attente_paiement', 'reserve']) {
  if (!reservation) return;
  const statutList = statuts.map((s) => `'${s}'`).join(', ');
  const slots = hourlySlots(reservation.heure_debut, reservation.heure_fin);

  for (const slot of slots) {
    database.run(
      `UPDATE creneaux SET statut = 'libre'
        WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?
          AND statut IN (${statutList})`,
      [reservation.terrain_id, reservation.date, slot.heure_debut, slot.heure_fin],
    );
  }

  if (reservation.creneau_id) {
    database.run(
      `UPDATE creneaux SET statut = 'libre' WHERE id = ? AND statut IN (${statutList})`,
      [reservation.creneau_id],
    );
  }

  // Ancienne ligne multi-heures éventuelle
  if (slots.length > 1) {
    database.run(
      `UPDATE creneaux SET statut = 'libre'
        WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?
          AND statut IN (${statutList})`,
      [reservation.terrain_id, reservation.date, reservation.heure_debut, reservation.heure_fin],
    );
  }
}

function confirmerCreneauxReservation(database, reservation) {
  const slots = hourlySlots(reservation.heure_debut, reservation.heure_fin);
  let confirmed = 0;
  for (const slot of slots) {
    database.run(
      `UPDATE creneaux SET statut = 'reserve'
        WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?
          AND statut = 'en_attente_paiement'`,
      [reservation.terrain_id, reservation.date, slot.heure_debut, slot.heure_fin],
    );
    confirmed += rowsModified(database);
  }
  if (reservation.creneau_id) {
    database.run(
      "UPDATE creneaux SET statut = 'reserve' WHERE id = ? AND statut = 'en_attente_paiement'",
      [reservation.creneau_id],
    );
    confirmed += rowsModified(database);
  }
  if (slots.length > 1) {
    database.run(
      `UPDATE creneaux SET statut = 'reserve'
        WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?
          AND statut = 'en_attente_paiement'`,
      [reservation.terrain_id, reservation.date, reservation.heure_debut, reservation.heure_fin],
    );
    confirmed += rowsModified(database);
  }
  return confirmed;
}

/**
 * Annule les autres réservations en attente qui chevauchent le même créneau
 * lorsqu'une réservation est confirmée (manuel ou payin).
 * @returns {number[]} ids des réservations annulées
 */
/**
 * Après la fenêtre de check-in : absence non scannée → `no_show` + créneau libéré.
 * Présence scannée non clôturée → `match_joue` + stage closed (évite les fantômes).
 */
function cloturerJourExpires(database, now = Date.now()) {
  const { calculerFenetreCheckIn, DEFAULT_FENETRE_RETARD_MIN } = require('./services/checkInFenetre');
  const candidates = queryAll(
    database,
    `SELECT r.id, r.creneau_id, r.terrain_id, r.date, r.heure_debut, r.heure_fin,
            r.qr_code_scanne_at, r.statut, r.prix_total, r.montant, r.montant_avance, r.acompte,
            r.reste_a_payer, r.montant_restant, r.gerant_id,
            COALESCE(c.fenetre_retard, ${DEFAULT_FENETRE_RETARD_MIN}) AS fenetre_retard
     FROM reservations r
     LEFT JOIN creneaux c ON c.id = r.creneau_id
     WHERE r.statut IN ('confirme', 'acceptee')`,
  );
  const noShowIds = [];
  const closedIds = [];
  for (const row of candidates) {
    const { finFenetre } = calculerFenetreCheckIn({
      date: row.date,
      heure_debut: row.heure_debut,
      heure_fin: row.heure_fin,
      fenetre_retard: row.fenetre_retard,
    });
    if (now <= finFenetre) continue;

    if (!row.qr_code_scanne_at) {
      database.run(
        `UPDATE reservations
            SET statut = 'no_show',
                operational_stage = 'closed',
                checkout_at = COALESCE(checkout_at, CURRENT_TIMESTAMP)
          WHERE id = ? AND statut IN ('confirme', 'acceptee') AND qr_code_scanne_at IS NULL`,
        [row.id],
      );
      if (rowsModified(database) !== 1) continue;
      libererCreneauxReservation(database, row, ['reserve', 'en_attente_paiement']);
      noShowIds.push(row.id);
      try {
        require('./services/sseManager').emettrePourTerrain(row.terrain_id, 'creneau_libere', {
          reservation_id: row.id,
          creneau_id: row.creneau_id || null,
          statut: 'libre',
          raison: 'no_show',
        });
      } catch {
        /* best-effort */
      }
      continue;
    }

    // Scanné mais jamais clôturé via Kanban → clôture auto.
    database.run(
      `UPDATE reservations
          SET statut = 'match_joue',
              operational_stage = 'closed',
              checkout_at = COALESCE(checkout_at, CURRENT_TIMESTAMP)
        WHERE id = ? AND statut IN ('confirme', 'acceptee') AND qr_code_scanne_at IS NOT NULL`,
      [row.id],
    );
    if (rowsModified(database) !== 1) continue;
    const existingMatch = queryOne(database, 'SELECT id FROM matchs WHERE reservation_id = ?', [row.id]);
    if (!existingMatch) {
      const avancePayee = Number(row.montant_avance ?? row.acompte ?? 0);
      const total = Number(row.prix_total || row.montant || 0);
      const restant = Number(row.reste_a_payer ?? row.montant_restant ?? 0);
      database.run(
        `INSERT INTO matchs (reservation_id, terrain_id, gerant_id, montant_total, acompte_paye, solde_paye, methode_solde)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.terrain_id,
          row.gerant_id || null,
          total,
          avancePayee,
          restant > 0 ? 0 : Math.max(0, total - avancePayee),
          'especes',
        ],
      );
    }
    if (row.creneau_id) {
      database.run(`UPDATE creneaux SET statut = 'joue' WHERE id = ?`, [row.creneau_id]);
    }
    closedIds.push(row.id);
  }
  return { noShowIds, closedIds };
}

function annulerReservationsConcurrentes(database, reservation) {
  if (!reservation?.terrain_id || !reservation?.date) return [];
  const losers = queryAll(
    database,
    `SELECT id, creneau_id, terrain_id, date, heure_debut, heure_fin FROM reservations
     WHERE terrain_id = ? AND date = ? AND id != ?
       AND statut IN ('en_attente', 'en_attente_paiement')
       AND heure_debut < ? AND heure_fin > ?`,
    [
      reservation.terrain_id,
      reservation.date,
      reservation.id,
      reservation.heure_fin,
      reservation.heure_debut,
    ],
  );
  const loserIds = [];
  for (const loser of losers) {
    database.run(
      "UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut IN ('en_attente', 'en_attente_paiement')",
      [loser.id],
    );
    if (rowsModified(database) !== 1) continue;
    libererCreneauxReservation(database, loser, ['en_attente_paiement']);
    database.run(
      `UPDATE paiements SET statut = 'annule' WHERE reservation_id = ? AND statut = 'en_attente'`,
      [loser.id],
    );
    loserIds.push(loser.id);
  }
  return loserIds;
}

module.exports = {
  parseHour,
  formatHour,
  normalizeHourString,
  hourlySlots,
  rowsModified,
  normaliserDelaiVerrouPaiementMin,
  DEFAULT_DELAI_VERROU_PAIEMENT_MIN,
  lockCreneauxAtomique,
  libererVerrousExpires,
  cloturerJourExpires,
  libererCreneauxReservation,
  peutConfirmer,
  confirmerCreneauxReservation,
  annulerReservationsConcurrentes,
  conflictError,
};
