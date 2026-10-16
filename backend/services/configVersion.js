const { queryOne, runSql } = require('../database');
const { notifyTerrain } = require('../realtimeHub');

function bump(db, terrainId) {
  runSql(
    db,
    'UPDATE terrains SET config_version = COALESCE(config_version, 0) + 1 WHERE id = ?',
    [terrainId],
  );
  const row = queryOne(db, 'SELECT config_version FROM terrains WHERE id = ?', [terrainId]);
  return Number(row?.config_version || 0);
}

function publierConfig(db, terrainId, extra = {}) {
  const version = bump(db, terrainId);
  notifyTerrain(terrainId, 'config_updated', { version, ...extra });
  return version;
}

module.exports = { bump, publierConfig };
