const { getDb, queryAll, queryOne, runSql } = require('../database');

const ACTIONS = new Set([
  'reservation_creee',
  'reservation_annulee',
  'qr_scanne',
  'validation_manuelle',
  'checkin_code',
  'kanban_stage',
  'creneau_cree',
  'creneau_supprime',
]);

/** Groupes UI propriétaire → actions activite_gerant existantes */
const TYPE_ACTIONS = {
  scan_qr: ['qr_scanne', 'checkin_code', 'validation_manuelle'],
  reservation: ['reservation_creee', 'reservation_annulee'],
  // Pas d'action « encaissement » / « session_* » en base aujourd'hui
  encaissement: [],
  session: [],
  creneau: ['creneau_cree', 'creneau_supprime', 'kanban_stage'],
};

function serializeDetails(details) {
  if (!details) return null;
  return JSON.stringify(details);
}

function parseDetails(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return { raw: String(raw) };
  }
}

function periodSinceYmd(periode) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (periode === 'semaine') {
    const from = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    return from.toISOString().slice(0, 10);
  }
  if (periode === 'mois') {
    return `${today.slice(0, 7)}-01`;
  }
  return today;
}

function detailLisible(action, details, reservation) {
  const d = parseDetails(details) || {};
  const joueur = d.joueur_nom || reservation?.joueur_nom || null;
  const code = d.code_reservation || reservation?.code_reservation || null;
  switch (action) {
    case 'qr_scanne':
      return joueur ? `Scan QR — ${joueur}` : 'QR scanné';
    case 'checkin_code':
      return code ? `Check-in code ${code}` : 'Check-in par code';
    case 'validation_manuelle':
      return joueur ? `Validation manuelle — ${joueur}` : 'Validation manuelle';
    case 'reservation_creee':
      return joueur ? `Réservation créée — ${joueur}` : 'Réservation créée';
    case 'reservation_annulee':
      return joueur ? `Réservation annulée — ${joueur}` : 'Réservation annulée';
    case 'creneau_cree':
      return 'Créneau créé';
    case 'creneau_supprime':
      return 'Créneau supprimé';
    case 'kanban_stage':
      return d.stage ? `Étape → ${d.stage}` : 'Mise à jour file d\'attente';
    default:
      return action;
  }
}

async function logActivite({ gerant_id, terrain_id, action, reservation_id = null, details = null }) {
  if (!ACTIONS.has(action)) {
    throw new Error(`Action activite gerant invalide: ${action}`);
  }
  if (!gerant_id || !terrain_id) return null;

  const db = await getDb();
  return runSql(db, `
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

/**
 * Feed d'activité pour le propriétaire — branché sur activite_gerant + employes.
 * Gardes = getGerantDeGarde logique via planning + sessions_gerant_actives (en ligne).
 */
async function listAuditProprietaire(proprietaire_id, { terrain_id = null, type = 'tout', periode = 'aujourd_hui', limit = 100 } = {}) {
  const db = await getDb();
  const pid = Number(proprietaire_id);
  const terrains = queryAll(
    db,
    'SELECT id, nom FROM terrains WHERE proprietaire_id = ? ORDER BY nom ASC',
    [pid],
  );
  const allIds = terrains.map((t) => Number(t.id));
  if (!allIds.length) {
    return { terrains: [], gardes: [], activites: [], periode, type: type || 'tout' };
  }

  let ids = allIds;
  if (terrain_id != null && String(terrain_id) !== 'tous' && String(terrain_id) !== '') {
    const tid = Number(terrain_id);
    if (!allIds.includes(tid)) {
      const err = new Error('Terrain non autorisé');
      err.statusCode = 403;
      throw err;
    }
    ids = [tid];
  }

  const since = periodSinceYmd(periode);
  const typeKey = String(type || 'tout');
  const actionList = typeKey !== 'tout' ? (TYPE_ACTIONS[typeKey] || null) : null;

  // Type sans actions connues → feed vide (ex. encaissement / session)
  if (actionList && actionList.length === 0) {
    return {
      terrains,
      gardes: await buildGardes(db, ids),
      activites: [],
      periode: periode || 'aujourd_hui',
      type: typeKey,
      depuis: since,
    };
  }

  const placeholders = ids.map(() => '?').join(',');
  const params = [...ids, since];
  let actionClause = '';
  if (actionList && actionList.length) {
    actionClause = ` AND ag.action IN (${actionList.map(() => '?').join(',')})`;
    params.push(...actionList);
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 300));

  const rows = queryAll(
    db,
    `SELECT ag.id, ag.action, ag.details, ag.created_at, ag.reservation_id,
            ag.gerant_id, ag.terrain_id,
            e.prenom AS gerant_prenom, e.nom AS gerant_nom,
            t.nom AS terrain_nom,
            r.joueur_nom, r.code_reservation, r.heure_debut, r.date AS reservation_date
     FROM activite_gerant ag
     JOIN terrains t ON t.id = ag.terrain_id
     LEFT JOIN employes e ON e.id = ag.gerant_id
     LEFT JOIN reservations r ON r.id = ag.reservation_id
     WHERE ag.terrain_id IN (${placeholders})
       AND date(ag.created_at) >= date(?)
       ${actionClause}
     ORDER BY ag.created_at DESC, ag.id DESC
     LIMIT ?`,
    params,
  );

  const activites = rows.map((row) => ({
    id: Number(row.id),
    action: row.action,
    detail: detailLisible(row.action, row.details, row),
    details: parseDetails(row.details),
    created_at: row.created_at,
    gerant_id: row.gerant_id != null ? Number(row.gerant_id) : null,
    gerant_prenom: row.gerant_prenom || null,
    gerant_nom: row.gerant_nom || null,
    terrain_id: Number(row.terrain_id),
    terrain_nom: row.terrain_nom || null,
    reservation_id: row.reservation_id != null ? Number(row.reservation_id) : null,
  }));

  return {
    terrains,
    gardes: await buildGardes(db, ids),
    activites,
    periode: periode || 'aujourd_hui',
    type: typeKey,
    depuis: since,
  };
}

async function buildGardes(db, terrainIds) {
  const { getGerantDeGarde } = require('./gerantService');
  const gardes = [];
  for (const tid of terrainIds) {
    const garde = await getGerantDeGarde(tid);
    if (!garde?.gerant_id) continue;
    const terrain = queryOne(db, 'SELECT nom FROM terrains WHERE id = ?', [tid]);
    const session = queryOne(
      db,
      `SELECT derniere_activite FROM sessions_gerant_actives
       WHERE terrain_id = ? AND gerant_id = ?
         AND derniere_activite >= datetime('now', '-90 seconds')
       LIMIT 1`,
      [tid, Number(garde.gerant_id)],
    );
    gardes.push({
      terrain_id: tid,
      terrain_nom: terrain?.nom || null,
      gerant_id: Number(garde.gerant_id),
      prenom: garde.prenom || null,
      nom: garde.nom || null,
      en_ligne: Boolean(session),
      derniere_activite: session?.derniere_activite || null,
    });
  }
  return gardes;
}

module.exports = {
  logActivite,
  listAuditProprietaire,
  ACTIONS,
  TYPE_ACTIONS,
};
