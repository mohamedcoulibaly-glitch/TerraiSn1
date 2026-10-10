/**
 * Client WhatsApp via OpenWA (REST) — plus de whatsapp-web.js / Puppeteer local.
 * Doc: https://docs.open-wa.org/ — serveur: OPENWA_BASE_URL
 */
const fs = require('fs');
const path = require('path');

/** Config OpenWA — relue via reloadConfig() après sauvegarde superadmin. */
const cfg = {
  mockMode: false,
  baseUrl: 'https://mywa.tickets-place.net',
  apiKey: '',
  sessionPrefix: 'terrainsn',
  sharedSessionId: null,
  platformSessionId: null,
};

function readCfgFromEnv() {
  cfg.mockMode = String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true';
  cfg.baseUrl = String(process.env.OPENWA_BASE_URL || 'https://mywa.tickets-place.net').replace(/\/$/, '');
  cfg.apiKey = String(process.env.OPENWA_API_KEY || '').trim();
  cfg.sessionPrefix = String(process.env.OPENWA_SESSION_PREFIX || 'terrainsn').replace(/[^a-zA-Z0-9_-]/g, '');
  cfg.sharedSessionId = String(process.env.OPENWA_SHARED_SESSION_ID || '').trim() || null;
  cfg.platformSessionId = String(process.env.OPENWA_PLATFORM_SESSION_ID || '').trim() || null;
}

readCfgFromEnv();

function reloadConfig() {
  readCfgFromEnv();
  for (const state of sessions.values()) {
    state.mock = cfg.mockMode;
    if (cfg.sharedSessionId) {
      state.openwaId = cfg.sharedSessionId;
    } else if (state.key === 'platform' && cfg.platformSessionId) {
      state.openwaId = cfg.platformSessionId;
    }
  }
  module.exports.OPENWA_BASE_URL = cfg.baseUrl;
  return {
    mockMode: cfg.mockMode,
    baseUrl: cfg.baseUrl,
    hasApiKey: Boolean(cfg.apiKey),
    sessionPrefix: cfg.sessionPrefix,
    sharedSessionId: cfg.sharedSessionId,
    platformSessionId: cfg.platformSessionId,
  };
}

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

