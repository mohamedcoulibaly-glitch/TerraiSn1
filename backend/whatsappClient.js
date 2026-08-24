/**
 * Client WhatsApp via OpenWA (REST) — plus de whatsapp-web.js / Puppeteer local.
 * Doc: https://docs.open-wa.org/ — serveur: OPENWA_BASE_URL
 */
const fs = require('fs');
const path = require('path');

const mockMode = String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true';
const baseUrl = String(process.env.OPENWA_BASE_URL || 'https://mywa.tickets-place.net').replace(/\/$/, '');
const apiKey = String(process.env.OPENWA_API_KEY || '').trim();
const sessionPrefix = String(process.env.OPENWA_SESSION_PREFIX || 'terrainsn').replace(/[^a-zA-Z0-9_-]/g, '');
/** Si défini, toutes les clés (platform + gérants) utilisent cette session OpenWA UUID. */
const sharedSessionId = String(process.env.OPENWA_SHARED_SESSION_ID || '').trim() || null;
/** Override UUID pour la session plateforme uniquement. */
const platformSessionId = String(process.env.OPENWA_PLATFORM_SESSION_ID || '').trim() || null;

/** @type {Map<string, SessionState>} */
const sessions = new Map();

/**
 * @typedef {object} SessionState
 * @property {string} key
 * @property {string|null} openwaId
 * @property {string} openwaName
 * @property {boolean} ready
 * @property {boolean} mock
 * @property {string|null} lastQrDataUrl
 * @property {string|null} lastError
 * @property {boolean} initializing
 * @property {string|null} connectedPhone
 * @property {string|null} pairingCode
 * @property {string|null} pairingPhone
 * @property {string|null} waState
 */

const USER_INFRA_ERROR =
  "Y'a un problème avec WhatsApp. Contactez le développeur immédiatement.";

const STARTING_STATES = new Set(['created', 'initializing', 'qr_ready', 'authenticating', 'starting']);
const LIVE_STATES = new Set(['initializing', 'qr_ready', 'authenticating', 'ready']);

let startLocks = new Map();
/** OpenWA pour envoi distant si déjà prêt ; l’appairage QR utilise Baileys local par défaut (OpenWA distant reste souvent bloqué en qr_ready). */
const engineName = String(process.env.WHATSAPP_ENGINE || (apiKey ? 'openwa' : 'baileys')).toLowerCase();
const linkEngine = String(process.env.WHATSAPP_LINK_ENGINE || 'baileys').toLowerCase();
const allowBaileysFallback =
  String(process.env.WHATSAPP_FALLBACK_BAILEYS || 'true').toLowerCase() === 'true';
let preferBaileys = engineName === 'baileys' || engineName === 'local' || linkEngine === 'baileys' || linkEngine === 'local';
let healthCache = { at: 0, value: null };

function requireConfig() {
  if (mockMode) return;
  if (!apiKey) {
    const err = new Error(USER_INFRA_ERROR);
    err.statusCode = 503;
    err.causeMessage = 'OPENWA_API_KEY manquant';
    throw err;
  }
}

function sanitizeKey(key) {
  return String(key || 'platform').replace(/[^a-zA-Z0-9:_-]/g, '_');
}

function gerantSessionKey(gerantId) {
  const id = Number(gerantId);
  if (!Number.isFinite(id) || id < 1) return null;
  return `gerant:${id}`;
}

/** Nom OpenWA (UUID côté API) — ex: terrainsn-platform, terrainsn-gerant-12 */
function openwaSessionName(key) {
  const k = sanitizeKey(key);
  if (k === 'platform') return `${sessionPrefix}-platform`;
  const m = /^gerant:(\d+)$/.exec(k);
  if (m) return `${sessionPrefix}-gerant-${m[1]}`;
  return `${sessionPrefix}-${k.replace(/:/g, '-')}`;
}

/** Normalise un téléphone SN en international sans + (ex: 221750147138). */
function toWaIntlDigits(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  // 07XXXXXXXX → 7XXXXXXXX puis préfixe 221
  if (d.length === 10 && d.startsWith('07')) d = d.slice(1);
  if (d.length === 9 && d.startsWith('7')) d = `221${d}`;
  if (d.startsWith('221') && d.length === 12 && /^2217\d{8}$/.test(d)) return d;
  return null;
}

