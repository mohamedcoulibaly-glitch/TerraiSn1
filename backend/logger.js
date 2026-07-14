function error(file, message, err) {
  const detail = err?.message || String(err || '');
  console.error(`[ERREUR][${file}] ${message} — ${detail}`);
}

function warn(file, message) {
  console.warn(`[WARN][${file}] ${message}`);
}

function info(file, message) {
  console.log(`[INFO][${file}] ${message}`);
}

module.exports = { error, warn, info };
