/**
 * Rate-limit in-memory (sans dépendance externe).
 * Actif en production, ou si AUTH_RATE_LIMIT=1 / RATE_LIMIT=1.
 */

const { evaluer } = require('../domain/rateLimitPolicy');

const buckets = new Map();

function rateLimitEnabled() {
  if (process.env.NODE_ENV === 'production') return true;
  if (String(process.env.AUTH_RATE_LIMIT || '').trim() === '1') return true;
  if (String(process.env.RATE_LIMIT || '').trim() === '1') return true;
  return false;
}

function buildKey(req, keyPrefix) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const rawId = String(req.body?.telephone || req.body?.identifier || req.body?.email || req.user?.id || '');
  const idKey = rawId.includes('@') ? rawId.trim().toLowerCase() : String(rawId).replace(/\D/g, '');
  return `${keyPrefix}:${ip}:${idKey}`;
}

/**
 * @param {{ windowMs: number, max: number, keyPrefix: string, countFailuresOnly?: boolean }} opts
 */
function rateLimit({ windowMs, max, keyPrefix, countFailuresOnly = false, onLimited = null }) {
  return (req, res, next) => {
    if (!rateLimitEnabled()) return next();

    const key = buildKey(req, keyPrefix);
    const now = Date.now();
    const current = buckets.get(key) || null;

    if (!countFailuresOnly) {
      const decision = evaluer(current, { now, windowMs, max, increment: true });
      buckets.set(key, decision.bucket);
      if (decision.limited) {
        if (typeof onLimited === 'function') {
          Promise.resolve(onLimited(req, keyPrefix)).catch(() => {});
        }
        return res.status(429).json({ error: 'Trop de tentatives. Veuillez reessayer plus tard.' });
      }
      return next();
    }

    const peek = evaluer(current, { now, windowMs, max, increment: false });
    buckets.set(key, peek.bucket);
    if (peek.limited) {
      if (typeof onLimited === 'function') {
        Promise.resolve(onLimited(req, keyPrefix)).catch(() => {});
      }
      return res.status(429).json({ error: 'Trop de tentatives. Veuillez reessayer plus tard.' });
    }
    res.on('finish', () => {
      const live = buckets.get(key) || peek.bucket;
      if (res.statusCode === 401 || res.statusCode === 403) {
        const decision = evaluer(live, { now: Date.now(), windowMs, max, increment: true });
        buckets.set(key, decision.bucket);
      } else if (res.statusCode < 400) {
        buckets.delete(key);
      }
    });
    return next();
  };
}

/** Reset buckets — tests unitaires uniquement. */
function _resetRateLimitBuckets() {
  buckets.clear();
}

function _bucketSize() {
  return buckets.size;
}

module.exports = {
  rateLimit,
  rateLimitEnabled,
  buildKey,
  _resetRateLimitBuckets,
  _bucketSize,
};
