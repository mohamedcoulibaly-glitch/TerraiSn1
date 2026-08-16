const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const mockMode = String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true';
const rootSessionPath = path.resolve(
  __dirname,
  process.env.WHATSAPP_SESSION_PATH || '.wwebjs_auth'
);
const cachePath = path.resolve(__dirname, '.wwebjs_cache');

fs.mkdirSync(rootSessionPath, { recursive: true });
fs.mkdirSync(cachePath, { recursive: true });

const sessions = new Map();

function sanitizeKey(key) {
  return String(key || 'platform').replace(/[^a-zA-Z0-9:_-]/g, '_');
}

/** LocalAuth n'accepte que [a-zA-Z0-9_-] — pas de ":". */
function authClientId(key) {
  return sanitizeKey(key).replace(/:/g, '_');
}

function gerantSessionKey(gerantId) {
  const id = Number(gerantId);
  if (!Number.isFinite(id) || id < 1) return null;
  return `gerant:${id}`;
}

/** Dossier Puppeteer LocalAuth : .wwebjs_auth/session-<clientId> */
function userDataDir(key) {
  return path.join(rootSessionPath, `session-${authClientId(key)}`);
}

/** Ancien chemin imbriqué (bug) à nettoyer. */
function legacySessionDir(key) {
  return path.join(rootSessionPath, authClientId(key));
}

function clearSessionLocks(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (/singleton|lockfile|\.lock/i.test(name)) {
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {
        /* ignore */
      }
    }
  }
}

function wipeSessionFiles(key) {
  for (const dir of [userDataDir(key), legacySessionDir(key)]) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    } catch (err) {
      console.warn(`⚠️ Wipe session [${key}] ${dir}:`, err.message);
    }
  }
}

function killOrphanBrowsers(sessionKey) {
  if (process.platform !== 'win32') return;
  const dirHint = sessionKey && sessionKey !== 'platform'
    ? authClientId(sessionKey)
    : 'wwebjs_auth';
  try {
    const filter = `*${dirHint}*`;
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '${filter}' -and $_.CommandLine -like '*chrome*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore', timeout: 8000 }
    );
  } catch {
    /* ignore */
  }
}

/** Normalise un téléphone SN en international sans + (ex: 221750147138). */
function toWaIntlDigits(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9 && d.startsWith('7')) d = `221${d}`;
  if (d.startsWith('221') && d.length === 12) return d;
  return null;
}

function createSessionState(key) {
  return {
    key,
    ready: false,
    mock: mockMode,
    lastQr: null,
    lastQrDataUrl: null,
    lastError: null,
    initializing: false,
    connectedPhone: null,
    client: null,
    lastLoggedState: '',
    pairingCode: null,
    pairingPhone: null,
  };
}

function publicStatus(state) {
  return {
    session: state.key,
    connected: state.ready,
    mock: state.mock,
    hasQr: Boolean(state.lastQr),
    initializing: state.initializing,
    error: state.lastError,
    phone: state.connectedPhone,
    pairingCode: state.pairingCode,
    pairingPhone: state.pairingPhone,
    waState: state.lastLoggedState || null,
    qrPage: state.key === 'platform' ? '/whatsapp-qr' : '/backoffice/gerant',
  };
}

function getOrCreateState(key) {
  const sessionKey = sanitizeKey(key || 'platform');
  if (!sessions.has(sessionKey)) {
    sessions.set(sessionKey, createSessionState(sessionKey));
  }
  return sessions.get(sessionKey);
}

function markReady(state, source) {
  if (state.ready) return;
  state.ready = true;
  state.lastQr = null;
  state.lastQrDataUrl = null;
  state.pairingCode = null;
  state.lastError = null;
  try {
    const user = state.client?.info?.wid?.user;
    if (user) state.connectedPhone = String(user).replace(/\D/g, '');
  } catch {
    /* ignore */
  }
  console.log(`✅ WhatsApp connecté [${state.key}] (${source})${state.connectedPhone ? ` ${state.connectedPhone}` : ''}`);
}