function requireConfig() {
  if (cfg.mockMode) return;
  if (!cfg.apiKey) {
    const err = new Error(
      'Clé API OpenWA manquante — configure-la dans Superadmin → Intégrations.'
    );
    err.statusCode = 503;
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
  if (k === 'platform') return `${cfg.sessionPrefix}-platform`;
  const m = /^gerant:(\d+)$/.exec(k);
  if (m) return `${cfg.sessionPrefix}-gerant-${m[1]}`;
  return `${cfg.sessionPrefix}-${k.replace(/:/g, '-')}`;
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
  const sessionKey = sanitizeKey(key);
  const pinnedId =
    cfg.sharedSessionId ||
    (sessionKey === 'platform' ? cfg.platformSessionId : null) ||
    null;
  return {
    key: sessionKey,
    openwaId: pinnedId,
    openwaName: openwaSessionName(sessionKey),
    ready: false,
    mock: cfg.mockMode,
    lastQrDataUrl: null,
    lastError: null,
    initializing: false,
    connectedPhone: null,
    pairingCode: null,
    pairingPhone: null,
    waState: null,
    pinned: Boolean(pinnedId),
    /** Empêche le fallback vers une autre session ready pendant un changement de numéro. */
    lockSession: false,
  };
}

/**
 * Persiste le nouvel UUID de session plateforme (DB + .env + process.env).
 * Sans ça, « Changer de numéro » est écrasé au prochain reload par l’ancien SHARED_SESSION_ID.
 */
function persistPlatformSessionId(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return false;
  cfg.sharedSessionId = id;
  cfg.platformSessionId = id;
  process.env.OPENWA_SHARED_SESSION_ID = id;
  process.env.OPENWA_PLATFORM_SESSION_ID = id;
  try {
    // syncEnvFile synchrone — pas besoin de getDb ici
    const { syncEnvFile } = require('./services/runtimeIntegrations');
    syncEnvFile({
      OPENWA_SHARED_SESSION_ID: id,
      OPENWA_PLATFORM_SESSION_ID: id,
    });
  } catch (err) {
    console.warn('⚠️ Persist session OpenWA (.env):', err.message);
  }
  return true;
}

async function persistPlatformSessionIdInDb(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return false;
  persistPlatformSessionId(id);
  try {
    const { getDb } = require('./database');
    const runtimeIntegrations = require('./services/runtimeIntegrations');
    const db = await getDb();
    runtimeIntegrations.save(db, {
      OPENWA_SHARED_SESSION_ID: id,
      OPENWA_PLATFORM_SESSION_ID: id,
    });
    return true;
  } catch (err) {
    console.warn('⚠️ Persist session OpenWA (DB):', err.message);
    return false;
  }
}

async function destroyRemoteSession(sessionId, { deleteSession = false } = {}) {
  if (!sessionId) return;
  try {
    await openwaRequest('POST', `/sessions/${sessionId}/logout`);
  } catch {
    /* ignore */
  }
  try {
    await openwaRequest('POST', `/sessions/${sessionId}/force-kill`);
  } catch {
    try {
      await openwaRequest('POST', `/sessions/${sessionId}/stop`);
    } catch {
      /* ignore */
    }
  }
  if (deleteSession) {
    try {
      await openwaRequest('DELETE', `/sessions/${sessionId}`);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Prépare une session plateforme dédiée pour lier un NOUVEAU numéro émetteur.
 * Ne réutilise pas une session ready tierce (ex. tickets-place).
 */
async function prepareNumberChange(state, { phoneNumber } = {}) {
  state.lockSession = true;
  state.pinned = false;
  state.ready = false;
  state.connectedPhone = null;
  state.lastQrDataUrl = null;
  state.pairingCode = null;
  state.pairingPhone = null;
  state.lastError = null;
  state.waState = null;

  const previousId = state.openwaId;
  const previousName = state.openwaName;
  state.openwaName = openwaSessionName(state.key); // terrainsn-platform

  // Détacher l’ancien UUID partagé en mémoire (évite de rester collé au même téléphone).
  cfg.sharedSessionId = null;
  cfg.platformSessionId = null;
  delete process.env.OPENWA_SHARED_SESSION_ID;
  delete process.env.OPENWA_PLATFORM_SESSION_ID;

  // Ne supprimer que nos sessions terrainsn-* — jamais une session tierce (tickets-place, etc.).
  const canDelete =
    previousId &&
    (String(previousName || '').startsWith(`${cfg.sessionPrefix}-`) ||
      String(state.openwaName).startsWith(`${cfg.sessionPrefix}-`));

  if (previousId) {
    await destroyRemoteSession(previousId, { deleteSession: Boolean(canDelete) });
  }

  // Session dédiée terrainsn-platform : logout/restart d’abord (QR),
  // puis recreate seulement si nécessaire (évite l’échec Chromium « create »).
  let remote = await findRemoteByName(state.openwaName);
  if (remote?.id) {
    await destroyRemoteSession(remote.id, { deleteSession: false });
    try {
      remote = await openwaRequest('POST', `/sessions/${remote.id}/start`);
    } catch {
      try {
        await destroyRemoteSession(remote.id, { deleteSession: true });
        remote = await openwaRequest('POST', '/sessions', { name: state.openwaName });
        remote = await openwaRequest('POST', `/sessions/${remote.id}/start`);
      } catch (err) {
        const again = await findRemoteByName(state.openwaName);
        if (!again?.id) throw err;
        remote = again;
        console.warn(`⚠️ OpenWA recreate [${state.openwaName}]:`, err.message);
      }
    }
  } else {
    remote = await openwaRequest('POST', '/sessions', { name: state.openwaName });
    try {
      remote = await openwaRequest('POST', `/sessions/${remote.id}/start`);
    } catch (err) {
      console.warn(`⚠️ OpenWA start nouvelle session:`, err.message);
    }
  }

  state.openwaId = remote.id || null;
  applyRemoteSession(state, remote);
  // Après rotation on attend un nouveau scan — ne pas garder l’ancien téléphone.
  if (String(remote.status || '').toLowerCase() === 'ready' && remote.phone) {
    // Session encore authentifiée avec l’ancien numéro : forcer logout + QR.
    await destroyRemoteSession(remote.id, { deleteSession: false });
    try {
      remote = await openwaRequest('POST', `/sessions/${remote.id}/start`);
    } catch {
      /* QR via wait */
    }
    state.openwaId = remote.id || state.openwaId;
    applyRemoteSession(state, remote);
  }
  state.ready = String(remote.status || '').toLowerCase() === 'ready';
  if (!state.ready) state.connectedPhone = null;

  await waitForQrOrReady(state, 45000);

  if (phoneNumber && !state.ready) {
    await requestPairingCode(state, phoneNumber);
  }

  if (state.openwaId) {
    await persistPlatformSessionIdInDb(state.openwaId);
    state.pinned = true;
  }

  // QR / pairing obtenus → ne pas remonter une erreur liée à l’ancienne session.
  if (state.lastQrDataUrl || state.pairingCode || state.ready) {
    state.lastError = null;
  }

  if (state.ready) {
    state.lockSession = false;
  }

  return state;
}

function getOrCreateState(key) {
  const sessionKey = sanitizeKey(key || 'platform');
  if (!sessions.has(sessionKey)) {
    sessions.set(sessionKey, createSessionState(sessionKey));
  }
  return sessions.get(sessionKey);
}

function publicStatus(state) {
  return {
    session: state.key,
    connected: state.ready,
    mock: state.mock,
    hasQr: Boolean(state.lastQrDataUrl),
    initializing: state.initializing,
    error: state.lastError,
    phone: state.connectedPhone,
    pairingCode: state.pairingCode,
    pairingPhone: state.pairingPhone,
    waState: state.waState || null,
    provider: 'openwa',
    openwaSessionId: state.openwaId,
    openwaSessionName: state.openwaName,
    changingNumber: Boolean(state.lockSession && !state.ready),
    qrPage: state.key === 'platform' ? '/whatsapp-qr' : '/backoffice/gerant',
  };
}

function applyRemoteSession(state, remote) {
  if (!remote) return;
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
  } else if (remote.lastError) {
    const raw = String(remote.lastError);
    if (/Failed to launch the browser|puppeteer|Permission denied/i.test(raw)) {
      state.lastError =
        'OpenWA ne peut pas démarrer Chromium sur le serveur. Passez ENGINE_TYPE=baileys, ou définissez OPENWA_SHARED_SESSION_ID avec une session déjà connectée.';
    } else {
      state.lastError = raw.slice(0, 500);
    }
  }
  const bootstrapping = ['initializing', 'qr_ready', 'authenticating', 'starting'].includes(status);
  if (bootstrapping) state.initializing = true;
  if (['ready', 'failed', 'disconnected', 'stopped', 'created', 'logged_out'].includes(status)) {
    state.initializing = false;
  }
}

async function openwaRequest(method, apiPath, body) {
  requireConfig();
  const url = `${cfg.baseUrl}/api${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
  const headers = {
    'X-API-Key': cfg.apiKey,
    Accept: 'application/json',
  };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
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
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.statusCode = res.status;
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

async function ensureRemoteSession(state) {
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
  let remote = await findRemoteByName(state.openwaName);
  if (!remote) {
    remote = await openwaRequest('POST', '/sessions', { name: state.openwaName });
    console.log(`🆕 OpenWA session créée [${state.key}] name=${state.openwaName} id=${remote.id}`);
  }
  applyRemoteSession(state, remote);
  return remote;
}

/**
 * Garantit une session OpenWA réellement prête pour l’envoi.
 * Si la session configurée est failed / qr_ready / disconnected :
 * 1) tentative de start
 * 2) fallback sur la première session `ready` du serveur (même compte API)
 *    — désactivé pendant un changement de numéro (lockSession).
 */
async function ensureReadyForSend(state) {
  await ensureRemoteSession(state);
  if (state.ready && state.openwaId) {
    state.lockSession = false;
    return state;
  }

  const status = String(state.waState || '').toLowerCase();
  if (state.openwaId && !['initializing', 'authenticating', 'starting'].includes(status)) {
    try {
      await startRemote(state);
    } catch (err) {
      console.warn(`⚠️ OpenWA start [${state.key}]:`, err.message);
    }
  }

  if (!state.ready && state.openwaId) {
    await waitForQrOrReady(state, 12000);
  }
  if (state.ready && state.openwaId) {
    state.lockSession = false;
    return state;
  }

  if (state.lockSession) {
    return state;
  }

  try {
    const all = await listRemoteSessions();
    const preferredIds = [cfg.sharedSessionId, cfg.platformSessionId].filter(Boolean);
    const readyList = all.filter((s) => s && s.id && String(s.status || '').toLowerCase() === 'ready');
    const preferredReady = readyList.find((s) => preferredIds.includes(s.id));
    const prefixReady = readyList.find(
      (s) => String(s.name || '').startsWith(`${cfg.sessionPrefix}-`),
    );
    const fallback = preferredReady || prefixReady || readyList[0] || null;
    if (fallback) {
      console.warn(
        `⚠️ OpenWA [${state.key}] session ${state.openwaId || '—'} non ready`
          + ` → fallback ready « ${fallback.name} » (${fallback.id})`,
      );
      state.openwaId = fallback.id;
      applyRemoteSession(state, fallback);
      return state;
    }
  } catch (err) {
    console.warn(`⚠️ OpenWA fallback ready [${state.key}]:`, err.message);
  }
  return state;
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
    console.warn(`⚠️ Pairing OpenWA [${state.key}]:`, err.message);
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
  const remote = await openwaRequest('POST', '/sessions', { name: state.openwaName });
  applyRemoteSession(state, remote);
  console.log(`♻️ OpenWA session recréée [${state.key}] id=${remote.id}`);
  return remote;
}

async function startRemote(state) {
  if (!state.openwaId) await ensureRemoteSession(state);
  let status = String(state.waState || '').toLowerCase();
  if (status === 'ready') return;
  if (['initializing', 'qr_ready', 'authenticating'].includes(status)) return;

  if (['failed', 'logged_out'].includes(status)) {
    await recreateRemoteSession(state);
    status = String(state.waState || '').toLowerCase();
  }

  try {
    const remote = await openwaRequest('POST', `/sessions/${state.openwaId}/start`);
    applyRemoteSession(state, remote);
  } catch (err) {
    // Déjà démarrée ou zombie → vérifier / recréer si failed
    if (err.statusCode === 400 || err.statusCode === 409) {
      const remote = await openwaRequest('GET', `/sessions/${state.openwaId}`);
      applyRemoteSession(state, remote);
      if (['failed', 'logged_out'].includes(String(remote.status || '').toLowerCase())) {
        await recreateRemoteSession(state);
        const restarted = await openwaRequest('POST', `/sessions/${state.openwaId}/start`);
        applyRemoteSession(state, restarted);
      }
      return;
    }
    throw err;
  }
}

async function waitForQrOrReady(state, ms = 45000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const remote = await openwaRequest('GET', `/sessions/${state.openwaId}`);
      applyRemoteSession(state, remote);
    } catch (err) {
      state.lastError = err.message;
    }
    if (state.ready) return;
    await fetchQr(state).catch(() => null);
    if (state.lastQrDataUrl || state.pairingCode) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 1200));
  }
}

/**
 * @param {string} key
 * @param {{ force?: boolean, changeNumber?: boolean, phoneNumber?: string }} [opts]
 */
async function ensureStarted(key = 'platform', opts = {}) {
  const state = getOrCreateState(key);
  if (state.mock) return { mock: true, ready: false, session: state.key, provider: 'openwa' };

  requireConfig();

  const changeNumber = Boolean(opts.changeNumber || opts.force);

  if (state.ready && !changeNumber) {
    return {
      mock: false,
      ready: true,
      connected: true,
      session: state.key,
      phone: state.connectedPhone,
      openwaSessionId: state.openwaId,
      provider: 'openwa',
    };
  }

  if (state.initializing && !changeNumber) {
    await waitForQrOrReady(state, 30000);
    if (opts.phoneNumber && !state.ready) {
      await requestPairingCode(state, opts.phoneNumber);
    }
    return {
      mock: false,
      ready: state.ready,
      connected: state.ready,
      session: state.key,
      phone: state.connectedPhone,
      initializing: state.initializing,
      error: state.lastError,
      pairingCode: state.pairingCode,
      pairingPhone: state.pairingPhone,
      openwaSessionId: state.openwaId,
      provider: 'openwa',
    };
  }

  state.initializing = true;
  state.lastError = null;

  try {
    if (changeNumber && state.key === 'platform') {
      // Changement de numéro émetteur : nouvelle session dédiée + QR / pairing.
      await prepareNumberChange(state, { phoneNumber: opts.phoneNumber });
    } else if (changeNumber) {
      // Gérant : logout + recréation de sa session dédiée.
      state.lockSession = true;
      state.pinned = false;
      state.lastQrDataUrl = null;
      state.pairingCode = null;
      state.pairingPhone = null;
      state.ready = false;
      state.connectedPhone = null;
      if (state.openwaId) {
        await destroyRemoteSession(state.openwaId, { deleteSession: true });
        state.openwaId = null;
      }
      await ensureRemoteSession(state);
      await startRemote(state);
      await waitForQrOrReady(state, 45000);
      if (opts.phoneNumber && !state.ready) {
        await requestPairingCode(state, opts.phoneNumber);
      }
      if (state.ready) state.lockSession = false;
    } else {
      await ensureRemoteSession(state);
      await startRemote(state);
      await waitForQrOrReady(state, 45000);
      if (opts.phoneNumber && !state.ready) {
        await requestPairingCode(state, opts.phoneNumber);
      }
    }

    if (state.ready) {
      state.lockSession = false;
      console.log(
        `✅ WhatsApp OpenWA connecté [${state.key}]${state.connectedPhone ? ` ${state.connectedPhone}` : ''}`
      );
    } else if (state.lastQrDataUrl || state.pairingCode) {
      if (state.key === 'platform') {
        console.log(
          `📱 QR / pairing WhatsApp plateforme : http://localhost:${process.env.PORT || 3001}/whatsapp-qr`
        );
      } else {
        console.log(`📱 QR WhatsApp OpenWA [${state.key}] prêt (espace gérant)`);
      }
    }
  } catch (error) {
    state.lastError = error.message || String(error);
    console.error(`❌ OpenWA ensureStarted [${state.key}]:`, state.lastError);
  } finally {
    state.initializing = false;
  }

  return {
    mock: false,
    ready: state.ready,
    connected: state.ready,
    session: state.key,
    phone: state.connectedPhone,
    error: state.lastError,
    pairingCode: state.pairingCode,
    pairingPhone: state.pairingPhone,
    openwaSessionId: state.openwaId,
    openwaSessionName: state.openwaName,
    changingNumber: Boolean(state.lockSession && !state.ready),
    provider: 'openwa',
  };
}

