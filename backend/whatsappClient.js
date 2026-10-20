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

/** Durée de validité affichée / suivie pour un code de jumelage (ms). Défaut 5 min. */
const PAIRING_TTL_MS = Math.max(
  60_000,
  Number(process.env.OPENWA_PAIRING_TTL_MS) || 5 * 60 * 1000,
);
/** Timeout HTTP vers OpenWA (ms). */
const OPENWA_HTTP_TIMEOUT_MS = Math.max(
  10_000,
  Number(process.env.OPENWA_HTTP_TIMEOUT_MS) || 45_000,
);
/** Attente max d’un état session apte au pairing (ms). */
const PAIRING_WAIT_MS = Math.max(
  20_000,
  Number(process.env.OPENWA_PAIRING_WAIT_MS) || 75_000,
);

function isPlatformSharedId(id) {
  const sid = String(id || '').trim();
  if (!sid) return false;
  return (
    (cfg.sharedSessionId && sid === cfg.sharedSessionId) ||
    (cfg.platformSessionId && sid === cfg.platformSessionId)
  );
}

function reloadConfig() {
  readCfgFromEnv();
  for (const state of sessions.values()) {
    state.mock = cfg.mockMode;
    // Le pin SHARED / PLATFORM ne s’applique QU’à la session plateforme —
    // jamais aux gérants (sinon on poll la mauvaise session après jumelage).
    if (state.key === 'platform') {
      if (cfg.sharedSessionId) {
        state.openwaId = cfg.sharedSessionId;
        state.pinned = true;
      } else if (cfg.platformSessionId) {
        state.openwaId = cfg.platformSessionId;
        state.pinned = true;
      }
    } else if (state.pinned || isPlatformSharedId(state.openwaId)) {
      state.pinned = false;
      if (isPlatformSharedId(state.openwaId)) state.openwaId = null;
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
    pairingTtlMs: PAIRING_TTL_MS,
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
 * @property {number|null} pairingExpiresAt
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
  const raw = String(key || 'platform');
  const dashed = /^gerant-(\d+)$/.exec(raw);
  if (dashed) return `gerant:${dashed[1]}`;
  return raw.replace(/[^a-zA-Z0-9:_-]/g, '_');
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
  // Pin SHARED uniquement pour la plateforme — les gérants ont leur session dédiée terrainsn-gerant-N.
  const pinnedId =
    sessionKey === 'platform'
      ? cfg.sharedSessionId || cfg.platformSessionId || null
      : null;
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
    pairingExpiresAt: null,
    waState: null,
    pinned: Boolean(pinnedId),
    /** Empêche le fallback vers une autre session ready pendant un changement de numéro. */
    lockSession: false,
    _pairingRefreshInFlight: false,
    _lastPairingRefreshAt: 0,
  };
}

function clearPairingState(state) {
  state.pairingCode = null;
  state.pairingPhone = null;
  state.pairingExpiresAt = null;
}

function isPairingCodeFresh(state, phoneIntl, { skewMs = 15_000 } = {}) {
  if (!state.pairingCode || !state.pairingExpiresAt) return false;
  if (phoneIntl && state.pairingPhone !== phoneIntl) return false;
  return Date.now() < Number(state.pairingExpiresAt) - skewMs;
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
  clearPairingState(state);
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
  {
    const st = String(remote.status || '').toLowerCase();
    if ((st === 'ready' || st === 'action_required') && remote.phone) {
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
  }
  {
    const st = String(remote.status || '').toLowerCase();
    state.ready = st === 'ready' || st === 'action_required';
  }
  if (!state.ready) state.connectedPhone = null;

  await waitForQrOrReady(state, PAIRING_WAIT_MS);

  if (phoneNumber && !state.ready) {
    await requestPairingCode(state, phoneNumber, { force: true });
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

function connectionStatusLabel(state) {
  if (state.ready) return 'CONNECTED';
  const wa = String(state.waState || '').toLowerCase();
  // qr_ready = en attente d’un code/QR utilisateur → pas « CONNECTING » (sinon UI en boucle).
  if (state.initializing || ['authenticating', 'initializing', 'starting'].includes(wa)) {
    return 'CONNECTING';
  }
  if (state.pairingCode && isPairingCodeFresh(state, state.pairingPhone, { skewMs: 0 })) {
    return 'CONNECTING';
  }
  return 'DISCONNECTED';
}

function publicStatus(state) {
  const pairingFresh = isPairingCodeFresh(state, state.pairingPhone, { skewMs: 0 });
  const status = connectionStatusLabel(state);
  return {
    session: state.key,
    connected: state.ready,
    status,
    mock: state.mock,
    hasQr: Boolean(state.lastQrDataUrl),
    initializing: state.initializing,
    error: state.lastError,
    phone: state.connectedPhone,
    pairingCode: pairingFresh && !state.ready ? state.pairingCode : null,
    pairingPhone: state.pairingPhone,
    pairingExpiresAt: pairingFresh && !state.ready ? state.pairingExpiresAt : null,
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
  // ready = lié et utilisable ; action_required = lié mais action UI côté WA (on confirme quand même).
  state.ready = status === 'ready' || status === 'action_required';
  // Téléphone OpenWA stale possible en qr_ready après un drop — ne le garder que si vraiment lié.
  if (state.ready && remote.phone) {
    state.connectedPhone = String(remote.phone).replace(/\D/g, '');
  } else if (!state.ready) {
    state.connectedPhone = null;
  }
  if (state.ready) {
    state.lastQrDataUrl = null;
    clearPairingState(state);
    state.lastError = status === 'action_required' && remote.lastError
      ? String(remote.lastError).slice(0, 500)
      : null;
    state.lockSession = false;
    state.initializing = false;
  } else if (remote.lastError) {
    const raw = String(remote.lastError);
    if (/Failed to launch the browser|puppeteer|Permission denied/i.test(raw)) {
      state.lastError =
        'OpenWA ne peut pas démarrer Chromium sur le serveur. Passez ENGINE_TYPE=baileys, ou définissez OPENWA_SHARED_SESSION_ID avec une session déjà connectée.';
    } else {
      state.lastError = raw.slice(0, 500);
    }
  }
  // qr_ready = prêt pour code/QR (action user) — PAS un bootstrap bloquant.
  const bootstrapping = ['initializing', 'authenticating', 'starting'].includes(status);
  if (bootstrapping) state.initializing = true;
  if (
    ['ready', 'action_required', 'failed', 'disconnected', 'stopped', 'created', 'logged_out', 'qr_ready'].includes(
      status,
    )
  ) {
    state.initializing = false;
  }
}

async function openwaRequest(method, apiPath, body, { timeoutMs = OPENWA_HTTP_TIMEOUT_MS } = {}) {
  requireConfig();
  const url = `${cfg.baseUrl}/api${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
  const headers = {
    'X-API-Key': cfg.apiKey,
    Accept: 'application/json',
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const init = { method, headers, signal: controller.signal };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  try {
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
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutErr = new Error(
        `OpenWA ${method} ${apiPath} → timeout après ${Math.round(timeoutMs / 1000)}s`,
      );
      timeoutErr.statusCode = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
  // Gérant : ne jamais rester collé à l’UUID plateforme partagé.
  if (state.key !== 'platform' && (state.pinned || isPlatformSharedId(state.openwaId))) {
    console.warn(
      `⚠️ OpenWA [${state.key}] détache UUID plateforme`
        + ` → recherche dédiée « ${state.openwaName} »`,
    );
    state.pinned = false;
    if (isPlatformSharedId(state.openwaId)) {
      state.openwaId = null;
      state.ready = false;
    }
  }

  // Session pinnée (OPENWA_SHARED_SESSION_ID) : plateforme uniquement.
  if (state.key === 'platform' && state.pinned && state.openwaId) {
    try {
      const remote = await openwaRequest('GET', `/sessions/${state.openwaId}`);
      applyRemoteSession(state, remote);
      return remote;
    } catch (err) {
      if (err.statusCode !== 404) throw err;
      console.warn(
        `⚠️ OpenWA [${state.key}] session pinnée ${state.openwaId} introuvable (404)`
          + ` → détache pin, recherche par nom « ${state.openwaName} »`,
      );
      state.pinned = false;
      state.openwaId = null;
      state.ready = false;
      cfg.sharedSessionId = null;
      cfg.platformSessionId = null;
      delete process.env.OPENWA_SHARED_SESSION_ID;
      delete process.env.OPENWA_PLATFORM_SESSION_ID;
    }
  }
  if (state.openwaId) {
    try {
      const remote = await openwaRequest('GET', `/sessions/${state.openwaId}`);
      // Si l’UUID pointe vers une autre session (ex. plateforme), basculer sur le nom dédié.
      if (
        state.key !== 'platform' &&
        remote?.name &&
        String(remote.name) !== String(state.openwaName)
      ) {
        console.warn(
          `⚠️ OpenWA [${state.key}] UUID ${state.openwaId} = « ${remote.name} »`
            + ` ≠ « ${state.openwaName} » → rebind par nom`,
        );
        state.openwaId = null;
        state.ready = false;
      } else {
        applyRemoteSession(state, remote);
        return remote;
      }
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
  // Si on a retrouvé une session ready après pin mort, re-persister le bon UUID.
  if (state.key === 'platform' && state.ready && state.openwaId) {
    await persistPlatformSessionIdInDb(state.openwaId).catch(() => {});
    state.pinned = true;
  }
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

/** États OpenWA où un code de jumelage peut être demandé. */
function isPairableWaState(status) {
  const s = String(status || '').toLowerCase();
  return ['qr_ready', 'initializing', 'authenticating', 'starting', 'created', 'stopped', 'disconnected', 'logged_out'].includes(s)
    || !s;
}

async function waitUntilPairable(state, ms = PAIRING_WAIT_MS) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!state.openwaId) return false;
    try {
      const remote = await openwaRequest('GET', `/sessions/${state.openwaId}`);
      applyRemoteSession(state, remote);
    } catch (err) {
      state.lastError = err.message;
    }
    if (state.ready) return true;
    const status = String(state.waState || '').toLowerCase();
    if (status === 'failed') {
      try {
        await recreateRemoteSession(state);
        await startRemote(state);
      } catch (err) {
        state.lastError = err.message;
      }
    } else if (isPairableWaState(status)) {
      await fetchQr(state).catch(() => null);
      // QR disponible ou statut qr_ready → on peut demander le pairing.
      if (state.lastQrDataUrl || status === 'qr_ready' || status === 'initializing' || status === 'authenticating') {
        return true;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 1500));
  }
  return Boolean(state.openwaId && !state.ready);
}

/**
 * Demande un code de jumelage OpenWA, avec retries et TTL serveur.
 * @param {SessionState} state
 * @param {string} phoneRaw
 * @param {{ force?: boolean }} [opts]
 */
async function requestPairingCode(state, phoneRaw, opts = {}) {
  const force = Boolean(opts.force);
  const intl = toWaIntlDigits(phoneRaw);
  if (!intl || state.ready) return null;
  if (!state.openwaId) {
    try {
      await ensureRemoteSession(state);
    } catch (err) {
      state.lastError = err.message;
      return null;
    }
  }
  if (!state.openwaId) return null;

  if (!force && isPairingCodeFresh(state, intl)) {
    return state.pairingCode;
  }

  await waitUntilPairable(state, PAIRING_WAIT_MS);
  if (state.ready) return null;

  const maxAttempts = 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      state.pairingPhone = intl;
      const result = await openwaRequest(
        'POST',
        `/sessions/${state.openwaId}/pairing-code`,
        { phoneNumber: intl },
        { timeoutMs: OPENWA_HTTP_TIMEOUT_MS },
      );
      const code = result?.pairingCode || result?.code || null;
      if (code) {
        state.pairingCode = String(code).replace(/[\s-]/g, '');
        state.pairingExpiresAt = Date.now() + PAIRING_TTL_MS;
        state._lastPairingRefreshAt = Date.now();
        state.lastError = null;
        if (result?.status) state.waState = String(result.status);
        console.log(
          `🔑 Code d'appairage OpenWA [${state.key}]: ${state.pairingCode}`
            + ` (expire ${new Date(state.pairingExpiresAt).toISOString()}, essai ${attempt}/${maxAttempts})`,
        );
        return state.pairingCode;
      }
      lastErr = new Error('OpenWA a répondu sans code de jumelage');
    } catch (err) {
      lastErr = err;
      console.warn(
        `⚠️ Pairing OpenWA [${state.key}] essai ${attempt}/${maxAttempts}:`,
        err.message,
      );
      const status = Number(err.statusCode);
      // Session pas prête / zombie → relancer / recréer avant le prochain essai
      if ([400, 404, 409, 500, 502, 503, 504].includes(status) || err.name === 'AbortError') {
        try {
          if (status === 404 || status === 500) {
            // 500 fréquent sur session qr_ready « fantôme » (phone stale) → recreate.
            await recreateRemoteSession(state);
          }
          await startRemote(state);
          await waitUntilPairable(state, Math.min(30_000, PAIRING_WAIT_MS));
          if (state.ready) return null;
        } catch (restartErr) {
          console.warn(`⚠️ Restart avant retry pairing [${state.key}]:`, restartErr.message);
        }
      }
    }
    if (attempt < maxAttempts) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  state.lastError =
    lastErr?.message ||
    'Impossible de générer le code WhatsApp. Réessayez dans quelques secondes.';
  return null;
}

/**
 * Renouvelle le code si expiré / bientôt expiré (polling statut gérant).
 */
async function refreshPairingIfNeeded(state) {
  if (state.ready || state.mock || !state.pairingPhone || !state.openwaId) return;
  if (state._pairingRefreshInFlight) return;
  const wa = String(state.waState || '').toLowerCase();
  // Ne pas régénérer pendant le handshake post-jumelage.
  if (['authenticating', 'action_required', 'initializing', 'starting'].includes(wa)) return;
  // qr_ready / disconnected : on peut (re)demander un code.
  const fresh = isPairingCodeFresh(state, state.pairingPhone, { skewMs: 30_000 });
  if (fresh) return;
  if (Date.now() - (state._lastPairingRefreshAt || 0) < 20_000) return;

  state._pairingRefreshInFlight = true;
  try {
    await requestPairingCode(state, state.pairingPhone, { force: true });
  } catch (err) {
    console.warn(`⚠️ Auto-refresh pairing [${state.key}]:`, err.message);
  } finally {
    state._pairingRefreshInFlight = false;
  }
}

/**
 * Force recreate + pairing pour une session gérant (plus robuste que destroy sec).
 */
async function prepareGerantPairing(state, phoneNumber) {
  state.lockSession = true;
  state.pinned = false;
  state.ready = false;
  state.connectedPhone = null;
  state.lastQrDataUrl = null;
  clearPairingState(state);
  state.lastError = null;
  state.waState = null;

  const previousId = state.openwaId;
  // Ne jamais logout/kill la session plateforme partagée depuis un flux gérant.
  if (previousId && isPlatformSharedId(previousId)) {
    console.warn(
      `⚠️ OpenWA [${state.key}] ignore destroy de la session plateforme ${previousId}`,
    );
    state.openwaId = null;
  } else if (previousId) {
    // Logout d’abord (garder la session nommée), puis recreate si start échoue.
    await destroyRemoteSession(previousId, { deleteSession: false });
  }

  let remote = await findRemoteByName(state.openwaName);
  if (remote?.id) {
    state.openwaId = remote.id;
    applyRemoteSession(state, remote);
    try {
      remote = await openwaRequest('POST', `/sessions/${remote.id}/start`);
      applyRemoteSession(state, remote);
    } catch {
      try {
        await destroyRemoteSession(remote.id, { deleteSession: true });
        remote = await openwaRequest('POST', '/sessions', { name: state.openwaName });
        remote = await openwaRequest('POST', `/sessions/${remote.id}/start`);
        applyRemoteSession(state, remote);
      } catch (err) {
        const again = await findRemoteByName(state.openwaName);
        if (!again?.id) throw err;
        state.openwaId = again.id;
        applyRemoteSession(state, again);
        console.warn(`⚠️ OpenWA gerant recreate [${state.openwaName}]:`, err.message);
      }
    }
  } else {
    await ensureRemoteSession(state);
    await startRemote(state);
  }

  // Si encore authentifiée avec un ancien numéro → forcer un nouveau cycle QR/pairing.
  if (state.ready) {
    await destroyRemoteSession(state.openwaId, { deleteSession: false });
    state.ready = false;
    state.connectedPhone = null;
    try {
      const restarted = await openwaRequest('POST', `/sessions/${state.openwaId}/start`);
      applyRemoteSession(state, restarted);
    } catch {
      /* wait ci-dessous */
    }
  }

  await waitForQrOrReady(state, PAIRING_WAIT_MS);

  if (phoneNumber && !state.ready) {
    await requestPairingCode(state, phoneNumber, { force: true });
  }

  if (state.ready) state.lockSession = false;
  if (state.lastQrDataUrl || state.pairingCode || state.ready) {
    state.lastError = null;
  }
  return state;
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
  clearPairingState(state);
  const remote = await openwaRequest('POST', '/sessions', { name: state.openwaName });
  applyRemoteSession(state, remote);
  console.log(`♻️ OpenWA session recréée [${state.key}] id=${remote.id}`);
  return remote;
}

async function startRemote(state) {
  if (!state.openwaId) await ensureRemoteSession(state);
  let status = String(state.waState || '').toLowerCase();
  if (status === 'ready' || status === 'action_required') return;
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

async function waitForQrOrReady(state, ms = PAIRING_WAIT_MS) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!state.openwaId) return;
    try {
      const remote = await openwaRequest('GET', `/sessions/${state.openwaId}`);
      applyRemoteSession(state, remote);
    } catch (err) {
      state.lastError = err.message;
      if (Number(err.statusCode) === 404) {
        state.openwaId = null;
        return;
      }
    }
    if (state.ready) return;
    const status = String(state.waState || '').toLowerCase();
    if (status === 'failed') {
      try {
        await recreateRemoteSession(state);
        await startRemote(state);
      } catch (restartErr) {
        state.lastError = restartErr.message;
      }
    }
    await fetchQr(state).catch(() => null);
    if (state.lastQrDataUrl || state.pairingCode) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 1500));
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
    await waitForQrOrReady(state, Math.min(45_000, PAIRING_WAIT_MS));
    if (opts.phoneNumber && !state.ready) {
      await requestPairingCode(state, opts.phoneNumber, { force: Boolean(opts.force) });
    }
    const pairingFresh = isPairingCodeFresh(state, state.pairingPhone, { skewMs: 0 });
    return {
      mock: false,
      ready: state.ready,
      connected: state.ready,
      session: state.key,
      phone: state.connectedPhone,
      initializing: state.initializing,
      error: state.lastError,
      pairingCode: pairingFresh ? state.pairingCode : null,
      pairingPhone: state.pairingPhone,
      pairingExpiresAt: pairingFresh ? state.pairingExpiresAt : null,
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
      // Gérant : cycle logout/start robuste + code de jumelage.
      await prepareGerantPairing(state, opts.phoneNumber);
    } else {
      await ensureRemoteSession(state);
      await startRemote(state);
      await waitForQrOrReady(state, PAIRING_WAIT_MS);
      if (opts.phoneNumber && !state.ready) {
        await requestPairingCode(state, opts.phoneNumber, { force: false });
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
        console.log(
          `📱 Pairing WhatsApp OpenWA [${state.key}] prêt`
            + (state.pairingCode ? ` code=${state.pairingCode}` : ''),
        );
      }
    }
  } catch (error) {
    state.lastError = error.message || String(error);
    console.error(`❌ OpenWA ensureStarted [${state.key}]:`, state.lastError);
  } finally {
    state.initializing = false;
  }

  const pairingFresh = isPairingCodeFresh(state, state.pairingPhone, { skewMs: 0 });
  return {
    mock: false,
    ready: state.ready,
    connected: state.ready,
    session: state.key,
    phone: state.connectedPhone,
    error: state.lastError,
    pairingCode: pairingFresh ? state.pairingCode : null,
    pairingPhone: state.pairingPhone,
    pairingExpiresAt: pairingFresh ? state.pairingExpiresAt : null,
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
      // Renouvelle le code gérant avant expiration (non-bloquant pour le poll UI).
      if (state.key.startsWith('gerant:') && state.pairingPhone) {
        void refreshPairingIfNeeded(state);
      }
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
  const pairingFresh = isPairingCodeFresh(state, state.pairingPhone, { skewMs: 0 });
  return {
    qr: null,
    dataUrl: state.lastQrDataUrl,
    connected: state.ready,
    mock: state.mock,
    phone: state.connectedPhone,
    session: state.key,
    initializing: state.initializing,
    error: state.lastError,
    pairingCode: pairingFresh ? state.pairingCode : null,
    pairingPhone: state.pairingPhone,
    pairingExpiresAt: pairingFresh ? state.pairingExpiresAt : null,
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
  let result = null;
  try {
    result = await openwaRequest('POST', `/sessions/${state.openwaId}/messages/send-text`, {
      chatId,
      text: String(text || ''),
    });
  } catch (err) {
    // Session tombée entre-temps → un seul retry via fallback ready.
    if ([400, 404, 409, 500, 502, 503].includes(Number(err.statusCode))) {
      state.ready = false;
      await ensureReadyForSend(state);
      if (!state.ready || !state.openwaId) throw err;
      result = await openwaRequest('POST', `/sessions/${state.openwaId}/messages/send-text`, {
        chatId,
        text: String(text || ''),
      });
    } else {
      throw err;
    }
  }
  return {
    mock: false,
    phone: state.connectedPhone,
    session: state.key,
    provider: 'openwa',
    messageId: result?.messageId || null,
    timestamp: result?.timestamp || null,
  };
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

  let result = null;
  try {
    result = await openwaRequest('POST', `/sessions/${state.openwaId}/messages/send-image`, body);
  } catch (err) {
    if ([400, 404, 409, 500, 502, 503].includes(Number(err.statusCode))) {
      state.ready = false;
      await ensureReadyForSend(state);
      if (!state.ready || !state.openwaId) throw marquerEchecMedia(err);
      try {
        result = await openwaRequest('POST', `/sessions/${state.openwaId}/messages/send-image`, body);
      } catch (retryErr) {
        throw marquerEchecMedia(retryErr);
      }
    } else {
      throw marquerEchecMedia(err);
    }
  }
  return {
    mock: false,
    phone: state.connectedPhone,
    session: state.key,
    provider: 'openwa',
    messageId: result?.messageId || null,
    timestamp: result?.timestamp || null,
  };
}

/**
 * Le moteur whatsapp-web.js hébergé peut refuser TOUT envoi média
 * (502 SEND_FAILED, ex. « Data passed to getter must include an id… »)
 * alors que le texte passe. On marque ces erreurs pour que l'appelant
 * bascule sur un repli (lien public) au lieu de réessayer en boucle.
 */
function marquerEchecMedia(err) {
  if (err && typeof err === 'object') {
    const code = String(err.payload?.error || err.payload?.code || '');
    if (code === 'SEND_FAILED' || Number(err.statusCode) === 502) {
      err.mediaEngineFailed = true;
      err.code = 'OPENWA_MEDIA_SEND_FAILED';
    }
  }
  return err;
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
  clearPairingState(state);
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
module.exports.PAIRING_TTL_MS = PAIRING_TTL_MS;
module.exports._state = platform;
module.exports._sessions = sessions;
module.exports.OPENWA_BASE_URL = cfg.baseUrl;