async function probeReady(state, source) {
  if (state.ready) return true;
  if (!state.client) return false;
  try {
    const current = await state.client.getState();
    if (current === 'CONNECTED') {
      markReady(state, source || `state=${current}`);
      return true;
    }
    if (current && current !== state.lastLoggedState) {
      state.lastLoggedState = current;
      console.log(`⏳ WhatsApp [${state.key}] state=${current}`);
    }
  } catch (err) {
    console.warn(`⏳ Probe WhatsApp [${state.key}]:`, err.message);
  }
  return false;
}

function bindClientEvents(state, client) {
  client.on('qr', async (qr) => {
    state.lastQr = qr;
    state.ready = false;
    state.connectedPhone = null;
    try {
      state.lastQrDataUrl = await QRCode.toDataURL(qr, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 360,
      });
    } catch (err) {
      state.lastError = err.message;
    }
    if (state.key === 'platform') {
      console.log(`📱 QR WhatsApp plateforme : http://localhost:${process.env.PORT || 3001}/whatsapp-qr`);
      qrcodeTerminal.generate(qr, { small: true });
    } else {
      console.log(`📱 QR WhatsApp [${state.key}] prêt (espace gérant)`);
    }
  });

  client.on('code', (code) => {
    state.pairingCode = String(code || '').replace(/\s/g, '');
    console.log(`🔑 Code d'appairage WhatsApp [${state.key}]: ${state.pairingCode}`);
  });

  client.on('ready', () => markReady(state, 'event:ready'));
  client.on('authenticated', () => {
    console.log(`🔐 WhatsApp authentifié [${state.key}], synchronisation…`);
    state.lastLoggedState = 'AUTHENTICATED';
    setTimeout(() => probeReady(state, 'fallback:authenticated+5s').catch(() => {}), 5000);
    setTimeout(() => probeReady(state, 'fallback:authenticated+15s').catch(() => {}), 15000);
    setTimeout(() => probeReady(state, 'fallback:authenticated+30s').catch(() => {}), 30000);
  });
  client.on('loading_screen', (percent) => {
    if (Number(percent) >= 99) {
      setTimeout(() => probeReady(state, 'fallback:loading99').catch(() => {}), 2000);
    }
  });
  client.on('change_state', (next) => {
    state.lastLoggedState = String(next || '');
    if (String(next).toUpperCase() === 'CONNECTED') markReady(state, 'event:change_state');
  });
  client.on('disconnected', (reason) => {
    state.ready = false;
    state.pairingCode = null;
    console.warn(`⚠️ WhatsApp déconnecté [${state.key}]:`, reason);
  });
  client.on('auth_failure', (message) => {
    state.ready = false;
    state.lastError = String(message || 'auth_failure');
    console.error(`❌ Échec authentification WhatsApp [${state.key}]:`, message);
  });
  client.on('error', (err) => {
    const msg = String(err?.message || err);
    state.lastError = msg;
    console.warn(`⚠️ WhatsApp client error [${state.key}]:`, msg);
  });
}

function buildClient(state) {
  const clientCache = path.join(cachePath, authClientId(state.key));
  fs.mkdirSync(clientCache, { recursive: true });

  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: rootSessionPath,
      clientId: authClientId(state.key),
    }),
    authTimeoutMs: 120000,
    qrMaxRetries: 12,
    webVersionCache: { type: 'local', path: clientCache },
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--no-first-run',
        '--mute-audio',
      ],
    },
  });
  Object.defineProperty(client, 'isReady', {
    get() {
      return state.ready;
    },
    set(value) {
      state.ready = Boolean(value);
    },
  });
  bindClientEvents(state, client);
  state.client = client;
  return client;
}

async function destroyClient(state) {
  if (!state.client) return;
  try {
    await state.client.destroy();
  } catch {
    /* ignore */
  }
  state.client = null;
}

async function maybeRequestPairingCode(state, phoneRaw) {
  const intl = toWaIntlDigits(phoneRaw);
  if (!intl || !state.client || state.ready) return null;
  if (state.pairingCode && state.pairingPhone === intl) return state.pairingCode;
  try {
    state.pairingPhone = intl;
    console.log(`🔑 Demande code d'appairage [${state.key}] pour ${intl}…`);
    const code = await state.client.requestPairingCode(intl, true, 180000);
    if (code) {
      state.pairingCode = String(code).replace(/\s/g, '');
      console.log(`🔑 Code reçu [${state.key}]: ${state.pairingCode}`);
    }
    return state.pairingCode;
  } catch (err) {
    console.warn(`⚠️ Code d'appairage [${state.key}]:`, err.message);
    return null;
  }
}