/** Statut UX unifié pour la PWA gérant. */
function connectionStatusOf(state) {
  if (state.mock) return 'DISCONNECTED';
  if (state.ready) return 'CONNECTED';
  const wa = String(state.waState || '').toLowerCase();
  if (
    state.pairingCode ||
    state.initializing ||
    wa === 'qr_ready' ||
    wa === 'authenticating' ||
    wa === 'restarting' ||
    wa === 'initializing' ||
    wa === 'starting'
  ) {
    return 'CONNECTING';
  }
  return 'DISCONNECTED';
}

function formatPairingCodeDisplay(code) {
  const clean = String(code || '').replace(/\s/g, '').toUpperCase();
  if (clean.length === 8) return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  return clean || null;
}

function createSessionState(key) {
  const sessionKey = sanitizeKey(key);
  const pinnedId =
    sharedSessionId ||
    (sessionKey === 'platform' ? platformSessionId : null) ||
    null;
  return {
    key: sessionKey,
    openwaId: pinnedId,
    openwaName: openwaSessionName(sessionKey),
    ready: false,
    mock: mockMode,
    lastQrDataUrl: null,
    lastError: null,
    initializing: false,
    connectedPhone: null,
    pairingCode: null,
    pairingPhone: null,
    pairingExpiresAt: null,
    waState: null,
    transport: 'openwa',
    pinned: Boolean(pinnedId),
    recreateAttempted: false,
    startPromise: null,
  };
}

function getOrCreateState(key) {
  const sessionKey = sanitizeKey(key || 'platform');
  if (!sessions.has(sessionKey)) {
    sessions.set(sessionKey, createSessionState(sessionKey));
  }
  return sessions.get(sessionKey);
}

function isChromiumLaunchFailure(raw) {
  return /Failed to launch the browser|puppeteer|Permission denied|pthread_create|Resource temporarily unavailable|n’arrive pas à lancer Chromium|ENGINE_TYPE=baileys/i.test(
    String(raw || ''),
  );
}

function isInfraFailure(raw) {
  return (
    isChromiumLaunchFailure(raw) ||
    /OpenWA |OPENWA_|ECONN|ETIMEDOUT|fetch failed|AbortError|HTTP 5\d\d|API_KEY manquant|n’arrive pas à lancer/i.test(
      String(raw || ''),
    )
  );
}

function publicError(state) {
  if (state.mock) return USER_INFRA_ERROR;
  if (state.transport === 'baileys' && (state.ready || state.lastQrDataUrl || state.pairingCode)) return null;
  if (!apiKey && state.transport !== 'baileys') return USER_INFRA_ERROR;
  if (String(state.waState || '').toLowerCase() === 'failed' && state.transport !== 'baileys') return USER_INFRA_ERROR;
  if (isInfraFailure(state.lastError) && state.transport !== 'baileys') return USER_INFRA_ERROR;
  return null;
}

function publicStatus(state, health = null) {
  if (state.pairingCode && state.pairingExpiresAt && Date.now() > Number(state.pairingExpiresAt)) {
    state.pairingCode = null;
    state.pairingExpiresAt = null;
    if (!state.ready) {
      state.waState = 'disconnected';
      state.lastError = state.lastError || 'Le code de jumelage a expiré. Générez-en un nouveau.';
    }
  }
  const infraOk = health ? Boolean(health.ok) : publicError(state) == null && !state.mock && Boolean(apiKey);
  const status = connectionStatusOf(state);
  return {
    session: state.key,
    connected: state.ready,
    status,
    mock: state.mock,
    hasQr: Boolean(state.lastQrDataUrl),
    initializing: state.initializing,
    error: infraOk || state.transport === 'baileys' ? publicError(state) : USER_INFRA_ERROR,
    infra_ok: infraOk || state.transport === 'baileys',
    phone: state.connectedPhone,
    pairingCode: state.pairingCode,
    pairingCodeDisplay: formatPairingCodeDisplay(state.pairingCode),
    pairingPhone: state.pairingPhone,
    pairingExpiresAt: state.pairingExpiresAt || null,
    waState: state.waState || null,
    provider: state.transport || 'openwa',
    openwaSessionId: state.openwaId,
    openwaSessionName: state.openwaName,
    qrPage: state.key === 'platform' ? '/whatsapp-qr' : '/backoffice/gerant/parametres',
  };
}

