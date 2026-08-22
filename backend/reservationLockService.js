const { queryAll, queryOne, runSql, rowsModified } = require('./database');
const {
  parseHour,
  formatHour,
  normalizeHourString,
  hourlySlots,
} = require('./scheduleService');
const { dureeMinutesOf, hhmm } = require('./services/creneauService');

/** Délai par défaut : créneau indisponible en attendant le paiement joueur. */
const DEFAULT_DELAI_VERROU_PAIEMENT_MIN = 15;

function conflictError(message = 'Créneau déjà réservé') {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = 'CRENEAU_CONFLIT';
  return error;
}

const STATUTS_CONFIRMÉS = ['confirme', 'acceptee'];

function normaliserDelaiVerrouPaiementMin(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DELAI_VERROU_PAIEMENT_MIN;
  if (n > 120) return 120;
  return Math.round(n);
}

function delaiVerrouMs(terrainOrMinutes) {
  if (terrainOrMinutes != null && typeof terrainOrMinutes === 'object') {
    return normaliserDelaiVerrouPaiementMin(terrainOrMinutes.delai_verrou_paiement_min) * 60 * 1000;
  }
  return normaliserDelaiVerrouPaiementMin(terrainOrMinutes) * 60 * 1000;
}

/**
 * Annule les résas en_attente dont le verrou paiement a expiré et libère le créneau.
 * @returns {Promise<Array<{id:number,terrain_id:number,date:string}>>}
 */
async function libererVerrousPaiementExpires(database, nowMs = Date.now()) {
  const expired = await queryAll(
    database,
    `SELECT r.id, r.creneau_id, r.terrain_id, r.date, r.heure_debut, r.heure_fin
     FROM reservations r
     WHERE r.statut = 'en_attente'
       AND r.verrou_expire_at IS NOT NULL
       AND r.verrou_expire_at < ?`,
    [nowMs],
  );
  const liberated = [];
  for (const reservation of expired) {
    const upd = await runSql(
      database,
      "UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut = 'en_attente'",
      [reservation.id],
    );
    if (upd.changes === 1) {
      await libererCreneauxReservation(database, reservation, ['en_attente_paiement']);
      liberated.push({
        id: reservation.id,
        terrain_id: reservation.terrain_id,
        date: reservation.date,
      });
    }
  }
  return liberated;
}

function overlappingConfirmedSql() {
  return `SELECT id FROM reservations
      WHERE terrain_id = ? AND date = ?
        AND statut IN ('confirme', 'acceptee')
        AND substr(CAST(heure_debut AS TEXT), 1, 5) < ?
        AND substr(CAST(heure_fin AS TEXT), 1, 5) > ?`;
}

/**
 * Une réservation = une seule ligne creneaux (plage complète).
 */
async function getOrCreateRangeCreneau(database, terrainId, date, heureDebut, heureFin) {
  const debut = hhmm(heureDebut);
  const fin = hhmm(heureFin);
  let creneau = await queryOne(
    database,
    'SELECT * FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?',
    [terrainId, date, debut, fin],
  );
  if (!creneau) {
    await runSql(
      database,
      'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)',
      [terrainId, date, debut, fin, 'libre'],
    );
    creneau = await queryOne(
      database,
      'SELECT * FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ? ORDER BY id DESC',
      [terrainId, date, debut, fin],
    );
  }
  return creneau;
}

/** @deprecated alias — préférer getOrCreateRangeCreneau */
async function getOrCreateHourlyCreneau(database, terrainId, date, heureDebut, heureFin) {
  return getOrCreateRangeCreneau(database, terrainId, date, heureDebut, heureFin);
}

/**
 * Prépare le créneau d'une plage (1 ligne, durée quelconque).
 * À appeler uniquement à l'intérieur de transaction().
 *
 * occupy=false : créneau reste libre (plusieurs en_attente possibles).
 * occupy=true  : verrouille en_attente_paiement.
 *
 * @returns {number} creneau_id
 */
