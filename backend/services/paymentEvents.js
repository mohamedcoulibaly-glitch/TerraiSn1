/**
 * Ring buffer des événements paiement (checkout / IPN) — debug prod sans secrets.
 */
const MAX = 40;
const events = [];

function push(type, payload = {}) {
  const entry = {
    ts: new Date().toISOString(),
    type: String(type || 'unknown'),
    ...sanitize(payload),
  };
  events.unshift(entry);
  if (events.length > MAX) events.length = MAX;
  return entry;
}

function sanitize(payload) {
  const out = {};
  for (const [key, value] of Object.entries(payload || {})) {
    const k = String(key).toLowerCase();
    if (k.includes('secret') || k.includes('api_key') || k.includes('token') || k.includes('password')) {
      continue;
    }
    if (typeof value === 'string' && value.length > 240) {
      out[key] = `${value.slice(0, 240)}…`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function recent(limit = 20) {
  return events.slice(0, Math.max(1, Math.min(Number(limit) || 20, MAX)));
}

function clear() {
  events.length = 0;
}

module.exports = { push, recent, clear, MAX };
