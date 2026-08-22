const { queryAll, queryOne, runSql } = require('../database');

async function logPhotoAction(database, { terrain_id, photo_id, action, fait_par, role, detail }) {
  await runSql(
    database,
    `INSERT INTO audit_photos (terrain_id, photo_id, action, fait_par, role_fait_par, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      terrain_id || null,
      photo_id || null,
      action,
      fait_par || null,
      role || null,
      detail || null,
    ],
  );
}

async function listAuditPhotos(database, { terrain_id, role, action, depuis, jusqua, limit = 200, offset = 0 } = {}) {
  let sql = `SELECT a.*, t.nom AS terrain_nom, p.url AS photo_url, p.nom_fichier AS photo_nom
    FROM audit_photos a
    LEFT JOIN terrains t ON t.id = a.terrain_id
    LEFT JOIN terrain_photos p ON p.id = a.photo_id
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

async function nomActeur(database, id, role) {
  if (!id) return '—';
  if (role === 'gerant') {
    const e = await queryOne(database, 'SELECT nom, prenom FROM employes WHERE id = ?', [id]);
    return e ? [e.prenom, e.nom].filter(Boolean).join(' ').trim() || e.nom : 'Gérant';
  }
  const u = await queryOne(database, 'SELECT nom, prenom FROM users WHERE id = ?', [id]);
  return u ? [u.prenom, u.nom].filter(Boolean).join(' ').trim() || u.nom : 'Super Admin';
}

module.exports = { logPhotoAction, listAuditPhotos, nomActeur };
