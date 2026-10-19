/**
 * Façade multi-clients WhatsApp — OpenWA (pas whatsapp-web.js).
 *
 * clientId API publique :
 *   - 'superadmin'  → session OpenWA 'platform'
 *   - 'gerant_42'   → session OpenWA 'gerant:42'
 *   - 'platform' / 'gerant:42' acceptés tels quels
 */
const whatsappClient = require('../whatsappClient');
const { getDb, queryOne, queryAll, runSql } = require('../database');

function isMock() {
  return String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true';
}

/** Normalise un clientId métier → clé OpenWA */
function toSessionKey(clientId) {
  const raw = String(clientId || 'superadmin').trim();
  if (raw === 'superadmin' || raw === 'platform') return 'platform';
  const underscored = /^gerant[_:](\d+)$/i.exec(raw);
  if (underscored) return whatsappClient.gerantSessionKey(Number(underscored[1]));
  const dashed = /^gerant-(\d+)$/i.exec(raw);
  if (dashed) return whatsappClient.gerantSessionKey(Number(dashed[1]));
  return whatsappClient.gerantSessionKey?.(raw) || whatsappClient.sanitizeKey?.(raw) || raw;
}

/** Clé OpenWA → clientId métier (pour DB) */
function toClientId(sessionKey) {
  const k = String(sessionKey || 'platform');
  if (k === 'platform') return 'superadmin';
  const m = /^gerant:(\d+)$/.exec(k);
  if (m) return `gerant_${m[1]}`;
  return k;
}

function gerantIdFromClientId(clientId) {
  const m = /^gerant[_:](\d+)$/i.exec(String(clientId || ''));
  return m ? Number(m[1]) : null;
}