function applyRemoteSession(state, remote) {
  if (!remote || state.transport === 'baileys') return;
  state.openwaId = remote.id || state.openwaId;
  const status = String(remote.status || '').toLowerCase();
  state.waState = status || null;
  state.ready = status === 'ready';
  state.connectedPhone = remote.phone
    ? String(remote.phone).replace(/\D/g, '')
    : state.ready
      ? state.connectedPhone
      : null;
  if (state.ready) {
    state.lastQrDataUrl = null;
    state.pairingCode = null;
    state.lastError = null;
  } else if (status === 'authenticating') {
    // Ne plus afficher un QR périmé pendant la validation téléphone
    state.lastQrDataUrl = null;
    state.lastError = null;
  } else if (remote.lastError) {
    const raw = String(remote.lastError);
    state.lastError = raw.slice(0, 500);
  }
  state.initializing = STARTING_STATES.has(status) && status !== 'created' && !state.ready;
  if (status === 'created') state.initializing = Boolean(state.startPromise);
}

function openwaCreateBody(name) {
  return {
    name,
    // Baileys côté serveur OpenWA : moins de Chromium, appairage plus stable
    config: { engineType: 'baileys' },
  };
}

async function openwaRequest(method, apiPath, body, opts = {}) {
  requireConfig();
  const url = `${baseUrl}/api${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
  const headers = {
    'X-API-Key': apiKey,
    Accept: 'application/json',
  };
  const timeoutMs = opts.timeoutMs === 0 ? 0 : (opts.timeoutMs || 20000);
  const init = { method, headers };
  if (timeoutMs > 0) init.signal = AbortSignal.timeout(timeoutMs);
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const fail = new Error(USER_INFRA_ERROR);
    fail.statusCode = 503;
    fail.causeMessage = err.name === 'TimeoutError' || err.name === 'AbortError'
      ? 'OpenWA timeout'
      : err.message;
    throw fail;
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const msg =
      (data && (data.message || data.error || data.code)) ||
      `OpenWA ${method} ${apiPath} → HTTP ${res.status}`;
    const technical = typeof msg === 'string' ? msg : JSON.stringify(msg);
    const err = new Error(USER_INFRA_ERROR);
    err.statusCode = res.status >= 500 ? 503 : res.status;
    err.causeMessage = `OpenWA ${method} ${apiPath} → HTTP ${res.status}: ${technical}`;
    err.payload = data;
    throw err;
  }
  return data;
}

async function listRemoteSessions() {
  const data = await openwaRequest('GET', '/sessions?limit=200&offset=0');
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.sessions)) return data.sessions;
  return [];
}

async function findRemoteByName(name) {
  const all = await listRemoteSessions();
  return all.find((s) => s && s.name === name) || null;
}

async function peekRemoteSession(state) {
  if (state.pinned && state.openwaId) {
    const remote = await openwaRequest('GET', `/sessions/${state.openwaId}`);
    applyRemoteSession(state, remote);
    return remote;
  }
  if (state.openwaId) {
    try {
      const remote = await openwaRequest('GET', `/sessions/${state.openwaId}`);
      applyRemoteSession(state, remote);
      return remote;
    } catch (err) {
      if (err.statusCode !== 404) throw err;
      state.openwaId = null;
    }
  }
  const remote = await findRemoteByName(state.openwaName);
  if (remote) applyRemoteSession(state, remote);
  return remote || null;
}

async function ensureRemoteSession(state) {
  const existing = await peekRemoteSession(state);
  if (existing) return existing;
  const remote = await openwaRequest('POST', '/sessions', openwaCreateBody(state.openwaName));
  console.log(`🆕 OpenWA session créée [${state.key}] name=${state.openwaName} id=${remote.id}`);
  applyRemoteSession(state, remote);
  return remote;
}

async function fetchQr(state) {
  if (!state.openwaId || state.ready) return null;
  try {
    const qr = await openwaRequest('GET', `/sessions/${state.openwaId}/qr`);
    const dataUrl = qr?.qrCode || qr?.dataUrl || qr?.qr || null;
    if (dataUrl) {
      state.lastQrDataUrl = dataUrl;
      state.waState = String(qr.status || state.waState || 'qr_ready');
    }
    return dataUrl;
  } catch (err) {
    // QR pas encore prêt / déjà authentifié — normal pendant le démarrage
    if (err.statusCode === 400) return null;
    throw err;
  }
}

async function requestPairingCode(state, phoneRaw) {
  const intl = toWaIntlDigits(phoneRaw);
  if (!intl || !state.openwaId || state.ready) return null;
  if (state.pairingCode && state.pairingPhone === intl) return state.pairingCode;
  try {
    state.pairingPhone = intl;
    const result = await openwaRequest('POST', `/sessions/${state.openwaId}/pairing-code`, {
      phoneNumber: intl,
    });
    const code = result?.pairingCode || result?.code || null;
    if (code) {
      state.pairingCode = String(code).replace(/\s/g, '');
      console.log(`🔑 Code d'appairage OpenWA [${state.key}]: ${state.pairingCode}`);
    }
    if (result?.status) state.waState = String(result.status);
    return state.pairingCode;
  } catch (err) {
    console.warn(`⚠️ Pairing OpenWA [${state.key}]:`, err.causeMessage || err.message);
    return null;
  }
}