async function refreshState(key = 'platform') {
  const state = getOrCreateState(key);
  if (state.mock) return publicStatus(state);
  if (!cfg.apiKey) {
    state.lastError = 'Clé API OpenWA manquante';
    return publicStatus(state);
  }
  try {
    await ensureRemoteSession(state);
    if (!state.ready && state.openwaId) {
      await fetchQr(state).catch(() => null);
    }
  } catch (err) {
    state.lastError = err.message;
  }
  return publicStatus(state);
}

async function getStatus(key = 'platform') {
  return refreshState(key);
}

async function getQrPayload(key = 'platform') {
  const state = getOrCreateState(key);
  if (!state.mock && cfg.apiKey) {
    try {
      await ensureRemoteSession(state);
      if (!state.ready) await fetchQr(state).catch(() => null);
    } catch (err) {
      state.lastError = err.message;
    }
  }
  return {
    qr: null,
    dataUrl: state.lastQrDataUrl,
    connected: state.ready,
    mock: state.mock,
    phone: state.connectedPhone,
    session: state.key,
    initializing: state.initializing,
    error: state.lastError,
    pairingCode: state.pairingCode,
    pairingPhone: state.pairingPhone,
    waState: state.waState || null,
    provider: 'openwa',
  };
}

async function sendTextForSession(key, chatId, text) {
  try {
    return await sendTextForSessionOnce(key, chatId, text);
  } catch (err) {
    // Notifs joueur ciblent souvent gerant:N — si non connecté, basculer sur la session plateforme.
    if (key && key !== 'platform' && Number(err.statusCode) === 503) {
      console.warn(`⚠️ WhatsApp [${key}] indisponible → fallback session platform`);
      return sendTextForSessionOnce('platform', chatId, text);
    }
    throw err;
  }
}

