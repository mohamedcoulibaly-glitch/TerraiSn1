/**
 * Session WhatsApp locale (Baileys).
 * Après scan / code d'appairage, WhatsApp envoie 515 (restart required) :
 * il FAUT reconnecter avec les creds déjà sauvées — sinon l'appairage échoue.
 */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const AUTH_ROOT = path.join(__dirname, 'data', 'wa-auth');

/** @type {Map<string, { sock: any, starting: Promise<void>|null, reconnecting?: boolean, alive?: boolean }>} */
const sockets = new Map();

function authDir(key) {
  const safe = String(key || 'platform').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(AUTH_ROOT, safe);
}

function toBaileysJid(chatId) {
  const raw = String(chatId || '');
  const digits = raw.replace(/@c\.us$/i, '').replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '');
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

function loadBaileys() {
  return import('@whiskeysockets/baileys').then(async (baileys) => {
    const pinoMod = await import('pino');
    const makeWASocket = baileys.default || baileys.makeWASocket;
    return {
      makeWASocket,
      useMultiFileAuthState: baileys.useMultiFileAuthState,
      DisconnectReason: baileys.DisconnectReason,
      Browsers: baileys.Browsers,
      fetchLatestBaileysVersion: baileys.fetchLatestBaileysVersion,
      fetchLatestWaWebVersion: baileys.fetchLatestWaWebVersion,
      pino: pinoMod.default || pinoMod,
    };
  });
}

const FALLBACK_WA_VERSION = [2, 3000, 1033893291];

async function resolveWaVersion(lib) {
  try {
    const latest = await lib.fetchLatestBaileysVersion();
    if (Array.isArray(latest?.version) && latest.version.length >= 3) {
      console.log(`📡 Version WhatsApp Web Baileys: ${latest.version.join('.')}`);
      return latest.version;
    }
  } catch (err) {
    console.warn('⚠️ fetchLatestBaileysVersion:', err.message);
  }
  try {
    const web = await lib.fetchLatestWaWebVersion();
    if (Array.isArray(web?.version) && web.version.length >= 3) {
      console.log(`📡 Version WhatsApp Web: ${web.version.join('.')}`);
      return web.version;
    }
  } catch {
    /* ignore */
  }
  return FALLBACK_WA_VERSION;
}

function readCredsRegistered(dir) {
  const credsPath = path.join(dir, 'creds.json');
  if (!fs.existsSync(credsPath)) return false;
  try {
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    return Boolean(creds && creds.registered);
  } catch {
    return false;
  }
}

function wipeAuthDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

async function waitMs(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

function liveSocket(key) {
  const entry = sockets.get(key);
  if (!entry?.sock || entry.alive === false) return null;
  return entry.sock;
}

function toIntlPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9 && d.startsWith('7')) d = `221${d}`;
  if (d.startsWith('221') && d.length === 12) return d;
  return d.length >= 10 ? d : null;
}

function scheduleReconnect(state, phoneNumber, delayMs = 1200) {
  const held = sockets.get(state.key);
  if (held?.reconnecting) return;
  if (held) held.reconnecting = true;
  state.waState = 'restarting';
  state.initializing = true;
  console.warn(`↻ Baileys reconnect [${state.key}] dans ${delayMs}ms`);
  setTimeout(() => {
    bindSocket(state, { force: false, reconnect: true, phoneNumber })
      .catch((err) => {
        state.lastError = err.message;
        console.error(`❌ Baileys reconnect [${state.key}]:`, err.message);
      })
      .finally(() => {
        const next = sockets.get(state.key);
        if (next) next.reconnecting = false;
      });
  }, delayMs);
}