async function recreateRemoteSession(state) {
  if (state.pinned) {
    // Session UUID imposée via .env — on ne la supprime pas.
    const remote = await openwaRequest('GET', `/sessions/${state.openwaId}`);
    applyRemoteSession(state, remote);
    return remote;
  }
  if (state.openwaId) {
    try {
      await openwaRequest('POST', `/sessions/${state.openwaId}/force-kill`);
    } catch {
      /* ignore */
    }
    try {
      await openwaRequest('DELETE', `/sessions/${state.openwaId}`);
    } catch {
      /* ignore */
    }
  }
  state.openwaId = null;
  state.ready = false;
  state.lastQrDataUrl = null;
  state.pairingCode = null;
  state.pairingPhone = null;
  state.waState = null;
  const remote = await openwaRequest('POST', '/sessions', openwaCreateBody(state.openwaName));
  applyRemoteSession(state, remote);
  console.log(`♻️ OpenWA session recréée [${state.key}] id=${remote.id}`);
  return remote;
}

async function infraFail(state, technical) {
  if (technical) {
    state.lastError = String(technical).slice(0, 500);
    console.error(`❌ OpenWA [${state.key}]:`, technical);
  }
  const err = new Error(USER_INFRA_ERROR);
  err.statusCode = 503;
  err.causeMessage = technical;
  return err;
}

function kickStart(state) {
  if (!state.openwaId) return Promise.resolve(null);
  if (state.startPromise) return state.startPromise;
  const url = `${baseUrl}/api/sessions/${state.openwaId}/start`;
  // Ne jamais abort /start : un AbortSignal coupe Chromium à mi-boot (pas de QR).
  state.startPromise = fetch(url, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
  })
    .then(async (res) => {
      const text = await res.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }
      if (data && data.id) applyRemoteSession(state, data);
      if (!res.ok) {
        await peekRemoteSession(state).catch(() => null);
        if (LIVE_STATES.has(String(state.waState || '').toLowerCase())) return data;
        const err = new Error(USER_INFRA_ERROR);
        err.statusCode = res.status >= 500 ? 503 : res.status;
        err.causeMessage = `OpenWA POST /start → HTTP ${res.status}`;
        throw err;
      }
      return data;
    })
    .finally(() => {
      state.startPromise = null;
    });
  return state.startPromise;
}

async function startRemote(state) {
  if (!state.openwaId) await ensureRemoteSession(state);
  await peekRemoteSession(state).catch(() => null);
  const status = String(state.waState || '').toLowerCase();
  if (status === 'ready') return;
  if (['initializing', 'qr_ready', 'authenticating'].includes(status)) return;

  if (status === 'failed' || status === 'logged_out' || status === 'disconnected' || status === 'stopped') {
    try {
      await openwaRequest('POST', `/sessions/${state.openwaId}/force-kill`);
    } catch {
      /* pas d'engine vivant */
    }
    await new Promise((r) => setTimeout(r, 1500));
    await peekRemoteSession(state).catch(() => null);
  }

  kickStart(state).catch((err) => {
    console.error(`❌ OpenWA start [${state.key}]:`, err.causeMessage || err.message);
  });
  await new Promise((r) => setTimeout(r, 400));
  await peekRemoteSession(state).catch(() => null);
}