async function upsertSession(clientId, patch = {}) {
  try {
    const db = await getDb();
    const id = toClientId(toSessionKey(clientId));
    const gerantId = gerantIdFromClientId(id);
    const existing = queryOne(db, 'SELECT id FROM whatsapp_sessions WHERE client_id = ?', [id]);
    if (existing) {
      runSql(
        db,
        `UPDATE whatsapp_sessions SET
           statut = COALESCE(?, statut),
           telephone = COALESCE(?, telephone),
           derniere_connexion = CASE WHEN ? = 'connecte' THEN CURRENT_TIMESTAMP ELSE derniere_connexion END
         WHERE client_id = ?`,
        [patch.statut || null, patch.telephone || null, patch.statut || null, id],
      );
    } else {
      runSql(
        db,
        `INSERT INTO whatsapp_sessions (client_id, gerant_id, telephone, statut, derniere_connexion)
         VALUES (?, ?, ?, ?, CASE WHEN ? = 'connecte' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
        [id, gerantId, patch.telephone || null, patch.statut || 'deconnecte', patch.statut || 'deconnecte'],
      );
    }
  } catch {
    // best-effort
  }
}

async function loggerEnvoi(clientId, telephone, message, statut, erreur = null) {
  try {
    const db = await getDb();
    runSql(
      db,
      `INSERT INTO whatsapp_logs (client_id, telephone, message_extrait, statut, erreur)
       VALUES (?, ?, ?, ?, ?)`,
      [
        toClientId(toSessionKey(clientId)),
        String(telephone || ''),
        String(message || '').slice(0, 100),
        statut,
        erreur != null ? String(erreur).slice(0, 500) : null,
      ],
    );
  } catch {
    // silencieux
  }
}

/**
 * Initialise / récupère une session OpenWA (équivalent getOuCreerClient).
 */
async function getOuCreerClient(clientId, { onQR, onReady, onDisconnected, force, phoneNumber } = {}) {
  const sessionKey = toSessionKey(clientId);
  await upsertSession(clientId, { statut: 'initializing' });
  const started = await whatsappClient.ensureStarted(sessionKey, { force, phoneNumber });
  const qr = typeof whatsappClient.getQrPayload === 'function'
    ? await whatsappClient.getQrPayload(sessionKey)
    : {};

  if (started?.ready || qr?.connected) {
    await upsertSession(clientId, {
      statut: 'connecte',
      telephone: started.phone || qr.phone || null,
    });
    if (onReady) onReady(started);
  } else if (qr?.dataUrl || qr?.pairingCode) {
    await upsertSession(clientId, { statut: 'qr' });
    if (onQR) onQR(qr.pairingCode || qr.dataUrl || qr);
  }

  return { sessionKey, clientId: toClientId(sessionKey), started, qr };
}

async function getStatut(clientId) {
  const sessionKey = toSessionKey(clientId);
  const publicId = toClientId(sessionKey);
  if (isMock()) {
    return {
      clientId: publicId,
      sessionKey,
      statut: 'ready',
      qrCode: null,
      pret: true,
      mock: true,
      connected: true,
    };
  }
  const status = await whatsappClient.getStatus(sessionKey);
  const connected = Boolean(status?.connected || status?.ready);
  let statut = 'deconnecte';
  if (status?.initializing) statut = 'initializing';
  else if (connected) statut = 'ready';
  else if (status?.hasQr || status?.dataUrl || status?.pairingCode) statut = 'qr';

  return {
    clientId: publicId,
    sessionKey,
    statut,
    qrCode: status?.dataUrl || status?.lastQrDataUrl || null,
    pairingCode: status?.pairingCode || null,
    pret: connected,
    connected,
    phone: status?.phone || null,
    error: status?.error || status?.lastError || null,
    raw: status,
  };
}

async function envoyerMessage(telephone, message, clientId = 'superadmin') {
  const sessionKey = toSessionKey(clientId);
  const publicId = toClientId(sessionKey);

  if (!telephone) {
    await loggerEnvoi(publicId, telephone, message, 'echec', 'telephone_manquant');
    return false;
  }

  if (isMock()) {
    console.log(`[WHATSAPP MOCK][${publicId}] Message vers ${telephone} : ${message}`);
    await loggerEnvoi(publicId, telephone, message, 'envoye');
    return true;
  }

  const statut = await getStatut(publicId);
  if (!statut.pret) {
    console.warn(
      `[WhatsApp] Client ${publicId} non prêt (${statut.statut}). Message non envoyé à ${telephone}.`,
    );
    await loggerEnvoi(publicId, telephone, message, 'echec', statut.statut || 'non_pret');
    return false;
  }

  try {
    const { formatNumero } = require('../notificationService');
    await whatsappClient.sendMessageForSession(sessionKey, formatNumero(telephone), message);
    await loggerEnvoi(publicId, telephone, message, 'envoye');
    return true;
  } catch (err) {
    console.error(`[WhatsApp] Erreur envoi ${publicId} → ${telephone}:`, err.message);
    await loggerEnvoi(publicId, telephone, message, 'echec', err.message);
    return false;
  }
}

async function envoyerImage(telephone, urlImage, caption = '', clientId = 'superadmin') {
  const sessionKey = toSessionKey(clientId);
  const publicId = toClientId(sessionKey);
  if (!telephone || !urlImage) return false;
  if (isMock()) {
    console.log(`[WHATSAPP MOCK][${publicId}] Image vers ${telephone} : ${urlImage}`);
    return true;
  }
  const statut = await getStatut(publicId);
  if (!statut.pret) {
    await loggerEnvoi(publicId, telephone, `[IMAGE] ${caption}`, 'echec', statut.statut);
    return false;
  }
  try {
    const { formatNumero } = require('../notificationService');
    await whatsappClient.sendImageForSession(sessionKey, formatNumero(telephone), {
      url: urlImage,
      caption: caption || '',
    });
    await loggerEnvoi(publicId, telephone, `[IMAGE] ${caption}`, 'envoye');
    return true;
  } catch (err) {
    console.error(`[WhatsApp] Erreur image ${publicId}:`, err.message);
    await loggerEnvoi(publicId, telephone, `[IMAGE] ${caption}`, 'echec', err.message);
    return false;
  }
}

async function deconnecter(clientId) {
  const sessionKey = toSessionKey(clientId);
  try {
    await whatsappClient.logoutSession(sessionKey);
  } catch (err) {
    console.error(`[WhatsApp] Erreur déconnexion ${clientId}:`, err.message);
  }
  await upsertSession(clientId, { statut: 'deconnecte' });
}

function initialiserSuperadmin() {
  if (isMock()) {
    console.log('[WhatsApp] Superadmin mock — prêt');
    return;
  }
  setTimeout(() => {
    whatsappClient.ensureStarted('platform').catch((err) => {
      console.error('[WhatsApp] Superadmin ensureStarted:', err.message);
    });
  }, 2500);
}

async function restaurerSessionsGerants() {
  if (isMock()) return;
  try {
    const db = await getDb();
    const rows = queryAll(
      db,
      `SELECT client_id, gerant_id FROM whatsapp_sessions
        WHERE statut IN ('connecte', 'qr') AND gerant_id IS NOT NULL`,
    );
    const fromOpenwa = queryAll(
      db,
      `SELECT session_key FROM openwa_sessions
        WHERE session_key LIKE 'gerant:%' AND status = 'ready'`,
    );
    const keys = new Set([
      ...rows.map((r) => toSessionKey(r.client_id)),
      ...fromOpenwa.map((r) => r.session_key),
    ]);
    console.log(`[WhatsApp] Restauration de ${keys.size} session(s) gérant`);
    for (const sessionKey of keys) {
      whatsappClient.ensureStarted(sessionKey).catch((err) => {
        console.warn(`[WhatsApp] Restauration ${sessionKey}:`, err.message);
      });
    }
  } catch (err) {
    console.warn('[WhatsApp] restaurerSessionsGerants:', err.message);
  }
}

/**
 * Client pour messages JOUEUR liés à un terrain.
 * @returns {Promise<string|null>} clientId métier ou null si gérant déconnecté
 */
async function getClientPourTerrain(terrainId, gerantIdHint = null) {
  let gerantId = Number(gerantIdHint) || 0;
  if (!gerantId && terrainId) {
    try {
      const db = await getDb();
      const row = queryOne(
        db,
        `SELECT COALESCE(
           t.gerant_id,
           (SELECT e.id FROM employes e
             WHERE e.terrain_id = t.id AND e.is_active = 1
             ORDER BY e.id ASC LIMIT 1)
         ) AS gerant_id
         FROM terrains t WHERE t.id = ?`,
        [Number(terrainId)],
      );
      gerantId = Number(row?.gerant_id) || 0;
    } catch {
      gerantId = 0;
    }
  }
  if (!gerantId) {
    console.warn(`[Notif] Aucun gérant pour terrain ${terrainId} — message joueur non envoyé`);
    await loggerEnvoi('superadmin', '', `terrain=${terrainId}`, 'echec', 'gerant_absent');
    return null;
  }

  const clientId = `gerant_${gerantId}`;
  if (isMock()) return clientId;

  const statut = await getStatut(clientId);
  if (statut.pret) return clientId;

  // Prod : session OpenWA partagée ou fallback explicite → platform (QR / lien ne doivent pas être silencieux)
  const allowPlatformFallback =
    Boolean(String(process.env.OPENWA_SHARED_SESSION_ID || '').trim())
    || String(process.env.WA_FALLBACK_PLATFORM || 'true').toLowerCase() === 'true';

  if (allowPlatformFallback) {
    console.warn(
      `[Notif] Gérant ${gerantId} déconnecté (${statut.statut}) — fallback platform pour le joueur`,
    );
    await loggerEnvoi(clientId, '', `terrain=${terrainId}`, 'echec', 'fallback_platform');
    return 'superadmin';
  }

  console.warn(
    `[Notif] Gérant ${gerantId} déconnecté (${statut.statut}). ` +
      'Message non envoyé — reconnecter WhatsApp gérant.',
  );
  await loggerEnvoi(clientId, '', `terrain=${terrainId}`, 'echec', 'gerant_deconnecte');
  return null;
}

module.exports = {
  toSessionKey,
  toClientId,
  getOuCreerClient,
  envoyerMessage,
  envoyerImage,
  getStatut,
  deconnecter,
  initialiserSuperadmin,
  restaurerSessionsGerants,
  getClientPourTerrain,
  loggerEnvoi,
  upsertSession,
};
