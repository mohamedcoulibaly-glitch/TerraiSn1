function error(file, message, err) {
  const detail = err?.message || String(err || '');
  console.error(`[ERREUR][${file}] ${message} — ${detail}`);
  try {
    const bugAlert = require('./services/bugAlertService');
    const errorObj = err instanceof Error ? err : new Error(detail || message);
    bugAlert
      .notify({
        kind: 'app_error',
        title: `${file}: ${message}`,
        error: errorObj,
        meta: { file },
      })
      .catch(() => {});
  } catch {
    /* éviter toute boucle d’alerte */
  }
}

function warn(file, message) {
  console.warn(`[WARN][${file}] ${message}`);
}

function info(file, message) {
  console.log(`[INFO][${file}] ${message}`);
}

module.exports = { error, warn, info };
