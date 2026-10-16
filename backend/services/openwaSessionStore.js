const { queryOne, queryAll, runSql } = require('../database');

function sauver(db, { sessionKey, openwaId = null, status = 'down', lastQr = null, lastError = null }) {
  const key = String(sessionKey || '').trim();
  if (!key) {
    const error = new Error('session_key requis');
    error.statusCode = 400;
    throw error;
  }
  const existing = queryOne(db, 'SELECT session_key FROM openwa_sessions WHERE session_key = ?', [key]);
  if (existing) {
    runSql(
      db,
      `UPDATE openwa_sessions
         SET openwa_id = ?, status = ?, last_qr = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
       WHERE session_key = ?`,
      [openwaId, status, lastQr, lastError, key],
    );
  } else {
    runSql(
      db,
      `INSERT INTO openwa_sessions (session_key, openwa_id, status, last_qr, last_error)
       VALUES (?, ?, ?, ?, ?)`,
      [key, openwaId, status, lastQr, lastError],
    );
  }
  return lire(db, key);
}

function lire(db, sessionKey) {
  return queryOne(db, 'SELECT * FROM openwa_sessions WHERE session_key = ?', [sessionKey]);
}

function lister(db) {
  return queryAll(db, 'SELECT * FROM openwa_sessions ORDER BY session_key');
}

/**
 * Relecture après redémarrage : la Map mémoire est vide, la table fait foi.
 * health(openwaId) → boolean.
 */
async function restaurer(db, health) {
  const rows = lister(db);
  const out = [];
  for (const row of rows) {
    if (!row.openwa_id) {
      out.push({ ...row, connected: false });
      continue;
    }
    let ok = false;
    try {
      ok = Boolean(await health(row.openwa_id));
    } catch (error) {
      ok = false;
      sauver(db, {
        sessionKey: row.session_key,
        openwaId: row.openwa_id,
        status: 'down',
        lastError: error.message,
      });
    }
    if (ok && row.status !== 'ready') {
      sauver(db, { sessionKey: row.session_key, openwaId: row.openwa_id, status: 'ready', lastError: null });
    }
    if (!ok && row.status === 'ready') {
      sauver(db, { sessionKey: row.session_key, openwaId: row.openwa_id, status: 'down', lastError: 'healthcheck down' });
    }
    out.push({ ...lire(db, row.session_key), connected: ok });
  }
  return out;
}

module.exports = { sauver, lire, lister, restaurer };
