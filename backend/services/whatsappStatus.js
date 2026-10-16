const store = require('./openwaSessionStore');

/**
 * La base prime sur la mémoire. Un mock n'est jamais prêt pour la prod.
 */
function resoudreStatut({ dbRow = null, memoryReady = false, mock = false, hasApiKey = false } = {}) {
  const dbDown = dbRow && dbRow.status === 'down';
  const dbReady = dbRow && dbRow.status === 'ready';
  let connected = false;
  if (!mock) {
    if (dbDown) connected = false;
    else if (dbReady) connected = true;
    else connected = Boolean(memoryReady);
  }
  return {
    connected,
    mock: Boolean(mock),
    provider: 'openwa',
    status: dbRow?.status || (connected ? 'ready' : 'down'),
    session_key: dbRow?.session_key || 'platform',
    readyForProd: !mock && Boolean(hasApiKey) && connected,
    config: {
      hasApiKey: Boolean(hasApiKey),
      readyForProd: !mock && Boolean(hasApiKey) && connected,
    },
  };
}

function lireStatutPublic(db, memory = {}) {
  const row = store.lire(db, memory.session || memory.session_key || 'platform');
  return resoudreStatut({
    dbRow: row,
    memoryReady: Boolean(memory.connected || memory.ready),
    mock: Boolean(memory.mock) || String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true',
    hasApiKey: Boolean(String(process.env.OPENWA_API_KEY || '').trim()) || Boolean(memory.hasApiKey),
  });
}

module.exports = { resoudreStatut, lireStatutPublic };
