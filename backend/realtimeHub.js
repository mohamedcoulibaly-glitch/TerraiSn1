/**
 * Hub SSE léger : diffusion d’événements terrain → clients (gérant / joueur).
 * Pas de dépendance externe (Express + text/event-stream).
 */

/** @type {Map<number, Set<import('http').ServerResponse>>} */
const clientsByTerrain = new Map();

function terrainKey(terrainId) {
  return Number(terrainId) || 0;
}

function subscribe(terrainId, res) {
  const key = terrainKey(terrainId);
  if (!key) return () => {};
  let set = clientsByTerrain.get(key);
  if (!set) {
    set = new Set();
    clientsByTerrain.set(key, set);
  }
  set.add(res);
  return () => {
    set.delete(res);
    if (set.size === 0) clientsByTerrain.delete(key);
  };
}

/**
 * @param {number|string} terrainId
 * @param {string} type  horaires | blocage | reservation | tarifs | planning | statut | sante | encaissement | photos
 * @param {Record<string, unknown>} [payload]
 */
function notifyTerrain(terrainId, type, payload = {}) {
  const key = terrainKey(terrainId);
  if (!key) return;
  const set = clientsByTerrain.get(key);
  if (!set || set.size === 0) return;

  const body = JSON.stringify({
    type: String(type || 'planning'),
    terrain_id: key,
    at: new Date().toISOString(),
    ...payload,
  });
  const chunk = `event: terrain\ndata: ${body}\n\n`;

  for (const res of [...set]) {
    try {
      if (res.writableEnded) {
        set.delete(res);
        continue;
      }
      res.write(chunk);
    } catch {
      set.delete(res);
    }
  }
  if (set.size === 0) clientsByTerrain.delete(key);
}

function mountTerrainEvents(app) {
  app.get('/api/terrains/:id/events', (req, res) => {
    const terrainId = Number(req.params.id);
    if (!Number.isFinite(terrainId) || terrainId <= 0) {
      return res.status(400).json({ error: 'Terrain invalide' });
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    res.write(`event: connected\ndata: ${JSON.stringify({ terrain_id: terrainId })}\n\n`);

    const unsubscribe = subscribe(terrainId, res);
    const heartbeat = setInterval(() => {
      try {
        if (!res.writableEnded) res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
        unsubscribe();
      }
    }, 25000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on('close', cleanup);
    req.on('aborted', cleanup);
  });
}

module.exports = {
  subscribe,
  notifyTerrain,
  mountTerrainEvents,
};
