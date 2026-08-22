const { queryAll, runSql } = require('../database');
const { nomActeur } = require('./auditPhotos');

async function logCommoditeAction(database, { terrain_id, commodite_id, action, fait_par, role, detail }) {
  await runSql(
    database,
    `INSERT INTO audit_commodites (terrain_id, commodite_id, action, fait_par, role_fait_par, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      terrain_id || null,
      commodite_id || null,
      action,
      fait_par || null,
      role || null,
      detail || null,
    ],
  );
}

async function listAuditCommodites(database, { terrain_id, role, action, depuis, jusqua, limit = 200, offset = 0 } = {}) {
  let sql = `SELECT a.*, t.nom AS terrain_nom, c.cle AS commodite_cle, c.label_fr AS commodite_label, c.icone AS commodite_icone
    FROM audit_commodites a
    LEFT JOIN terrains t ON t.id = a.terrain_id
    LEFT JOIN commodites c ON c.id = a.commodite_id
    WHERE 1=1`;
  const params = [];
  if (terrain_id) { sql += ' AND a.terrain_id = ?'; params.push(Number(terrain_id)); }
  if (role) { sql += ' AND a.role_fait_par = ?'; params.push(role); }
  if (action) { sql += ' AND a.action = ?'; params.push(action); }
  if (depuis) { sql += ' AND a.created_at >= ?'; params.push(depuis); }
  if (jusqua) { sql += ' AND a.created_at <= ?'; params.push(jusqua); }
  sql += ' ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  const rows = await queryAll(database, sql, params);
  const out = [];
  for (const row of rows) {
    out.push({
      ...row,
      fait_par_nom: await nomActeur(database, row.fait_par, row.role_fait_par),
    });
  }
  return out;
}

module.exports = { logCommoditeAction, listAuditCommodites };
