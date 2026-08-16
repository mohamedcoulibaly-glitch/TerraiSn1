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

function gerantSessionKey(gerantId) {
  const id = Number(gerantId);
  if (!Number.isFinite(id) || id < 1) return null;
  return `gerant:${id}`;
}

function sessionDir(key) {
  const safe = sanitizeKey(key);
  if (safe === 'platform') return rootSessionPath;
  return path.join(rootSessionPath, safe.replace(/:/g, '_'));
}

function clearSessionLocks(dir) {
  const nested = path.join(dir, 'session');
  if (!fs.existsSync(nested)) return;
  for (const name of fs.readdirSync(nested)) {
    if (/singleton|lockfile|\.lock/i.test(name)) {
      try {
        fs.unlinkSync(path.join(nested, name));
      } catch {
        /* ignore */
      }
    }
  }
}

function killOrphanBrowsers() {
  if (process.platform !== 'win32') return;
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*wwebjs_auth*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore', timeout: 8000 }
    );
  } catch {
    /* ignore */
  }
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
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320,
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

  client.on('ready', () => markReady(state, 'event:ready'));
  client.on('authenticated', () => {
    console.log(`🔐 WhatsApp authentifié [${state.key}], synchronisation…`);
    setTimeout(() => probeReady(state, 'fallback:authenticated+5s').catch(() => {}), 5000);
    setTimeout(() => probeReady(state, 'fallback:authenticated+15s').catch(() => {}), 15000);
    setTimeout(() => probeReady(state, 'fallback:authenticated+30s').catch(() => {}), 30000);
  });
  client.on('loading_screen', (percent, message) => {
    if (Number(percent) >= 99) {
      setTimeout(() => probeReady(state, 'fallback:loading99').catch(() => {}), 2000);
    }
  });
  client.on('change_state', (next) => {
    if (String(next).toUpperCase() === 'CONNECTED') markReady(state, 'event:change_state');
  });
  client.on('disconnected', (reason) => {
    state.ready = false;
    console.warn(`⚠️ WhatsApp déconnecté [${state.key}]:`, reason);
  });
  client.on('auth_failure', (message) => {
    state.ready = false;
    state.lastError = String(message || 'auth_failure');
    console.error(`❌ Échec authentification WhatsApp [${state.key}]:`, message);
  });
}

function buildClient(state) {
  const dataPath = sessionDir(state.key);
  fs.mkdirSync(dataPath, { recursive: true });
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath, clientId: sanitizeKey(state.key) }),
    webVersionCache: { type: 'local', path: cachePath },
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
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

async function initializeOnce(state) {
  clearSessionLocks(sessionDir(state.key));
  if (!state.client) buildClient(state);
  await state.client.initialize();
}

async function ensureStarted(key = 'platform') {
  const state = getOrCreateState(key);
  if (state.mock) return { mock: true, ready: false, session: state.key };
  if (state.ready) return { mock: false, ready: true, session: state.key, phone: state.connectedPhone };
  if (state.initializing) return { mock: false, ready: false, initializing: true, session: state.key };

  state.initializing = true;
  try {
    await initializeOnce(state);
    const deadline = Date.now() + 30000;
    while (!state.ready && Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 1000));
      // eslint-disable-next-line no-await-in-loop
      await probeReady(state, 'ensureStarted-loop');
    }
  } catch (error) {
    const msg = String(error.message || error);
    state.lastError = msg;
    if (/already running|userDataDir/i.test(msg)) {
      console.warn(`⚠️ Navigateur WhatsApp verrouillé [${state.key}] — nettoyage…`);
      killOrphanBrowsers();
      clearSessionLocks(sessionDir(state.key));
      try {
        await new Promise((r) => setTimeout(r, 1500));
        await initializeOnce(state);
        state.lastError = null;
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
  return publicStatus(state);
}

const platform = getOrCreateState('platform');

if (mockMode) {
  console.log('[WHATSAPP MOCK] Client simulé, aucun QR requis.');
} else {
  setTimeout(() => {
    ensureStarted('platform').catch((err) => console.error('❌ WhatsApp start:', err.message));
  }, 800);
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

module.exports = facade;
module.exports.getStatus = (key) => getStatus(key);
module.exports.getQrPayload = (key) => getQrPayload(key);
module.exports.ensureStarted = (key) => ensureStarted(key || 'platform');
module.exports.sendMessageForSession = sendMessageForSession;
module.exports.gerantSessionKey = gerantSessionKey;
module.exports.logoutSession = logoutSession;
module.exports._state = platform;
module.exports._sessions = sessions;
