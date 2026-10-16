const MAX_WINDOW_MS = 60 * 60 * 1000;

function fenetreCourante(bucket) {
  const base = bucket.baseWindowMs;
  const factor = bucket.lockouts > 0 ? 2 ** bucket.lockouts : 1;
  return Math.min(base * factor, MAX_WINDOW_MS);
}

/**
 * Politique pure. `increment` false = on ne compte pas encore (échecs seulement).
 * Le lockout double la fenêtre au moment où le plafond est franchi, une fois par fenêtre.
 */
function evaluer(bucket, { now, windowMs, max, increment }) {
  const baseWindowMs = windowMs;
  let state = bucket
    ? { ...bucket, baseWindowMs: bucket.baseWindowMs || baseWindowMs }
    : { count: 0, resetAt: now + baseWindowMs, lockouts: 0, blocked: false, baseWindowMs };

  if (state.resetAt <= now) {
    const duree = fenetreCourante(state);
    state = {
      count: 0,
      resetAt: now + duree,
      lockouts: state.lockouts,
      blocked: false,
      baseWindowMs: state.baseWindowMs,
    };
  }

  if (state.count >= max) {
    if (!state.blocked) {
      state.lockouts += 1;
      state.blocked = true;
      state.resetAt = now + Math.min(state.baseWindowMs * (2 ** state.lockouts), MAX_WINDOW_MS);
    }
    return { limited: true, bucket: state };
  }

  if (increment) state.count += 1;
  return { limited: false, bucket: state };
}

function delaiApresBlocage(baseWindowMs, lockouts) {
  return Math.min(baseWindowMs * (2 ** lockouts), MAX_WINDOW_MS);
}

module.exports = {
  MAX_WINDOW_MS,
  evaluer,
  delaiApresBlocage,
  fenetreCourante,
};