async function waitForQrOrReady(state, ms = 90000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const remote = await openwaRequest('GET', `/sessions/${state.openwaId}`);
      applyRemoteSession(state, remote);
    } catch (err) {
      state.lastError = err.causeMessage || err.message;
    }
    if (state.ready) return;
    await fetchQr(state).catch(() => null);
    if (state.lastQrDataUrl || state.pairingCode) return;
    if (String(state.waState || '').toLowerCase() === 'failed' && !state.startPromise) {
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/**
 * @param {string} key
 * @param {{ force?: boolean, phoneNumber?: string }} [opts]
 */
async function ensureStarted(key = 'platform', opts = {}) {
  const state = getOrCreateState(key);
  if (state.mock) return { mock: true, ready: false, session: state.key, provider: 'openwa' };

  const lockKey = state.key;
  if (startLocks.has(lockKey) && !opts.force) {
    return startLocks.get(lockKey);
  }

  const run = ensureStartedOnce(state, opts);
  startLocks.set(lockKey, run);
  try {
    return await run;
  } finally {
    if (startLocks.get(lockKey) === run) startLocks.delete(lockKey);
  }
}

async function ensureStartedOnce(state, opts = {}) {
  if (state.ready && !opts.force) {
    return {
      mock: false,
      ready: true,
      session: state.key,
      phone: state.connectedPhone,
      provider: state.transport || 'openwa',
    };
  }

  if (state.transport === 'baileys' && (state.ready || state.lastQrDataUrl || state.pairingCode) && !opts.force) {
    return {
      mock: false,
      ready: state.ready,
      session: state.key,
      phone: state.connectedPhone,
      initializing: Boolean(state.lastQrDataUrl || state.pairingCode) && !state.ready,
      error: publicError(state),
      pairingCode: state.pairingCode,
      dataUrl: state.lastQrDataUrl,
      hasQr: Boolean(state.lastQrDataUrl),
      provider: 'baileys',
    };
  }

  const baileys = require('./whatsappBaileys');
  const openWaLink = linkEngine === 'openwa' && Boolean(apiKey) && !preferBaileys;
  const hadOpenWaQr = Boolean(state.lastQrDataUrl || state.pairingCode) && state.transport === 'openwa';

  // OpenWA distant : QR souvent affiché mais jamais "ready" → Baileys local pour l’appairage.
  // On ne tente OpenWA en linking que si WHATSAPP_LINK_ENGINE=openwa explicitement.
  if (openWaLink) {
    requireConfig();
    state.transport = 'openwa';
    state.initializing = true;
    state.lastError = null;
    try {
      if (opts.force) {
        await recreateRemoteSession(state);
      } else {
        await ensureRemoteSession(state);
      }
      await startRemote(state);
      await waitForQrOrReady(state, opts.force ? 45000 : 25000);
      if (opts.phoneNumber && !state.ready) {
        await requestPairingCode(state, opts.phoneNumber);
      }
    } catch (error) {
      const technical = error.causeMessage || error.message || String(error);
      state.lastError = technical;
      console.error(`❌ OpenWA ensureStarted [${state.key}]:`, technical);
    }
  }

  const openWaStuck =
    openWaLink &&
    !state.ready &&
    (opts.force || hadOpenWaQr) &&
    allowBaileysFallback;

  const needLocal =
    preferBaileys ||
    linkEngine === 'baileys' ||
    linkEngine === 'local' ||
    openWaStuck ||
    (allowBaileysFallback && !state.mock && !state.ready && !state.lastQrDataUrl && !state.pairingCode);

  if (needLocal && !state.mock && (!state.ready || opts.force)) {
    if (state.transport === 'openwa' && !state.ready) {
      // Abandonner le QR OpenWA mort pour un vrai appairage local
      state.lastQrDataUrl = null;
      state.pairingCode = null;
      state.openwaId = state.pinned ? state.openwaId : state.openwaId;
    }
    try {
      console.log(`↪️ WhatsApp Baileys (appairage local) [${state.key}]`);
      await baileys.ensure(state, {
        force: Boolean(opts.force || openWaStuck || state.transport === 'openwa'),
        phoneNumber: opts.phoneNumber || null,
      });
    } catch (err) {
      console.error(`❌ Baileys [${state.key}]:`, err.message || err);
    }
  }

  state.initializing = Boolean(state.lastQrDataUrl || state.pairingCode) && !state.ready;

  return {
    mock: false,
    ready: state.ready,
    session: state.key,
    phone: state.connectedPhone,
    initializing: state.initializing,
    error: publicError(state),
    pairingCode: state.pairingCode,
    dataUrl: state.lastQrDataUrl,
    hasQr: Boolean(state.lastQrDataUrl),
    provider: state.transport || 'openwa',
  };
}

async function getHealth() {
  if (healthCache.value && Date.now() - healthCache.at < 8000) {
    return healthCache.value;
  }
  let value;
  if (preferBaileys) {
    const platform = getOrCreateState('platform');
    value = {
      ok: true,
      mock: false,
      engine: 'baileys',
      connected: Boolean(platform.ready),
      message: null,
    };
  } else if (mockMode) {
    value = { ok: false, mock: true, connected: false, message: USER_INFRA_ERROR };
  } else if (!apiKey) {
    value = { ok: false, mock: false, connected: false, message: USER_INFRA_ERROR };
  } else {
    try {
      const probe = await fetch(`${baseUrl}/api/infra/health`, {
        headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      const platform = getOrCreateState('platform');
      await peekRemoteSession(platform).catch(() => null);
      if (!probe.ok) {
        value = {
          ok: false,
          mock: false,
          engine: 'openwa',
          connected: Boolean(platform.ready),
          message: USER_INFRA_ERROR,
        };
      } else {
        value = {
          ok: true,
          mock: false,
          engine: 'openwa',
          connected: Boolean(platform.ready),
          message: null,
        };
      }
    } catch (err) {
      console.error('❌ OpenWA health:', err.causeMessage || err.message);
      value = { ok: false, mock: false, engine: 'openwa', connected: false, message: USER_INFRA_ERROR };
    }
  }
  healthCache = { at: Date.now(), value };
  if (value && value.ok === false && !value.mock) {
    try {
      const bugAlert = require('./services/bugAlertService');
      bugAlert
        .notifyWhatsappInfra(value.message || 'OpenWA/WhatsApp health KO', {
          engine: value.engine,
          connected: value.connected,
        })
        .catch(() => {});
    } catch {
      /* ignore */
    }
  }
  return value;
}

async function refreshState(key = 'platform') {
  const state = getOrCreateState(key);
  const health = await getHealth();
  if (state.mock) return publicStatus(state, health);

  // Reprise automatique après reboot : creds Baileys sur disque → reconnect
  try {
    const baileys = require('./whatsappBaileys');
    if (!state.ready && baileys.hasRegisteredCreds?.(state.key)) {
      state.transport = 'baileys';
      await baileys.ensure(state, { force: false, reconnect: true });
    }
  } catch (err) {
    console.warn(`⚠️ Reprise Baileys [${state.key}]:`, err.message || err);
  }

  if (state.transport === 'baileys' || preferBaileys) return publicStatus(state, health);
  if (!apiKey) return publicStatus(state, health);
  try {
    await peekRemoteSession(state);
    if (!state.ready && state.openwaId) {
      await fetchQr(state).catch(() => null);
    }
  } catch (err) {
    state.lastError = err.causeMessage || err.message;
  }
  return publicStatus(state, health);
}

async function getStatus(key = 'platform') {
  return refreshState(key);
}

/**
 * Statut mémoire uniquement — pas de ensure/reconnect/OpenWA.
 * À utiliser pour les pages publiques (dispo réservation) afin de ne pas bloquer l’API.
 */
function getStatusLite(key = 'platform') {
  const state = getOrCreateState(key);
  let hasCreds = false;
  try {
    const baileys = require('./whatsappBaileys');
    hasCreds = Boolean(baileys.hasRegisteredCreds?.(state.key));
    if (hasCreds) state.transport = 'baileys';
  } catch {
    /* ignore */
  }
  const status = publicStatus(state, { ok: true, mock: false, connected: Boolean(state.ready) });
  // Creds sur disque mais socket pas prêt = reprise attendue (ne pas bloquer la résa)
  if (!status.connected && hasCreds && status.status === 'DISCONNECTED') {
    return { ...status, status: 'CONNECTING', initializing: true };
  }
  return status;
}

async function getQrPayload(key = 'platform') {
  const state = getOrCreateState(key);
  const health = await getHealth();
  // Ne pas renvoyer un QR OpenWA « mort » quand l’appairage est en Baileys local
  if (state.transport !== 'baileys' && !preferBaileys && !state.mock && apiKey) {
    try {
      await peekRemoteSession(state);
      if (!state.ready) await fetchQr(state).catch(() => null);
    } catch (err) {
      state.lastError = err.causeMessage || err.message;
    }
  }
  return {
    ...publicStatus(state, health),
    qr: null,
    dataUrl: state.lastQrDataUrl,
  };
}

function notConnectedError(key, healthOk) {
  const err = new Error(
    healthOk
      ? (key === 'platform'
        ? 'WhatsApp n’est pas connecté. Contactez le développeur.'
        : 'WhatsApp n’est pas connecté. Allez dans Paramètres pour le lier.')
      : USER_INFRA_ERROR,
  );
  err.statusCode = 503;
  return err;
}

async function sendTextForSession(key, chatId, text) {
  const state = getOrCreateState(key);
  if (state.mock) return { mock: true };

  const baileys = require('./whatsappBaileys');
  if (state.transport !== 'baileys' && baileys.hasRegisteredCreds?.(state.key)) {
    state.transport = 'baileys';
  }

  if (state.transport === 'baileys') {
    if (!state.ready) await baileys.ensure(state);
    if (!state.ready) throw notConnectedError(key, true);
    await baileys.sendText(state.key, chatId, text);
    return { mock: false, phone: state.connectedPhone, session: state.key, provider: 'baileys' };
  }
  const health = await getHealth();
  if (!health.ok) throw notConnectedError(key, false);
  if (!state.ready) await ensureStarted(key);
  if (!state.ready || !state.openwaId) throw notConnectedError(key, health.ok);
  try {
    await openwaRequest('POST', `/sessions/${state.openwaId}/messages/send-text`, {
      chatId,
      text: String(text || ''),
    });
  } catch (err) {
    throw notConnectedError(key, false);
  }
  return { mock: false, phone: state.connectedPhone, session: state.key, provider: 'openwa' };
}

/**
 * @param {string} key
 * @param {string} chatId
 * @param {{ url?: string, base64?: string, mimetype?: string, caption?: string, filePath?: string }} media
 */
async function sendImageForSession(key, chatId, media = {}) {
  const state = getOrCreateState(key);
  if (state.mock) return { mock: true };

  const baileys = require('./whatsappBaileys');
  if (state.transport !== 'baileys' && baileys.hasRegisteredCreds?.(state.key)) {
    state.transport = 'baileys';
  }

  if (state.transport === 'baileys') {
    if (!state.ready) await baileys.ensure(state);
    if (!state.ready) throw notConnectedError(key, true);
    await baileys.sendImage(state.key, chatId, media);
    return { mock: false, phone: state.connectedPhone, session: state.key, provider: 'baileys' };
  }
  const health = await getHealth();
  if (!health.ok) throw notConnectedError(key, false);
  if (!state.ready) await ensureStarted(key);
  if (!state.ready || !state.openwaId) throw notConnectedError(key, health.ok);

  const body = { chatId, caption: media.caption || '' };
  if (media.filePath && fs.existsSync(media.filePath)) {
    const buf = fs.readFileSync(media.filePath);
    body.base64 = buf.toString('base64');
    body.mimetype = media.mimetype || 'image/png';
    body.filename = path.basename(media.filePath);
  } else if (media.base64) {
    body.base64 = media.base64;
    body.mimetype = media.mimetype || 'image/jpeg';
    if (media.filename) body.filename = media.filename;
  } else if (media.url) {
    body.url = media.url;
  } else {
    throw new Error('Image WhatsApp: url, base64 ou filePath requis');
  }

  try {
    await openwaRequest('POST', `/sessions/${state.openwaId}/messages/send-image`, body);
  } catch {
    throw notConnectedError(key, false);
  }
  return { mock: false, phone: state.connectedPhone, session: state.key, provider: 'openwa' };
}

/**
 * Compat ancienne API wwebjs :
 * sendMessageForSession(key, chatId, content, { media, sendOptions })
 */
async function sendMessageForSession(key, chatId, content, options) {
  if (options?.media) {
    const media = options.media;
    const caption = options.sendOptions?.caption || options.caption || '';
    if (media.filePath) {
      return sendImageForSession(key, chatId, {
        filePath: media.filePath,
        mimetype: media.mimetype,
        caption,
      });
    }
    if (media.data && media.mimetype) {
      return sendImageForSession(key, chatId, {
        base64: media.data,
        mimetype: media.mimetype,
        filename: media.filename,
        caption,
      });
    }
    if (media.url || typeof media === 'string') {
      return sendImageForSession(key, chatId, {
        url: media.url || media,
        caption,
      });
    }
  }
  return sendTextForSession(key, chatId, content);
}

async function logoutSession(key) {
  const state = getOrCreateState(key);
  if (state.transport === 'baileys') {
    const baileys = require('./whatsappBaileys');
    await baileys.logout(state.key).catch(() => null);
  } else if (!state.mock && apiKey) {
    try {
      await peekRemoteSession(state);
      if (state.openwaId) {
        try {
          await openwaRequest('POST', `/sessions/${state.openwaId}/logout`);
        } catch {
          try {
            await openwaRequest('POST', `/sessions/${state.openwaId}/stop`);
          } catch {
            /* ignore */
          }
        }
      }
    } catch (err) {
      state.lastError = err.message;
    }
  }
  state.ready = false;
  state.connectedPhone = null;
  state.lastQrDataUrl = null;
  state.pairingCode = null;
  state.pairingPhone = null;
  state.pairingExpiresAt = null;
  state.waState = 'logged_out';
  state.transport = 'openwa';
  return publicStatus(state);
}

const platform = getOrCreateState('platform');

if (mockMode) {
  console.log('[WHATSAPP MOCK] Client simulé (OpenWA désactivé), aucun QR requis.');
} else if (preferBaileys || linkEngine === 'baileys' || linkEngine === 'local') {
  console.log(
    `📡 WhatsApp appairage via Baileys local (WHATSAPP_LINK_ENGINE=${linkEngine}, moteur=${engineName})`,
  );
} else if (!apiKey) {
  console.warn('⚠️ OPENWA_API_KEY manquant — WhatsApp OpenWA inactif jusqu’à configuration.');
} else {
  console.log(
    `📡 WhatsApp via OpenWA → ${baseUrl} (moteur=${engineName}, link=${linkEngine}, fallback Baileys=${allowBaileysFallback})`,
  );
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
/**
 * Démarre (ou force) un appairage par code de jumelage pour une session.
 * @param {string} key
 * @param {string} phoneRaw
 * @param {{ force?: boolean }} [opts]
 */
async function requestPairing(key, phoneRaw, opts = {}) {
  const intl = toWaIntlDigits(phoneRaw);
  if (!intl) {
    const err = new Error(
      'Numéro WhatsApp invalide. Format attendu : 22177XXXXXXX (Sénégal).',
    );
    err.statusCode = 400;
    throw err;
  }
  const state = getOrCreateState(key);
  if (state.mock) {
    return {
      success: false,
      mock: true,
      status: 'DISCONNECTED',
      error: USER_INFRA_ERROR,
      session: state.key,
    };
  }

  if (state.ready && !opts.force) {
    return {
      success: true,
      pairingCode: null,
      pairingCodeDisplay: null,
      status: 'CONNECTED',
      phone: state.connectedPhone,
      session: state.key,
      provider: state.transport || 'baileys',
    };
  }

  const hasValidCode =
    Boolean(state.pairingCode) &&
    state.pairingPhone === intl &&
    (!state.pairingExpiresAt || Date.now() < Number(state.pairingExpiresAt));

  if (hasValidCode && !opts.force) {
    return {
      success: true,
      pairingCode: formatPairingCodeDisplay(state.pairingCode) || state.pairingCode,
      pairingCodeRaw: state.pairingCode,
      pairingPhone: intl,
      pairingExpiresAt: state.pairingExpiresAt,
      status: 'CONNECTING',
      session: state.key,
      provider: state.transport || 'baileys',
    };
  }

  const started = await ensureStarted(state.key, {
    force: true,
    phoneNumber: intl,
  });

  const status = publicStatus(state);
  if (started.mock || status.mock) {
    return {
      success: false,
      mock: true,
      status: 'DISCONNECTED',
      error: USER_INFRA_ERROR,
      session: state.key,
    };
  }

  if (status.connected) {
    return {
      success: true,
      pairingCode: null,
      pairingCodeDisplay: null,
      status: 'CONNECTED',
      phone: status.phone,
      session: state.key,
      provider: status.provider,
    };
  }

  if (!status.pairingCode) {
    const errMsg =
      status.error ||
      state.lastError ||
      'Impossible de générer le code de jumelage. Réessayez dans quelques secondes.';
    return {
      success: false,
      pairingCode: null,
      status: status.status || 'DISCONNECTED',
      error: errMsg,
      session: state.key,
      provider: status.provider,
      initializing: status.initializing,
    };
  }

  return {
    success: true,
    pairingCode: formatPairingCodeDisplay(status.pairingCode) || status.pairingCode,
    pairingCodeRaw: status.pairingCode,
    pairingPhone: intl,
    pairingExpiresAt: status.pairingExpiresAt,
    status: 'CONNECTING',
    session: state.key,
    provider: status.provider,
  };
}

module.exports.getStatus = (key) => getStatus(key);
module.exports.getStatusLite = (key) => getStatusLite(key);
module.exports.getQrPayload = (key) => getQrPayload(key);
module.exports.ensureStarted = (key, opts) => ensureStarted(key || 'platform', opts);
module.exports.requestPairing = requestPairing;
module.exports.sendMessageForSession = sendMessageForSession;
module.exports.sendTextForSession = sendTextForSession;
module.exports.sendImageForSession = sendImageForSession;
module.exports.gerantSessionKey = gerantSessionKey;
module.exports.logoutSession = logoutSession;
module.exports.toWaIntlDigits = toWaIntlDigits;
module.exports.formatPairingCodeDisplay = formatPairingCodeDisplay;
module.exports.connectionStatusOf = connectionStatusOf;
module.exports.getHealth = getHealth;
module.exports.USER_INFRA_ERROR = USER_INFRA_ERROR;
module.exports._state = platform;
module.exports._sessions = sessions;
module.exports.OPENWA_BASE_URL = baseUrl;