async function bindSocket(state, { force = false, reconnect = false, phoneNumber = null } = {}) {
  const lib = await loadBaileys();
  const dir = authDir(state.key);

  // Ne jamais effacer les creds pendant un reconnect (surtout après 515 post-scan).
  if (force) {
    wipeAuthDir(dir);
  }
  fs.mkdirSync(dir, { recursive: true });

  const existing = sockets.get(state.key);
  if (existing?.sock) {
    try {
      existing.sock.ev?.removeAllListeners?.();
      existing.sock.end(undefined);
    } catch {
      /* ignore */
    }
  }

  const { state: auth, saveCreds } = await lib.useMultiFileAuthState(dir);
  const version = await resolveWaVersion(lib);
  const sock = lib.makeWASocket({
    auth,
    version,
    logger: lib.pino({ level: 'silent' }),
    browser: lib.Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });
  sockets.set(state.key, {
    sock,
    starting: existing?.starting || null,
    alive: true,
    reconnecting: existing?.reconnecting || false,
  });

  state.transport = 'baileys';
  state.initializing = !auth.creds?.registered;
  state.lastError = null;
  if (force) {
    state.lastQrDataUrl = null;
    state.pairingCode = null;
    state.pairingPhone = null;
    state.ready = false;
  }

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect, isNewLogin } = update;

    if (isNewLogin) {
      state.waState = 'authenticating';
      state.initializing = true;
      console.log(`🔐 Baileys pair-success [${state.key}] — redémarrage attendu`);
    }

    if (qr && !state.ready && !readCredsRegistered(dir)) {
      try {
        state.lastQrDataUrl = await QRCode.toDataURL(qr, {
          margin: 2,
          width: 320,
          errorCorrectionLevel: 'L',
        });
        state.waState = 'qr_ready';
        state.initializing = true;
        state.lastError = null;
      } catch (err) {
        console.error('❌ QR Baileys:', err.message);
      }
    }

    if (connection === 'open') {
      state.ready = true;
      state.initializing = false;
      state.lastQrDataUrl = null;
      state.pairingCode = null;
      state.waState = 'ready';
      state.lastError = null;
      const id = sock.user?.id || '';
      state.connectedPhone =
        String(id).split(':')[0].replace(/\D/g, '') || state.connectedPhone;
      const entry = sockets.get(state.key);
      if (entry) entry.alive = true;
      console.log(
        `✅ WhatsApp Baileys connecté [${state.key}]${state.connectedPhone ? ` ${state.connectedPhone}` : ''}`,
      );
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === lib.DisconnectReason.loggedOut || code === 401;
      const restartRequired =
        code === lib.DisconnectReason.restartRequired || code === 515;
      const reason =
        lastDisconnect?.error?.message ||
        lastDisconnect?.error?.output?.payload?.message ||
        '';
      console.warn(`⚠️ Baileys close [${state.key}] code=${code || '?'} ${reason}`);

      const entry = sockets.get(state.key);
      if (entry) entry.alive = false;
      state.ready = false;

      if (loggedOut) {
        state.initializing = false;
        state.waState = 'logged_out';
        state.lastQrDataUrl = null;
        state.pairingCode = null;
        sockets.delete(state.key);
        wipeAuthDir(dir);
        return;
      }

      // 515 = normal après scan / pairing code → reconnect IMMÉDIAT avec les creds sauvées
      if (restartRequired) {
        state.lastQrDataUrl = null;
        state.pairingCode = null;
        state.waState = 'authenticating';
        state.initializing = true;
        scheduleReconnect(state, phoneNumber, 800);
        return;
      }

      // QR expiré (408) ou autre coupure : reconnecter pour un nouveau QR / reprendre
      state.waState = 'disconnected';
      if (!readCredsRegistered(dir)) {
        // Nouveau QR attendu
        state.lastQrDataUrl = null;
      }
      scheduleReconnect(state, phoneNumber, code === 408 ? 500 : 1500);
    }
  });

  // Code d'appairage uniquement si demandé et pas déjà enregistré
  const intl = toIntlPhone(phoneNumber);
  if (
    intl &&
    !auth.creds?.registered &&
    !reconnect &&
    typeof sock.requestPairingCode === 'function'
  ) {
    try {
      await waitMs(1500);
      if (!state.ready && liveSocket(state.key)) {
        const code = await sock.requestPairingCode(intl);
        if (code) {
          state.pairingCode = String(code).replace(/\s/g, '');
          state.pairingPhone = intl;
          state.waState = 'qr_ready';
          state.initializing = true;
          console.log(`🔑 Code d'appairage Baileys [${state.key}]: ${state.pairingCode}`);
        }
      }
    } catch (err) {
      console.warn(`⚠️ Pairing Baileys [${state.key}]:`, err.message || err);
    }
  }
}

