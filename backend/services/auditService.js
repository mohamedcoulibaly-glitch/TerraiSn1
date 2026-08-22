const { getDb, runSql } = require('../database');

const ACTIONS = new Set([
  'reservation_creee',
  'reservation_annulee',
  'qr_scanne',
  'kanban_stage',
  'creneau_cree',
  'creneau_supprime',
]);

function serializeDetails(details) {
  if (!details) return null;
  return JSON.stringify(details);
}

async function logActivite({ gerant_id, terrain_id, action, reservation_id = null, details = null }) {
  if (!ACTIONS.has(action)) {
    throw new Error(`Action activite gerant invalide: ${action}`);
  }
  if (!gerant_id || !terrain_id) return null;

  const db = await getDb();
  return await runSql(db, `
    INSERT INTO activite_gerant
      (gerant_id, terrain_id, action, reservation_id, details)
    VALUES (?, ?, ?, ?, ?)
  `, [
    Number(gerant_id),
    Number(terrain_id),
    action,
    reservation_id ? Number(reservation_id) : null,
    serializeDetails(details),
  ]);
}

module.exports = { logActivite };