async function lockCreneauxAtomique(database, terrainId, date, heureDebut, heureFin, options = {}) {
  const occupy = Boolean(options.occupy);
  const debut = normalizeHourString(heureDebut) || hhmm(heureDebut);
  const fin = normalizeHourString(heureFin) || hhmm(heureFin);
  const duree = dureeMinutesOf(debut, fin);
  if (!(duree > 0)) throw conflictError('Créneau invalide');

  // Libérer d'abord les holds expirés pour éviter un faux conflit
  await libererVerrousPaiementExpires(database);

  const chevauchementResa = await queryAll(
    database,
    overlappingConfirmedSql(),
    [terrainId, date, fin, debut],
  );
  if (chevauchementResa.length) throw conflictError();

  const blocages = await queryAll(
    database,
    `SELECT id FROM blocages_creneaux
      WHERE terrain_id = ? AND date = ?
        AND substr(CAST(heure_debut AS TEXT), 1, 5) < ?
        AND substr(CAST(heure_fin AS TEXT), 1, 5) > ?`,
    [terrainId, date, fin, debut],
  );
  if (blocages.length) {
    throw conflictError('Créneau bloqué par le gérant');
  }

  const chevauchementCreneau = await queryAll(
    database,
    `SELECT id FROM creneaux
      WHERE terrain_id = ? AND date = ?
        AND statut IN ('reserve', 'bloque', 'tournoi', 'abonnement')
        AND substr(CAST(heure_debut AS TEXT), 1, 5) < ?
        AND substr(CAST(heure_fin AS TEXT), 1, 5) > ?`,
    [terrainId, date, fin, debut],
  );
  if (chevauchementCreneau.length) throw conflictError();

  const nowMs = Date.now();
  // Hold paiement encore actif = indisponible (joueur + gérant)
  const pendingActif = await queryAll(
    database,
    `SELECT id FROM reservations
      WHERE terrain_id = ? AND date = ?
        AND statut = 'en_attente'
        AND (verrou_expire_at IS NULL OR verrou_expire_at > ?)
        AND substr(CAST(heure_debut AS TEXT), 1, 5) < ?
        AND substr(CAST(heure_fin AS TEXT), 1, 5) > ?`,
    [terrainId, date, nowMs, fin, debut],
  );
  if (pendingActif.length) throw conflictError('Créneau en attente de confirmation paiement');

  const pendingCreneaux = await queryAll(
    database,
    `SELECT id FROM creneaux
      WHERE terrain_id = ? AND date = ?
        AND statut = 'en_attente_paiement'
        AND substr(CAST(heure_debut AS TEXT), 1, 5) < ?
        AND substr(CAST(heure_fin AS TEXT), 1, 5) > ?`,
    [terrainId, date, fin, debut],
  );
  if (pendingCreneaux.length) throw conflictError('Créneau en attente de confirmation paiement');

  const creneau = await getOrCreateRangeCreneau(database, terrainId, date, debut, fin);
  if (occupy) {
    const upd = await runSql(
      database,
      "UPDATE creneaux SET statut = 'en_attente_paiement' WHERE id = ? AND statut IN ('libre', 'en_attente_paiement')",
      [creneau.id],
    );
    if (upd.changes !== 1 && creneau.statut !== 'en_attente_paiement') {
      throw conflictError();
    }
  }

  return creneau.id;
}

async function libererCreneauxReservation(database, reservation, statuts = ['en_attente_paiement', 'reserve']) {
  if (!reservation) return;
  const statutList = statuts.map((s) => `'${s}'`).join(', ');
  const debut = hhmm(reservation.heure_debut);
  const fin = hhmm(reservation.heure_fin);

  if (reservation.creneau_id) {
    await runSql(
      database,
      `UPDATE creneaux SET statut = 'libre' WHERE id = ? AND statut IN (${statutList})`,
      [reservation.creneau_id],
    );
  }

  await runSql(
    database,
    `UPDATE creneaux SET statut = 'libre'
      WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?
        AND statut IN (${statutList})`,
    [reservation.terrain_id, reservation.date, debut, fin],
  );

  // Compat héritage : anciennes résas découpées en slots 1h
  const slots = hourlySlots(debut, fin);
  if (slots.length > 1) {
    for (const slot of slots) {
      await runSql(
        database,
        `UPDATE creneaux SET statut = 'libre'
          WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?
            AND statut IN (${statutList})`,
        [reservation.terrain_id, reservation.date, slot.heure_debut, slot.heure_fin],
      );
    }
  }
}