async function ensure(state, opts = {}) {
  if (state.ready && state.transport === 'baileys' && !opts.force) return state;

  const held = sockets.get(state.key);
  const alive = Boolean(held?.sock && held.alive !== false);

  // Socket vivant avec QR / code encore valides
  if (!opts.force && alive && (state.lastQrDataUrl || state.pairingCode) && !state.ready) {
    return state;
  }
  if (!opts.force && alive && !state.ready) {
    const waitQrUntil = Date.now() + 15000;
    while (Date.now() < waitQrUntil) {
      if (state.ready || state.lastQrDataUrl || state.pairingCode) return state;
      await waitMs(300);
    }
    return state;
  }
  if (held?.starting && !opts.force) {
    await held.starting;
    return state;
  }
  // Reconnect déjà en cours (ex. après 515)
  if (held?.reconnecting && !opts.force) {
    const waitUntil = Date.now() + 20000;
    while (Date.now() < waitUntil) {
      if (state.ready || state.lastQrDataUrl || state.pairingCode) return state;
      await waitMs(400);
    }
    return state;
  }

  const run = bindSocket(state, {
    force: Boolean(opts.force),
    reconnect: Boolean(opts.reconnect),
    phoneNumber: opts.phoneNumber || null,
  }).catch((err) => {
    state.lastError = err.message;
    console.error(`❌ Baileys [${state.key}]:`, err.message);
  });
  sockets.set(state.key, {
    sock: sockets.get(state.key)?.sock || null,
    starting: run,
    alive: sockets.get(state.key)?.alive,
    reconnecting: sockets.get(state.key)?.reconnecting,
  });
  await run;

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (state.ready || state.lastQrDataUrl || state.pairingCode) break;
    await waitMs(300);
  }
  if (state.lastQrDataUrl) {
    console.log(`📱 QR WhatsApp Baileys [${state.key}] prêt`);
  }
  if (state.pairingCode) {
    console.log(`📱 Code WhatsApp Baileys [${state.key}] prêt`);
  }
  const cur = sockets.get(state.key);
  if (cur) cur.starting = null;
  return state;
}

async function sendText(key, chatId, text) {
  const sock = liveSocket(key);
  if (!sock) throw new Error('WhatsApp local non connecté');
  const jid = toBaileysJid(chatId);
  if (!jid) throw new Error('Destinataire WhatsApp invalide');
  await sock.sendMessage(jid, { text: String(text || '') });
}

async function sendImage(key, chatId, media = {}) {
  const sock = liveSocket(key);
  if (!sock) throw new Error('WhatsApp local non connecté');
  const jid = toBaileysJid(chatId);
  if (!jid) throw new Error('Destinataire WhatsApp invalide');
  let buffer = null;
  let mimetype = media.mimetype || 'image/jpeg';
  if (media.filePath && fs.existsSync(media.filePath)) {
    buffer = fs.readFileSync(media.filePath);
  } else if (media.base64) {
    buffer = Buffer.from(String(media.base64), 'base64');
  } else if (media.url) {
    const res = await fetch(media.url);
    buffer = Buffer.from(await res.arrayBuffer());
    mimetype = res.headers.get('content-type') || mimetype;
  } else {
    throw new Error('Image WhatsApp: url, base64 ou filePath requis');
  }
  await sock.sendMessage(jid, {
    image: buffer,
    caption: media.caption || '',
    mimetype,
  });
}

async function logout(key) {
  const entry = sockets.get(key);
  if (entry?.sock) {
    try {
      await entry.sock.logout();
    } catch {
      try {
        entry.sock.end(undefined);
      } catch {
        /* ignore */
      }
    }
  }
  sockets.delete(key);
  const dir = authDir(key);
  wipeAuthDir(dir);
}

module.exports = { ensure, sendText, sendImage, logout, toBaileysJid };