async function initializeOnce(state) {
  clearSessionLocks(userDataDir(state.key));
  if (state.client && state.lastError && !state.lastQrDataUrl && !state.pairingCode) {
    await destroyClient(state);
  }
  if (!state.client) buildClient(state);
  await state.client.initialize();
}

async function waitForQrOrReady(state, ms = 60000) {
  const deadline = Date.now() + ms;
  while (!state.ready && !state.lastQrDataUrl && !state.pairingCode && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 800));
    // eslint-disable-next-line no-await-in-loop
    await probeReady(state, 'wait-qr');
  }
}

/**
 * @param {string} key
 * @param {{ force?: boolean, phoneNumber?: string }} [opts]
 */
async function ensureStarted(key = 'platform', opts = {}) {
  const state = getOrCreateState(key);
  if (state.mock) return { mock: true, ready: false, session: state.key };
  if (state.ready) return { mock: false, ready: true, session: state.key, phone: state.connectedPhone };
  if (state.initializing) {
    await waitForQrOrReady(state, 60000);
    if (opts.phoneNumber && !state.ready) {
      await maybeRequestPairingCode(state, opts.phoneNumber);
    }
    return {
      mock: false,
      ready: state.ready,
      session: state.key,
      phone: state.connectedPhone,
      initializing: state.initializing,
      error: state.lastError,
      pairingCode: state.pairingCode,
    };
  }

  // Session déjà en attente de scan : ne pas relancer Chrome.
  if (!opts.force && state.client && (state.lastQrDataUrl || state.pairingCode)) {
    await probeReady(state, 'reuse-qr');
    if (opts.phoneNumber && !state.ready && !state.pairingCode) {
      await maybeRequestPairingCode(state, opts.phoneNumber);
    }
    return {
      mock: false,
      ready: state.ready,
      session: state.key,
      phone: state.connectedPhone,
      error: state.lastError,
      pairingCode: state.pairingCode,
    };
  }

  if (opts.force) {
    await destroyClient(state);
    state.lastQr = null;
    state.lastQrDataUrl = null;
    state.pairingCode = null;
    state.pairingPhone = null;
    state.lastError = null;
    state.lastLoggedState = '';
    killOrphanBrowsers(state.key);
    wipeSessionFiles(state.key);
    await new Promise((r) => setTimeout(r, 1000));
  }

  state.initializing = true;
  state.lastError = null;
  try {
    await initializeOnce(state);
    await waitForQrOrReady(state, 60000);
    if (opts.phoneNumber && !state.ready) {
      await maybeRequestPairingCode(state, opts.phoneNumber);
    }
  } catch (error) {
    const msg = String(error.message || error);
    state.lastError = msg;
    if (/already running|userDataDir/i.test(msg)) {
      console.warn(`⚠️ WhatsApp [${state.key}] navigateur déjà actif — attente…`);
      state.lastError = null;
      await waitForQrOrReady(state, 60000);
      if (!state.lastQrDataUrl && !state.pairingCode && !state.ready) {
        console.warn(`⚠️ WhatsApp [${state.key}] — reset forcé (pas de QR/code)`);
        killOrphanBrowsers(state.key);
        wipeSessionFiles(state.key);
        try {
          await destroyClient(state);
          await new Promise((r) => setTimeout(r, 1500));
          await initializeOnce(state);
          await waitForQrOrReady(state, 60000);
          if (opts.phoneNumber && !state.ready) {
            await maybeRequestPairingCode(state, opts.phoneNumber);
          }
        } catch (retryErr) {
          state.lastError = retryErr.message;
          console.error(`❌ Initialisation WhatsApp retry [${state.key}]:`, retryErr.message);
        }
      }
    } else if (/Invalid clientId/i.test(msg)) {
      console.warn(`⚠️ WhatsApp [${state.key}] — reset client (${msg})`);
      killOrphanBrowsers(state.key);
      wipeSessionFiles(state.key);
      try {
        await destroyClient(state);
        await new Promise((r) => setTimeout(r, 1500));
        state.lastError = null;
        await initializeOnce(state);
        await waitForQrOrReady(state, 60000);
      } catch (retryErr) {
        state.lastError = retryErr.message;
        console.error(`❌ Initialisation WhatsApp retry [${state.key}]:`, retryErr.message);
      }
    } else {
      console.error(`❌ Initialisation WhatsApp [${state.key}]:`, msg);
    }
  } finally {
    state.initializing = false;
  }
  return {
    mock: false,
    ready: state.ready,
    session: state.key,
    phone: state.connectedPhone,
    error: state.lastError,
    pairingCode: state.pairingCode,
  };
}

