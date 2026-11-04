const { queryAll, queryOne } = require('./database');
const { peutConfirmer } = require('./domain/reservationState');
const {
  parseHour,
  formatHour,
  normalizeHourString,
  hourlySlots,
} = require('./scheduleService');
const {
  peutReserver,
  attribuerZone,
  syncStatutCreneaux,
  normalizeFormat,
  etatCreneau,
} = require('./services/capaciteService');

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
    const etat = etatCreneau(
      database,
      reservation.terrain_id,
      reservation.date,
      reservation.heure_debut,
      reservation.heure_fin,
    );
    try {
      const eventType =
        etat.etat === 'complet'
          ? 'creneau_complet'
          : etat.etat === 'partiel'
            ? 'creneau_partiel'
            : 'creneau_libere';
      require('./services/sseManager').emettrePourTerrain(reservation.terrain_id, eventType, {
        reservation_id: reservation.id,
        creneau_id: reservation.creneau_id || null,
        statut: etat.etat,
        etat: etat.etat,
        zones_libres: etat.zones_libres,
        zone: reservation.zone || null,
        raison: 'verrou_expire',
      });
    } catch {
      // best-effort
    }
  }
  return ids;
}

/**
 * Vérifie la capacité (zones A/B) et assure l'existence des lignes creneaux.
 * @param {string} [formatTerrain='entier'] - 'moitie' | 'entier' — consomme la capacité du type
 * @returns {number} creneau_id principal (1ère heure)
 */
function lockCreneauxAtomique(database, terrainId, date, heureDebut, heureFin, formatTerrain = 'entier') {
  libererVerrousExpires(database);
  const slots = hourlySlots(heureDebut, heureFin);
  if (!slots.length) throw conflictError('Créneau invalide');

  const format = normalizeFormat(formatTerrain);
  if (!peutReserver(format, database, terrainId, date, heureDebut, heureFin)) {
    throw conflictError(
      format === 'moitie'
        ? 'Aucune moitié disponible sur ce créneau'
        : 'Créneau déjà réservé ou en attente de paiement',
    );
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
    if (primaryId == null) primaryId = creneau.id;
  }

  // Ligne multi-heures legacy éventuelle
  const exact = queryOne(
    database,
    'SELECT * FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?',
    [terrainId, date, heureDebut, heureFin],
  );
  if (!exact && slots.length > 1) {
    database.run(
      'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)',
      [terrainId, date, heureDebut, heureFin, 'libre'],
    );
  }

  return primaryId;
}

/**
 * Recalcule les statuts créneaux après libération (capacité zones).
 * Le paramètre `statuts` est conservé pour compatibilité d'appel (ignoré).
 */
function libererCreneauxReservation(database, reservation, _statuts = ['en_attente_paiement', 'reserve']) {
  if (!reservation) return;
  syncStatutCreneaux(
    database,
    reservation.terrain_id,
    reservation.date,
    reservation.heure_debut,
    reservation.heure_fin,
  );
}

/**
 * Aligne les créneaux après confirmation (zone déjà écrite sur la réservation).
 * @returns {number} >0 si sync OK
 */
function confirmerCreneauxReservation(database, reservation) {
  if (!reservation?.terrain_id) return 0;
  syncStatutCreneaux(
    database,
    reservation.terrain_id,
    reservation.date,
    reservation.heure_debut,
    reservation.heure_fin,
  );
  return 1;
}

/**
 * Annule les réservations en attente qui ne rentrent plus en capacité
 * après confirmation d'une autre (demi concurrente sur zone encore libre = conservée).
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
    `SELECT id, creneau_id, terrain_id, date, heure_debut, heure_fin, format_terrain, zone
     FROM reservations
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
    const format = normalizeFormat(loser.format_terrain || 'entier');
    const encorePossible = peutReserver(
      format,
      database,
      loser.terrain_id,
      loser.date,
      loser.heure_debut,
      loser.heure_fin,
      { excludeReservationId: loser.id },
    );
    if (encorePossible) continue;

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

/**
 * Contrôle atomique capacité + attribution zone + sync créneaux.
 * À appeler dans une transaction, réservation encore en attente (exclure self).
 * @returns {{ ok: true, zone: string } | { ok: false, reason: string }}
 */
function confirmerAvecCapacite(database, reservation) {
  if (!reservation?.id || !reservation?.terrain_id) {
    return { ok: false, reason: 'reservation_invalide' };
  }
  const format = normalizeFormat(reservation.format_terrain || 'entier');
  const opts = { excludeReservationId: reservation.id };
  if (
    !peutReserver(
      format,
      database,
      reservation.terrain_id,
      reservation.date,
      reservation.heure_debut,
      reservation.heure_fin,
      opts,
    )
  ) {
    return { ok: false, reason: 'capacite_insuffisante' };
  }
  const zone = attribuerZone(
    format,
    database,
    reservation.terrain_id,
    reservation.date,
    reservation.heure_debut,
    reservation.heure_fin,
    opts,
  );
  if (!zone) return { ok: false, reason: 'capacite_insuffisante' };

  database.run('UPDATE reservations SET zone = ? WHERE id = ?', [zone, reservation.id]);
  const withZone = { ...reservation, zone, format_terrain: format };
  confirmerCreneauxReservation(database, withZone);
  annulerReservationsConcurrentes(database, withZone);
  return { ok: true, zone };
}

/**
 * Émet SSE capacité (partiel / complet / libéré) pour un intervalle.
 */
function emettreEtatCreneau(terrainId, etat, extra = {}) {
  try {
    const eventType =
      etat.etat === 'complet'
        ? 'creneau_complet'
        : etat.etat === 'partiel'
          ? 'creneau_partiel'
          : 'creneau_libere';
    require('./services/sseManager').emettrePourTerrain(terrainId, eventType, {
      etat: etat.etat,
      zones_libres: etat.zones_libres,
      zones_occupees: etat.zones_occupees,
      ...extra,
    });
  } catch {
    // best-effort
  }
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
  confirmerAvecCapacite,
  annulerReservationsConcurrentes,
  emettreEtatCreneau,
  conflictError,
};