async function sendTextForSessionOnce(key, chatId, text) {
  const state = getOrCreateState(key);
  if (state.mock) return { mock: true };
  requireConfig();
  await ensureReadyForSend(state);
  if (!state.ready || !state.openwaId) {
    const err = new Error(
      key === 'platform'
        ? 'WhatsApp plateforme non connecté. Ouvrez /whatsapp-qr ou configurez OPENWA_SHARED_SESSION_ID avec une session ready.'
        : 'WhatsApp du gérant non connecté. Scannez le QR dans l’espace gérant.',
    );
    err.statusCode = 503;
    throw err;
  }
  try {
    await openwaRequest('POST', `/sessions/${state.openwaId}/messages/send-text`, {
      chatId,
      text: String(text || ''),
    });
  } catch (err) {
    // Session tombée entre-temps → un seul retry via fallback ready.
    if ([400, 404, 409, 500, 502, 503].includes(Number(err.statusCode))) {
      state.ready = false;
      await ensureReadyForSend(state);
      if (!state.ready || !state.openwaId) throw err;
      await openwaRequest('POST', `/sessions/${state.openwaId}/messages/send-text`, {
        chatId,
        text: String(text || ''),
      });
    } else {
      throw err;
    }
  }
  return { mock: false, phone: state.connectedPhone, session: state.key, provider: 'openwa' };
}