function getStatus(key = 'platform') {
  return publicStatus(getOrCreateState(key));
}

function getQrPayload(key = 'platform') {
  const state = getOrCreateState(key);
  return {
    qr: state.lastQr,
    dataUrl: state.lastQrDataUrl,
    connected: state.ready,
    mock: state.mock,
    phone: state.connectedPhone,
    session: state.key,
    initializing: state.initializing,
    error: state.lastError,
    pairingCode: state.pairingCode,
    pairingPhone: state.pairingPhone,
    waState: state.lastLoggedState || null,
  };
}

async function sendMessageForSession(key, chatId, content, options) {
  const state = getOrCreateState(key);
  if (state.mock) return { mock: true };
  if (!state.ready) await ensureStarted(key);
  if (!state.ready || !state.client) {
    const err = new Error(
      key === 'platform'
        ? 'WhatsApp plateforme non connecté. Ouvrez /whatsapp-qr.'
        : 'WhatsApp du gérant non connecté. Scannez le QR dans l’espace gérant.'
    );
    err.statusCode = 503;
    throw err;
  }
  if (options && options.media) {
    await state.client.sendMessage(chatId, options.media, options.sendOptions || {});
    return { mock: false, phone: state.connectedPhone, session: state.key };
  }
  await state.client.sendMessage(chatId, content, options || {});
  return { mock: false, phone: state.connectedPhone, session: state.key };
}

async function logoutSession(key) {
  const state = getOrCreateState(key);
  try {
    if (state.client) await state.client.destroy();
  } catch {
    /* ignore */
  }
  state.client = null;
  state.ready = false;
  state.connectedPhone = null;
  state.lastQr = null;
  state.lastQrDataUrl = null;
  state.pairingCode = null;
  state.pairingPhone = null;
  killOrphanBrowsers(state.key);
  wipeSessionFiles(state.key);
  return publicStatus(state);
}

const platform = getOrCreateState('platform');

if (mockMode) {
  console.log('[WHATSAPP MOCK] Client simulé, aucun QR requis.');
} else {
  // Démarrage différé plateforme pour laisser de la RAM au premier lien gérant.
  setTimeout(() => {
    ensureStarted('platform').catch((err) => console.error('❌ WhatsApp start:', err.message));
  }, 5000);
}

const facade = {
  get isReady() {
    return platform.ready;
  },
  set isReady(value) {
    platform.ready = Boolean(value);
  },
  sendMessage: (...args) => sendMessageForSession('platform', ...args),
};

process.on('unhandledRejection', (reason) => {
  const msg = String(reason?.message || reason || '');
  if (/Target closed|Navigating frame was detached|Session closed|Protocol error/i.test(msg)) {
    console.warn('⚠️ WhatsApp/Puppeteer (non bloquant):', msg);
    return;
  }
  console.error('unhandledRejection:', reason);
});

module.exports = facade;
module.exports.getStatus = (key) => getStatus(key);
module.exports.getQrPayload = (key) => getQrPayload(key);
module.exports.ensureStarted = (key, opts) => ensureStarted(key || 'platform', opts);
module.exports.sendMessageForSession = sendMessageForSession;
module.exports.gerantSessionKey = gerantSessionKey;
module.exports.logoutSession = logoutSession;
module.exports.toWaIntlDigits = toWaIntlDigits;
module.exports._state = platform;
module.exports._sessions = sessions;
