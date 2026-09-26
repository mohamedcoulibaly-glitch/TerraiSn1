/**
 * Favoris terrains (compte joueur) — multi-appareils.
 */
const { getDb, queryAll, queryOne, runSql } = require('./database');

async function listerIds(userId) {
  const db = await getDb();
  const rows = queryAll(
    db,
    'SELECT terrain_id FROM user_favoris WHERE user_id = ? ORDER BY created_at DESC',
    [Number(userId)],
  );
  return rows.map((r) => Number(r.terrain_id));
}

async function estFavori(userId, terrainId) {
  const db = await getDb();
  const row = queryOne(
    db,
    'SELECT 1 AS ok FROM user_favoris WHERE user_id = ? AND terrain_id = ? LIMIT 1',
    [Number(userId), Number(terrainId)],
  );
  return Boolean(row);
}

async function ajouter(userId, terrainId) {
  const db = await getDb();
  const terrain = queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [Number(terrainId)]);
  if (!terrain) {
    const err = new Error('Terrain introuvable');
    err.statusCode = 404;
    throw err;
  }
  runSql(
    db,
    `INSERT OR IGNORE INTO user_favoris (user_id, terrain_id) VALUES (?, ?)`,
    [Number(userId), Number(terrainId)],
  );
  return { favori: true, terrain_id: Number(terrainId) };
}

async function retirer(userId, terrainId) {
  const db = await getDb();
  runSql(
    db,
    'DELETE FROM user_favoris WHERE user_id = ? AND terrain_id = ?',
    [Number(userId), Number(terrainId)],
  );
  return { favori: false, terrain_id: Number(terrainId) };
}

async function basculer(userId, terrainId) {
  if (await estFavori(userId, terrainId)) {
    return retirer(userId, terrainId);
  }
  return ajouter(userId, terrainId);
}

/** Importe des IDs locaux (localStorage) vers le compte sans doublon. */
async function synchroniser(userId, terrainIds = []) {
  const db = await getDb();
  const ids = [...new Set(
    (Array.isArray(terrainIds) ? terrainIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0),
  )];
  for (const terrainId of ids) {
    const exists = queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [terrainId]);
    if (!exists) continue;
    runSql(
      db,
      'INSERT OR IGNORE INTO user_favoris (user_id, terrain_id) VALUES (?, ?)',
      [Number(userId), terrainId],
    );
  }
  return { ids: await listerIds(userId) };
}

module.exports = {
  listerIds,
  estFavori,
  ajouter,
  retirer,
  basculer,
  synchroniser,
};
