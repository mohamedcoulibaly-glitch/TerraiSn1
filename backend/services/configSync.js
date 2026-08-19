const { notifyTerrain } = require('../realtimeHub');

const TYPE_SSE = {
  photos: 'photos',
  tarifs_dynamiques: 'tarifs',
  contrat_paiement: 'tarifs',
  statut_terrain: 'statut',
  equipements: 'horaires',
};

/**
 * Après chaque modification de config superadmin :
 * notifie les clients SSE. Les GET relisent toujours la DB (pas de cache Redis).
 */
function syncApresModificationTerrain(terrainId, typeModification, extra = {}) {
  const type = TYPE_SSE[typeModification] || String(typeModification || 'planning');
  notifyTerrain(terrainId, type, {
    action: typeModification,
    ...extra,
  });
}

module.exports = { syncApresModificationTerrain };