async function confirmerCreneauxReservation(database, reservation) {
  const other = await queryOne(
    database,
    `${overlappingConfirmedSql()} AND id != ?`,
    [reservation.terrain_id, reservation.date, hhmm(reservation.heure_fin), hhmm(reservation.heure_debut), reservation.id],
  );
  if (other) return 0;

  const debut = hhmm(reservation.heure_debut);
  const fin = hhmm(reservation.heure_fin);
  let confirmed = 0;

  if (reservation.creneau_id) {
    const upd = await runSql(
      database,
      "UPDATE creneaux SET statut = 'reserve' WHERE id = ? AND statut IN ('libre', 'en_attente_paiement', 'reserve')",
      [reservation.creneau_id],
    );
    confirmed += upd.changes;
  }

  const updRange = await runSql(
    database,
    `UPDATE creneaux SET statut = 'reserve'
      WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?
        AND statut IN ('libre', 'en_attente_paiement', 'reserve')`,
    [reservation.terrain_id, reservation.date, debut, fin],
  );
  confirmed += updRange.changes;

  // Compat : si ancienne résa multi-slots, confirmer aussi les atomes 1h
  const slots = hourlySlots(debut, fin);
  if (slots.length > 1 && confirmed === 0) {
    for (const slot of slots) {
      const upd = await runSql(
        database,
        `UPDATE creneaux SET statut = 'reserve'
          WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?
            AND statut IN ('libre', 'en_attente_paiement')`,
        [reservation.terrain_id, reservation.date, slot.heure_debut, slot.heure_fin],
      );
      confirmed += upd.changes;
    }
  }

  // S'assurer qu'une ligne plage complète existe et est réservée
  if (confirmed === 0) {
    const created = await getOrCreateRangeCreneau(
      database,
      reservation.terrain_id,
      reservation.date,
      debut,
      fin,
    );
    const upd = await runSql(
      database,
      "UPDATE creneaux SET statut = 'reserve' WHERE id = ?",
      [created.id],
    );
    confirmed += upd.changes;
  }

  return confirmed;
}

/**
 * Annule les autres réservations en_attente sur le même créneau.
 */
async function annulerReservationsConcurrentes(database, winner) {
  if (!winner) return [];
  const losers = await queryAll(
    database,
    `SELECT id FROM reservations
      WHERE terrain_id = ? AND date = ?
        AND statut = 'en_attente'
        AND id != ?
        AND substr(CAST(heure_debut AS TEXT), 1, 5) < ?
        AND substr(CAST(heure_fin AS TEXT), 1, 5) > ?`,
    [winner.terrain_id, winner.date, winner.id, hhmm(winner.heure_fin), hhmm(winner.heure_debut)],
  );
  const ids = [];
  for (const loser of losers) {
    const upd = await runSql(
      database,
      "UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut = 'en_attente'",
      [loser.id],
    );
    if (upd.changes === 1) ids.push(loser.id);
  }
  return ids;
}

module.exports = {
  parseHour,
  formatHour,
  normalizeHourString,
  hourlySlots,
  rowsModified,
  lockCreneauxAtomique,
  libererCreneauxReservation,
  confirmerCreneauxReservation,
  annulerReservationsConcurrentes,
  libererVerrousPaiementExpires,
  normaliserDelaiVerrouPaiementMin,
  delaiVerrouMs,
  DEFAULT_DELAI_VERROU_PAIEMENT_MIN,
  conflictError,
  STATUTS_CONFIRMÉS,
  getOrCreateRangeCreneau,
  getOrCreateHourlyCreneau,
};
