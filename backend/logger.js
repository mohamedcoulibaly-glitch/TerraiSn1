/**
 * Logger + compteurs d'observabilité légers (sans APM cloud).
 * Format JSON optionnel via LOG_JSON=1.
 */

const counters = Object.create(null);

function metric(name, delta = 1) {
  const key = String(name || 'unknown');
  counters[key] = Number(counters[key] || 0) + Number(delta || 0);
  return counters[key];
}

function getMetrics() {
  return { ...counters };
}

function resetMetrics() {
  for (const key of Object.keys(counters)) delete counters[key];
}

function emit(level, file, message, meta) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    file,
    message: String(message || ''),
  };
  if (meta && typeof meta === 'object') {
    if (meta instanceof Error) {
      payload.error = meta.message;
      payload.stack = meta.stack;
    } else {
      Object.assign(payload, meta);
    }
  }

  const useJson = String(process.env.LOG_JSON || '').trim() === '1';
  if (useJson) {
    const line = JSON.stringify(payload);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    return;
  }

  const tag = level === 'error' ? 'ERREUR' : level === 'warn' ? 'WARN' : 'INFO';
  const detail = payload.error ? ` — ${payload.error}` : '';
  const line = `[${tag}][${file}] ${payload.message}${detail}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function error(file, message, err) {
  metric('log.error');
  if (err != null && !(err instanceof Error) && typeof err === 'object') {
    emit('error', file, message, err);
    return;
  }
  emit('error', file, message, err instanceof Error ? err : err != null ? new Error(String(err)) : undefined);
}

function warn(file, message, meta) {
  metric('log.warn');
  emit('warn', file, message, meta);
}

function info(file, message, meta) {
  metric('log.info');
  emit('info', file, message, meta);
}

/** Enregistre un événement métier critique (paiement, résa, WA). */
function event(name, meta = {}) {
  metric(`event.${name}`);
  emit('info', 'event', name, meta);
}

module.exports = {
  error,
  warn,
  info,
  event,
  metric,
  getMetrics,
  resetMetrics,
};
