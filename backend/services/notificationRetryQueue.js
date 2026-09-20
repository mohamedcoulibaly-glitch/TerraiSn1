/**
 * File d'attente de rejeu pour les notifications WhatsApp en échec réseau.
 * Le paiement reste valide : seule la notif est rejouable (best-effort).
 *
 * Stockage : table `notification_retry_queue` (sql.js) + API mémoire pour les tests.
 */
const { getDb, queryOne, queryAll, runSql } = require('../database');

const STATUTS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  SENT: 'sent',
  DEAD: 'dead',
});

const MAX_TENTATIVES_DEFAUT = 5;

/** File mémoire (utilisée si DB indisponible ou en mode test forcé). */
const memoire = [];
let memSeq = 1;

function useMemoireSeule() {
  return String(process.env.WHATSAPP_RETRY_MEMORY || '').toLowerCase() === 'true';
}

/**
 * @param {object} job
 * @param {string} job.telephone
 * @param {string} job.message
 * @param {string} [job.session_key]
 * @param {string} [job.type]
 * @param {string} [job.destinataire_type]
 * @param {number} [job.destinataire_id]
 * @param {string} [job.erreur]
 * @param {number} [job.http_status]
 * @param {string} [job.idempotency_key] — évite de doubler le même job
 */
async function enfiler(job = {}) {
  if (!job.telephone || !job.message) {
    throw new Error('enfiler: telephone et message requis');
  }

  const row = {
    telephone: String(job.telephone),
    message: String(job.message),
    session_key: job.session_key || 'platform',
    type: job.type || 'message',
    destinataire_type: job.destinataire_type || null,
    destinataire_id: job.destinataire_id != null ? Number(job.destinataire_id) : null,
    erreur: job.erreur ? String(job.erreur).slice(0, 500) : null,
    http_status: job.http_status != null ? Number(job.http_status) : null,
    idempotency_key: job.idempotency_key || null,
    statut: STATUTS.PENDING,
    tentatives: 0,
    max_tentatives: Number(job.max_tentatives || MAX_TENTATIVES_DEFAUT),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (useMemoireSeule()) {
    if (row.idempotency_key) {
      const dup = memoire.find(
        (j) => j.idempotency_key === row.idempotency_key && j.statut === STATUTS.PENDING,
      );
      if (dup) return { id: dup.id, deduped: true };
    }
    const id = memSeq++;
    memoire.push({ id, ...row });
    return { id, deduped: false };
  }

  try {
    const db = await getDb();
    if (row.idempotency_key) {
      const dup = queryOne(
        db,
        `SELECT id FROM notification_retry_queue
         WHERE idempotency_key = ? AND statut = ? LIMIT 1`,
        [row.idempotency_key, STATUTS.PENDING],
      );
      if (dup) return { id: dup.id, deduped: true };
    }
    const result = runSql(
      db,
      `INSERT INTO notification_retry_queue (
        telephone, message, session_key, type, destinataire_type, destinataire_id,
        erreur, http_status, idempotency_key, statut, tentatives, max_tentatives
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        row.telephone,
        row.message,
        row.session_key,
        row.type,
        row.destinataire_type,
        row.destinataire_id,
        row.erreur,
        row.http_status,
        row.idempotency_key,
        STATUTS.PENDING,
        row.max_tentatives,
      ],
    );
    return { id: result.lastInsertRowid, deduped: false };
  } catch (error) {
    // Fallback mémoire si la table n'existe pas encore
    const id = memSeq++;
    memoire.push({ id, ...row });
    return { id, deduped: false, fallback: 'memory', error: error.message };
  }
}

async function listerPending(limit = 50) {
  if (useMemoireSeule()) {
    return memoire.filter((j) => j.statut === STATUTS.PENDING).slice(0, limit);
  }
  try {
    const db = await getDb();
    return queryAll(
      db,
      `SELECT * FROM notification_retry_queue
       WHERE statut = ?
       ORDER BY id ASC
       LIMIT ?`,
      [STATUTS.PENDING, limit],
    );
  } catch {
    return memoire.filter((j) => j.statut === STATUTS.PENDING).slice(0, limit);
  }
}

async function compterPending() {
  const rows = await listerPending(10000);
  return rows.length;
}

/**
 * Marque un job après tentative de rejeu.
 * @param {number} id
 * @param {'sent'|'retry'|'dead'} outcome
 * @param {string} [erreur]
 */
async function marquerResultat(id, outcome, erreur) {
  if (useMemoireSeule()) {
    const job = memoire.find((j) => j.id === Number(id));
    if (!job) return null;
    job.tentatives += 1;
    job.updated_at = new Date().toISOString();
    job.erreur = erreur ? String(erreur).slice(0, 500) : job.erreur;
    if (outcome === 'sent') job.statut = STATUTS.SENT;
    else if (outcome === 'dead' || job.tentatives >= job.max_tentatives) job.statut = STATUTS.DEAD;
    else job.statut = STATUTS.PENDING;
    return job;
  }

  const db = await getDb();
  const job = queryOne(db, 'SELECT * FROM notification_retry_queue WHERE id = ?', [id]);
  if (!job) return null;
  const tentatives = Number(job.tentatives || 0) + 1;
  let statut = STATUTS.PENDING;
  if (outcome === 'sent') statut = STATUTS.SENT;
  else if (outcome === 'dead' || tentatives >= Number(job.max_tentatives || MAX_TENTATIVES_DEFAUT)) {
    statut = STATUTS.DEAD;
  }
  runSql(
    db,
    `UPDATE notification_retry_queue
     SET statut = ?, tentatives = ?, erreur = COALESCE(?, erreur), updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [statut, tentatives, erreur || null, id],
  );
  return queryOne(db, 'SELECT * FROM notification_retry_queue WHERE id = ?', [id]);
}

/**
 * Rejoue les jobs pending via un sender injecté (testable).
 * @param {(job: object) => Promise<void>} sender
 */
async function rejouerPending(sender, { limit = 20 } = {}) {
  const jobs = await listerPending(limit);
  const results = [];
  for (const job of jobs) {
    try {
      await sender(job);
      await marquerResultat(job.id, 'sent');
      results.push({ id: job.id, ok: true });
    } catch (error) {
      const updated = await marquerResultat(job.id, 'retry', error.message);
      results.push({
        id: job.id,
        ok: false,
        dead: updated?.statut === STATUTS.DEAD,
        error: error.message,
      });
    }
  }
  return results;
}

/** Reset mémoire — réservé aux tests. */
function resetMemoire() {
  memoire.length = 0;
  memSeq = 1;
}

function snapshotMemoire() {
  return memoire.map((j) => ({ ...j }));
}

module.exports = {
  STATUTS,
  MAX_TENTATIVES_DEFAUT,
  enfiler,
  listerPending,
  compterPending,
  marquerResultat,
  rejouerPending,
  resetMemoire,
  snapshotMemoire,
};
