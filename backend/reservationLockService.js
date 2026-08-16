const { queryAll, queryOne } = require('./database');
const {
  parseHour,
  formatHour,
  normalizeHourString,
  hourlySlots,
} = require('./scheduleService');

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
function lockCreneauxAtomique(database, terrainId, date, heureDebut, heureFin) {
  const slots = hourlySlots(heureDebut, heureFin);
  if (!slots.length) throw conflictError('Créneau invalide');

  const chevauchementResa = queryAll(
    database,
    `SELECT id FROM reservations
      WHERE terrain_id = ? AND date = ?
        AND statut IN ('en_attente', 'confirme', 'acceptee')
        AND heure_debut < ? AND heure_fin > ?`,
    [terrainId, date, heureFin, heureDebut],
  );
  if (chevauchementResa.length) throw conflictError();

  const chevauchementCreneau = queryAll(
    database,
    `SELECT id FROM creneaux
      WHERE terrain_id = ? AND date = ?
        AND statut != 'libre'
        AND heure_debut < ? AND heure_fin > ?`,
    [terrainId, date, heureFin, heureDebut],
  );
  if (chevauchementCreneau.length) throw conflictError();

  const blocages = queryAll(
    database,
    `SELECT id FROM blocages_creneaux
      WHERE terrain_id = ? AND date = ?
        AND heure_debut < ? AND heure_fin > ?`,
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

module.exports = {
  parseHour,
  formatHour,
  normalizeHourString,
  hourlySlots,
  rowsModified,
  lockCreneauxAtomique,
  libererCreneauxReservation,
  confirmerCreneauxReservation,
  conflictError,
};