/**
 * @param {string} key
 * @param {string} chatId
 * @param {{ url?: string, base64?: string, mimetype?: string, caption?: string, filePath?: string }} media
 */
async function sendImageForSession(key, chatId, media = {}) {
  try {
    return await sendImageForSessionOnce(key, chatId, media);
  } catch (err) {
    if (key && key !== 'platform' && Number(err.statusCode) === 503) {
      console.warn(`⚠️ WhatsApp image [${key}] indisponible → fallback session platform`);
      return sendImageForSessionOnce('platform', chatId, media);
    }
    throw err;
  }
}

async function sendImageForSessionOnce(key, chatId, media = {}) {
  const state = getOrCreateState(key);
  if (state.mock) return { mock: true };
  requireConfig();
  await ensureReadyForSend(state);
  if (!state.ready || !state.openwaId) {
    const err = new Error(
      key === 'platform'
        ? 'WhatsApp plateforme non connecté. Ouvrez /whatsapp-qr ou configurez OPENWA_SHARED_SESSION_ID avec une session ready.'
        : 'WhatsApp du gérant non connecté. Scannez le QR dans l’espace gérant.',
    );
    err.statusCode = 503;
    throw err;
  }

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
    // URL relative (Render free sans disque) → absolue via APP_DOMAIN
    const raw = String(media.url);
    if (raw.startsWith('/') && process.env.APP_DOMAIN) {
      body.url = `${String(process.env.APP_DOMAIN).replace(/\/$/, '')}${raw}`;
    } else {
      body.url = raw;
    }
  } else {
    throw new Error('Image WhatsApp: url, base64 ou filePath requis');
  }

  try {
    await openwaRequest('POST', `/sessions/${state.openwaId}/messages/send-image`, body);
  } catch (err) {
    if ([400, 404, 409, 500, 502, 503].includes(Number(err.statusCode))) {
      state.ready = false;
      await ensureReadyForSend(state);
      if (!state.ready || !state.openwaId) throw err;
      await openwaRequest('POST', `/sessions/${state.openwaId}/messages/send-image`, body);
    } else {
      throw err;
    }
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
  if (!state.mock && cfg.apiKey) {
    try {
      await ensureRemoteSession(state);
      if (state.openwaId) {
        const ownSession = String(state.openwaName || '').startsWith(`${cfg.sessionPrefix}-`);
        await destroyRemoteSession(state.openwaId, { deleteSession: ownSession });
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
  state.waState = 'logged_out';
  state.lockSession = false;
  return publicStatus(state);
}

const platform = getOrCreateState('platform');

if (cfg.mockMode) {
  console.log('[WHATSAPP MOCK] Client simulé (OpenWA désactivé), aucun QR requis.');
} else if (!cfg.apiKey) {
  console.warn('⚠️ Clé API OpenWA manquante — WhatsApp inactif jusqu’à configuration (Superadmin → Intégrations).');
} else {
  console.log(`📡 WhatsApp via OpenWA → ${cfg.baseUrl}`);
  setTimeout(() => {
    ensureStarted('platform').catch((err) => console.error('❌ OpenWA platform start:', err.message));
  }, 3000);
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
module.exports.ensureStarted = (key, opts) => ensureStarted(key || 'platform', opts);
module.exports.sendMessageForSession = sendMessageForSession;
module.exports.sendTextForSession = sendTextForSession;
module.exports.sendImageForSession = sendImageForSession;
module.exports.gerantSessionKey = gerantSessionKey;
module.exports.logoutSession = logoutSession;
module.exports.toWaIntlDigits = toWaIntlDigits;
module.exports.reloadConfig = reloadConfig;
module.exports._state = platform;
module.exports._sessions = sessions;
module.exports.OPENWA_BASE_URL = cfg.baseUrl;
