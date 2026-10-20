/**
 * Gestionnaire centralisé des connexions SSE gérants.
 *
 * Deux canaux de diffusion :
 *  1. Clients authentifiés de `GET /api/gerant/stream` — événements NOMMÉS
 *     (`event: reservation_confirmee`, data JSON) consommés par `useGerantStream`.
 *  2. Hub terrain historique (`realtimeHub.notifyTerrain`, route publique
 *     `/api/terrains/:id/events`) — événement générique `terrain` avec `type`
 *     dans le payload, consommé par `useTerrainEvents` (joueur + pro).
 *
 * `emettrePourTerrain` alimente les deux : aucun consommateur existant
 * n'est cassé, et le canal gérant reçoit des événements typés.
 */

const realtimeHub = require('../realtimeHub');

/** gerant_id → Set<ServerResponse> */
const clients = new Map();
/** terrain_id → Set<gerant_id> */
const terrainAbonnements = new Map();
/** ServerResponse → Set<terrain_id> (pour nettoyage fin) */
const terrainsParConnexion = new Map();

function ajouterClient(gerant_id, terrain_ids, res) {
  const gid = Number(gerant_id);
  if (!gid || !res) return;
  if (!clients.has(gid)) clients.set(gid, new Set());
  clients.get(gid).add(res);

  const tids = [...new Set((terrain_ids || []).map(Number).filter((n) => n > 0))];
  terrainsParConnexion.set(res, new Set(tids));
  tids.forEach((tid) => {
    if (!terrainAbonnements.has(tid)) terrainAbonnements.set(tid, new Set());
    terrainAbonnements.get(tid).add(gid);
  });

  console.log(`[SSE] Gérant ${gid} connecté (${clients.get(gid).size} connexion(s), terrains: ${tids.join(',') || 'aucun'})`);
}

function retirerClient(gerant_id, res) {
  const gid = Number(gerant_id);
  const connexions = clients.get(gid);
  if (connexions) {
    connexions.delete(res);
    if (connexions.size === 0) clients.delete(gid);
  }
  // Retirer l'abonnement terrain seulement si le gérant n'a plus aucune connexion dessus
  const tids = terrainsParConnexion.get(res);
  terrainsParConnexion.delete(res);
  if (tids && !clients.has(gid)) {
    tids.forEach((tid) => {
      const set = terrainAbonnements.get(tid);
      if (set) {
        set.delete(gid);
        if (set.size === 0) terrainAbonnements.delete(tid);
      }
    });
  }
}

/**
 * Émettre un événement à tous les gérants d'un terrain (+ hub terrain public).
 * @param {number|string} terrain_id
 * @param {string} type reservation_confirmee | creneau_libere | reservation_creee |
 *                      creneau_verrouille | match_valide | reservation_annulee
 * @param {object} data
 */
function emettrePourTerrain(terrain_id, type, data = {}) {
  const tid = Number(terrain_id);
  if (!tid || !type) return;

  // Canal historique (joueur + pro via useTerrainEvents) — ne jamais casser
  try {
    realtimeHub.notifyTerrain(tid, type, data);
  } catch {
    // best-effort
  }

  const gerantIds = terrainAbonnements.get(tid);
  if (!gerantIds || gerantIds.size === 0) return;

  const payload = `event: ${type}\ndata: ${JSON.stringify({ terrain_id: tid, ...data })}\n\n`;
  gerantIds.forEach((gerant_id) => {
    const connexions = clients.get(gerant_id);
    if (!connexions) return;
    connexions.forEach((res) => {
      try {
        if (res.writableEnded) {
          connexions.delete(res);
          return;
        }
        res.write(payload);
      } catch {
        connexions.delete(res);
      }
    });
    if (connexions.size === 0) clients.delete(gerant_id);
  });
}

module.exports = { ajouterClient, retirerClient, emettrePourTerrain };
