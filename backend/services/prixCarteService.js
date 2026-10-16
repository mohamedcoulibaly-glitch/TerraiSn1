const { queryOne, runSql } = require('../database');
const { normaliserSourcePrixCarte, resoudrePrixAffiche } = require('../domain/prixCarte');
const { publierConfig } = require('./configVersion');
const { notifyTerrain } = require('../realtimeHub');

function lirePrixAffiche(terrain) {
  return resoudrePrixAffiche({
    source: terrain?.prix_carte_source || 'demi',
    prixDemi: terrain?.prix_moitie,
    prixEntier: terrain?.prix_entier ?? terrain?.prix_heure,
    prixHeure: terrain?.prix_heure,
  });
}

function appliquerPrixCarte(db, terrainId, source) {
  const normalise = normaliserSourcePrixCarte(source);
  const terrain = queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) {
    const error = new Error('Terrain introuvable');
    error.statusCode = 404;
    throw error;
  }
  runSql(db, 'UPDATE terrains SET prix_carte_source = ? WHERE id = ?', [normalise, terrainId]);
  const version = publierConfig(db, terrainId, { prix_carte_source: normalise });
  notifyTerrain(terrainId, 'tarifs', { prix_carte_source: normalise, version });
  const row = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  return { ...lirePrixAffiche(row), config_version: version };
}

module.exports = { lirePrixAffiche, appliquerPrixCarte };
