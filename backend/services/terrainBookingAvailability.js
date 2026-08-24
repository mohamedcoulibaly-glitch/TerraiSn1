/**
 * Disponibilité réservation en ligne d'un terrain selon la session WhatsApp du gérant.
 * Si le gérant est déconnecté → en_ligne_indisponible (le joueur doit appeler).
 *
 * Important : utilise getStatusLite (mémoire) — jamais ensure/reconnect Baileys,
 * sinon les pages terrains/créneaux se bloquent.
 */
const { getGerantDeGarde, getGerantPrincipal } = require('./gerantService');

/** @type {Map<number, { at: number, value: object }>} */
const cache = new Map();
const CACHE_TTL_MS = 12_000;

function digitsPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('07')) d = d.slice(1);
  if (d.length === 9 && d.startsWith('7')) d = `221${d}`;
  return d || null;
}

function telHref(raw) {
  const d = digitsPhone(raw);
  if (!d) return null;
  return `tel:+${d}`;
}

function emptyAvailability(extra = {}) {
  return {
    en_ligne_indisponible: false,
    booking_online_available: true,
    whatsapp_status: null,
    gerant_id: null,
    gerant_telephone: null,
    gerant_tel_href: null,
    gerant_nom: null,
    message: null,
    ...extra,
  };
}

/**
 * @param {number|string} terrainId
 * @param {{ force?: boolean }} [opts]
 */
async function getTerrainBookingAvailability(terrainId, opts = {}) {
  const tid = Number(terrainId);
  if (!Number.isFinite(tid) || tid < 1) {
    return emptyAvailability();
  }

  if (!opts.force) {
    const hit = cache.get(tid);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  }

  if (String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true') {
    const value = emptyAvailability({ whatsapp_status: 'MOCK' });
    cache.set(tid, { at: Date.now(), value });
    return value;
  }

  let garde = null;
  try {
    garde = (await getGerantDeGarde(tid)) || (await getGerantPrincipal(tid));
  } catch {
    garde = null;
  }

  const gerantId = garde?.gerant_id ? Number(garde.gerant_id) : null;
  const phone = garde?.whatsapp_number || garde?.telephone || null;
  const gerantNom = [garde?.prenom, garde?.nom].filter(Boolean).join(' ').trim() || null;

  if (!gerantId) {
    const value = emptyAvailability({
      gerant_telephone: phone,
      gerant_tel_href: telHref(phone),
      gerant_nom: gerantNom,
    });
    cache.set(tid, { at: Date.now(), value });
    return value;
  }

  let status = { connected: false, status: 'DISCONNECTED' };
  try {
    const whatsappClient = require('../whatsappClient');
    const key = whatsappClient.gerantSessionKey(gerantId);
    // Lecture mémoire uniquement — ne jamais appeler getStatus() ici (ensure Baileys).
    status =
      typeof whatsappClient.getStatusLite === 'function'
        ? whatsappClient.getStatusLite(key)
        : await Promise.race([
            whatsappClient.getStatus(key),
            new Promise((resolve) =>
              setTimeout(() => resolve({ connected: false, status: 'DISCONNECTED' }), 800),
            ),
          ]);
  } catch {
    status = { connected: false, status: 'DISCONNECTED' };
  }

  const waStatus = String(status.status || (status.connected ? 'CONNECTED' : 'DISCONNECTED')).toUpperCase();
  const connected = Boolean(status.connected) || waStatus === 'CONNECTED';
  const connecting = waStatus === 'CONNECTING';
  // CONNECTING = appairage / reprise : on laisse réserver
  const indispo = !connected && !connecting;

  const value = {
    en_ligne_indisponible: indispo,
    booking_online_available: !indispo,
    whatsapp_status: waStatus,
    gerant_id: gerantId,
    gerant_telephone: phone,
    gerant_tel_href: telHref(phone),
    gerant_nom: gerantNom,
    message: indispo
      ? 'Réservation en ligne temporairement indisponible. Consulte les créneaux libres puis appelle le gérant pour réserver.'
      : null,
  };
  cache.set(tid, { at: Date.now(), value });
  return value;
}

function invalidateTerrainBookingCache(terrainId) {
  if (terrainId == null) {
    cache.clear();
    return;
  }
  cache.delete(Number(terrainId));
}

module.exports = {
  getTerrainBookingAvailability,
  invalidateTerrainBookingCache,
  digitsPhone,
  telHref,
};
