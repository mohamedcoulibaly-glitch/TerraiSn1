const webpush = require('web-push');
const { getDb, queryAll, queryOne, runSql } = require('./database');
const logger = require('./logger');
const {
  isTypeAllowedForTerrain,
  allowedPreferencesForTerrains,
  summarizeTerrainPolicies,
} = require('./services/pushPolicy');

let configured = false;

const ICON = '/icons/icon-192.png';
const BADGE = '/icons/icon-72.png';

const NOTIF_CONFIG = {
  RESA_CONFIRMEE: {
    titre: '✅ Réservation confirmée !',
    vibration: [200, 100, 200],
    preference: 'push_resa_confirmee',
    priorite: 'high',
  },
  RESA_CONFIRMEE_SANS_AVANCE: {
    titre: '✅ Réservation confirmée !',
    vibration: [200, 100, 200],
    preference: 'push_resa_confirmee',
    priorite: 'high',
  },
  REMBOURSEMENT: {
    titre: '💰 Remboursement en cours',
    vibration: [100],
    preference: 'push_remboursement',
    priorite: 'normal',
  },
  RESA_ANNULEE_CONFLIT: {
    titre: '❌ Créneau pris par un autre joueur',
    vibration: [300],
    preference: 'push_resa_annulee',
    priorite: 'high',
  },
  RAPPEL_MATCH_J1: {
    titre: '⚽ Ton match est demain !',
    vibration: [100, 50, 100],
    preference: 'push_rappel_match',
    priorite: 'normal',
  },
  RAPPEL_MATCH_H2: {
    titre: '⚽ Ton match dans 2 heures !',
    vibration: [200, 100, 200, 100, 200],
    preference: 'push_rappel_match',
    priorite: 'high',
  },
  RESA_ANNULEE_GERANT: {
    titre: '❌ Réservation annulée',
    vibration: [300],
    preference: 'push_resa_annulee',
    priorite: 'high',
  },
  NOUVELLE_RESA: {
    titre: '🔔 Nouvelle réservation !',
    vibration: [200, 100, 200],
    preference: 'push_nouvelle_resa',
    priorite: 'high',
  },
  RESA_EN_ATTENTE: {
    titre: '⏳ Lien de paiement envoyé',
    vibration: [100],
    preference: 'push_nouvelle_resa',
    priorite: 'normal',
  },
  RESA_ANNULEE_JOUEUR: {
    titre: '❌ Réservation annulée par le joueur',
    vibration: [200],
    preference: 'push_nouvelle_resa',
    priorite: 'normal',
  },
  MATCH_IMMINENT: {
    titre: '⚡ Match dans 30 min — prêt à scanner ?',
    vibration: [200, 100, 200, 100, 200],
    preference: 'push_match_imminent',
    priorite: 'high',
  },
  REVERSEMENT_CREDITE: {
    titre: '💰 Virement reçu !',
    vibration: [200, 100, 200],
    preference: 'push_reversement',
    priorite: 'normal',
  },
  DETTE_RAPPEL_J7: {
    titre: '📋 Commission due — 7 jours restants',
    vibration: [100],
    preference: 'push_dette_rappel',
    priorite: 'normal',
  },
  DETTE_RAPPEL_J3: {
    titre: '⚠️ Commission due — 3 jours restants',
    vibration: [200, 100, 200],
    preference: 'push_dette_rappel',
    priorite: 'high',
  },
  DETTE_RAPPEL_J1: {
    titre: '🚨 Commission due — demain dernier délai',
    vibration: [300, 100, 300, 100, 300],
    preference: 'push_dette_rappel',
    priorite: 'high',
  },
  DETTE_RETARD: {
    titre: '🚨 Commission en retard',
    vibration: [500, 100, 500],
    preference: 'push_dette_rappel',
    priorite: 'high',
  },
  MATCH_CONFIRME_TERRAIN: {
    titre: '✅ Nouveau match confirmé',
    vibration: [100],
    preference: 'push_revenus',
    priorite: 'normal',
  },
  SANTE_ORANGE: {
    titre: '🟡 Score gérant en baisse',
    vibration: [100, 50, 100],
    preference: 'push_sante_gerant',
    priorite: 'normal',
  },
  SANTE_ROUGE: {
    titre: '🔴 Score gérant critique',
    vibration: [300, 100, 300],
    preference: 'push_sante_gerant',
    priorite: 'high',
  },
  ABONNEMENT_J7: {
    titre: '📅 Abonnement — 7 jours avant échéance',
    vibration: [100],
    preference: 'push_abonnement',
    priorite: 'normal',
  },
  ABONNEMENT_RETARD: {
    titre: '⛔ Abonnement en retard',
    vibration: [300, 100, 300],
    preference: 'push_abonnement',
    priorite: 'high',
  },
  TERRAIN_SUSPENDU: {
    titre: '⛔ Terrain suspendu',
    vibration: [500],
    preference: 'push_alertes_terrain',
    priorite: 'high',
  },
  TERRAIN_REACTIVE: {
    titre: '✅ Terrain réactivé',
    vibration: [200, 100, 200],
    preference: 'push_alertes_terrain',
    priorite: 'normal',
  },
  REVENUS_FIN_MOIS: {
    titre: '📊 Résumé de vos revenus du mois',
    vibration: [100],
    preference: 'push_revenus',
    priorite: 'normal',
  },
  RETRAIT_DEMANDE: {
    titre: '💸 Demande de retrait reçue',
    vibration: [200, 100, 200],
    preference: 'push_retrait_demande',
    priorite: 'high',
  },
  PAYOUT_ECHEC: {
    titre: '❌ Payout automatique en échec',
    vibration: [500, 100, 500],
    preference: 'push_payout_echec',
    priorite: 'high',
  },
  ESSAI_EXPIRE_J7: {
    titre: '⏳ Essai terrain — 7 jours restants',
    vibration: [100],
    preference: 'push_alertes_terrain',
    priorite: 'normal',
  },
  ESSAI_EXPIRE_J3: {
    titre: '⏳ Essai terrain — 3 jours restants',
    vibration: [200, 100, 200],
    preference: 'push_alertes_terrain',
    priorite: 'high',
  },
  ESSAI_EXPIRE_J1: {
    titre: '⏳ Essai terrain — dernier jour',
    vibration: [300, 100, 300],
    preference: 'push_alertes_terrain',
    priorite: 'high',
  },
  ABONNEMENT_RETARD_ADMIN: {
    titre: '🚨 Terrain — abonnement en retard',
    vibration: [300, 100, 300],
    preference: 'push_alertes_terrain',
    priorite: 'high',
  },
  SCORE_CRITIQUE_ADMIN: {
    titre: '🔴 Score gérant critique — 2 mois',
    vibration: [200, 100, 200],
    preference: 'push_alertes_terrain',
    priorite: 'high',
  },
  DETTE_RETARD_ADMIN: {
    titre: '🚨 Dette commission en retard',
    vibration: [300],
    preference: 'push_alertes_terrain',
    priorite: 'high',
  },
};

const PREF_KEYS = [
  'push_resa_confirmee',
  'push_resa_annulee',
  'push_rappel_match',
  'push_remboursement',
  'push_nouvelle_resa',
  'push_match_imminent',
  'push_reversement',
  'push_dette_rappel',
  'push_revenus',
  'push_sante_gerant',
  'push_abonnement',
  'push_retrait_demande',
  'push_payout_echec',
  'push_alertes_terrain',
];

function accountTypeFromUser(user) {
  if (!user) return 'user';
  if (user.accountType === 'employe' || user.role === 'gerant') return 'employe';
  if (user.accountType === 'proprietaire' || user.role === 'proprietaire') return 'proprietaire';
  return 'user';
}

function vapidSubject() {
  return process.env.VAPID_EMAIL || process.env.VAPID_SUBJECT || 'mailto:contact@terrainsn.com';
}

function getVapidConfig() {
  return {
    publicKey: process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY || '',
    subject: vapidSubject(),
  };
}

function ensureConfigured() {
  if (configured) return true;
  const { publicKey, privateKey, subject } = getVapidConfig();
  if (!publicKey || !privateKey) {
    logger.warn('pushService', 'Clés VAPID manquantes — Web Push désactivé. Lancez: node scripts/generate-vapid-keys.js');
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

function getPublicKey() {
  return getVapidConfig().publicKey || null;
}

function formaterHeure(heureStr) {
  return String(heureStr || '').substring(0, 5);
}

function formaterDateCourt(dateStr) {
  try {
    const raw = String(dateStr || '').slice(0, 10);
    return new Date(`${raw}T12:00:00`).toLocaleDateString('fr-SN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return String(dateStr || '');
  }
}

function formaterDateHeurePush(date, heure_debut) {
  const { getJourPercuBackend } = require('./utils/creneauLabel');
  const { labelComplet, estNuitProlongee, datePercue } = getJourPercuBackend(date, heure_debut);
  const heure = formaterHeure(heure_debut);
  if (estNuitProlongee) {
    return `${formaterDateCourt(datePercue)} · ${labelComplet} à ${heure}`;
  }
  return `${formaterDateCourt(date)} à ${heure}`;
}

function formaterMontant(montant) {
  return `${Number(montant || 0).toLocaleString('fr-SN')} FCFA`;
}

async function ensurePreferences(userId, accountType = 'user') {
  const db = await getDb();
  await runSql(db, `
    INSERT INTO notif_preferences (user_id, account_type)
    VALUES (?, ?)
    ON CONFLICT (account_type, user_id) DO NOTHING
  `, [userId, accountType]);
}

async function loadTerrainsForActor(userId, accountType = 'user') {
  const db = await getDb();
  const id = Number(userId);
  if (!id) return [];
  if (accountType === 'employe') {
    return queryAll(db, `
      SELECT DISTINCT t.*
        FROM terrains t
        LEFT JOIN gerants_terrains gt ON gt.terrain_id = t.id AND gt.gerant_id = ? AND gt.actif = 1
        LEFT JOIN employes e ON e.id = ?
       WHERE gt.gerant_id IS NOT NULL OR e.terrain_id = t.id
    `, [id, id]);
  }
  if (accountType === 'proprietaire') {
    return queryAll(db, 'SELECT * FROM terrains WHERE proprietaire_id = ?', [id]);
  }
  return [];
}

async function getPreferences(userId, accountType = 'user', { withPolicy = false } = {}) {
  const db = await getDb();
  await ensurePreferences(userId, accountType);
  const row = await queryOne(db, `
    SELECT * FROM notif_preferences WHERE user_id = ? AND account_type = ?
  `, [userId, accountType]);
  const prefs = {};
  for (const key of PREF_KEYS) prefs[key] = row && Number(row[key]) === 0 ? 0 : 1;
  if (!withPolicy) return prefs;

  const isAdmin = accountType === 'user';
  let includePlatform = false;
  if (isAdmin) {
    const u = await queryOne(db, 'SELECT role FROM users WHERE id = ?', [userId]);
    includePlatform = u && ['super_admin', 'superadmin'].includes(u.role);
  }
  const terrains = await loadTerrainsForActor(userId, accountType);
  const JOUEUR_PREFS = new Set([
    'push_resa_confirmee',
    'push_resa_annulee',
    'push_rappel_match',
    'push_remboursement',
  ]);
  let allowed;
  if (includePlatform) {
    allowed = {
      ...allowedPreferencesForTerrains(terrains, { includePlatform: true }),
      push_retrait_demande: true,
      push_payout_echec: true,
      push_alertes_terrain: true,
      push_abonnement: true,
    };
  } else if (accountType === 'user') {
    allowed = Object.fromEntries(PREF_KEYS.map((k) => [k, JOUEUR_PREFS.has(k)]));
  } else {
    allowed = allowedPreferencesForTerrains(terrains, { includePlatform: false });
  }
  return {
    preferences: prefs,
    allowed_preferences: allowed,
    policies: summarizeTerrainPolicies(terrains),
  };
}

async function updatePreferences(userId, body, accountType = 'user') {
  const db = await getDb();
  await ensurePreferences(userId, accountType);
  const champs = Object.keys(body || {}).filter((k) => PREF_KEYS.includes(k));
  if (!champs.length) return getPreferences(userId, accountType);
  const sets = champs.map((k) => `${k} = ?`).join(', ');
  const valeurs = champs.map((k) => (Number(body[k]) ? 1 : 0));
  await runSql(db, `
    UPDATE notif_preferences
       SET ${sets}, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND account_type = ?
  `, [...valeurs, userId, accountType]);
  return getPreferences(userId, accountType);
}

async function upsertSubscription(userId, subscription, userAgent = '', accountType = 'user') {
  const db = await getDb();
  const { endpoint, keys } = subscription || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new Error('Abonnement Web Push invalide');
  }
  await runSql(db, `
    INSERT INTO push_subscriptions (user_id, account_type, endpoint, p256dh, auth, user_agent, actif, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT (endpoint) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      account_type = EXCLUDED.account_type,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_agent = EXCLUDED.user_agent,
      actif = 1,
      last_used_at = CURRENT_TIMESTAMP
  `, [userId, accountType, endpoint, keys.p256dh, keys.auth, String(userAgent || '').slice(0, 255)]);
  await ensurePreferences(userId, accountType);
}

async function removeSubscription(userId, endpoint, accountType = 'user') {
  const db = await getDb();
  await runSql(db, `
    UPDATE push_subscriptions SET actif = 0
     WHERE user_id = ? AND account_type = ? AND endpoint = ?
  `, [userId, accountType, endpoint]);
}

async function getSuperAdminIds() {
  const db = await getDb();
  const rows = await queryAll(db, `
    SELECT id FROM users
     WHERE role IN ('super_admin', 'superadmin')
       AND COALESCE(is_active, 1) = 1
       AND COALESCE(is_banned, 0) = 0
  `);
  return rows.map((r) => Number(r.id)).filter(Boolean);
}

async function getGerantActor(terrainId, dateTime) {
  try {
    const { getGerantDeGarde } = require('./services/gerantService');
    const garde = await getGerantDeGarde(terrainId, dateTime);
    if (garde?.gerant_id) return { userId: Number(garde.gerant_id), accountType: 'employe' };
  } catch {
    /* fallback */
  }
  const db = await getDb();
  const row = await queryOne(db, `
    SELECT e.id FROM employes e
     WHERE e.terrain_id = ? AND COALESCE(e.is_active, 1) = 1
     ORDER BY e.id ASC LIMIT 1
  `, [terrainId]);
  return row ? { userId: Number(row.id), accountType: 'employe' } : null;
}

async function getProprietaireActor(terrainId) {
  const db = await getDb();
  const row = await queryOne(db, 'SELECT proprietaire_id FROM terrains WHERE id = ?', [terrainId]);
  return row?.proprietaire_id
    ? { userId: Number(row.proprietaire_id), accountType: 'proprietaire' }
    : null;
}

async function logPush({ userId, accountType, type, titre, corps, data, statut, erreur }) {
  try {
    const db = await getDb();
    await runSql(db, `
      INSERT INTO push_logs (user_id, account_type, type_notif, titre, corps, data, statut, erreur)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId || null,
      accountType || 'user',
      type,
      titre,
      corps,
      JSON.stringify(data || {}),
      statut,
      erreur || null,
    ]);
  } catch (err) {
    logger.warn('pushService', `logPush: ${err.message || err}`);
  }
}

/**
 * Envoie une notification push à tous les appareils actifs d'un acteur.
 * accountType: 'user' | 'employe' | 'proprietaire'
 * payload.terrain | payload.data.terrain_id : filtre politique terrain
 */
async function envoyerPush(userId, type, payload = {}, accountType = 'user') {
  try {
    if (!userId || !ensureConfigured()) return { sent: 0, failed: 0, skipped: true };
    const config = NOTIF_CONFIG[type];
    if (!config) {
      logger.warn('pushService', `Type inconnu : ${type}`);
      return { sent: 0, failed: 0 };
    }

    let terrain = payload.terrain || null;
    const terrainId = terrain?.id || payload.terrain_id || payload.data?.terrain_id;
    if (!terrain && terrainId) {
      const dbT = await getDb();
      terrain = await queryOne(dbT, 'SELECT * FROM terrains WHERE id = ?', [Number(terrainId)]);
    }
    const policyCheck = isTypeAllowedForTerrain(type, terrain);
    if (!policyCheck.allowed) {
      logger.info('pushService', `Skip ${type} (politique terrain: ${policyCheck.reason})`);
      return { sent: 0, failed: 0, skipped: true, reason: policyCheck.reason };
    }

    const prefs = await getPreferences(userId, accountType);
    if (prefs[config.preference] === 0) {
      return { sent: 0, failed: 0, skipped: true };
    }

    const db = await getDb();
    const abonnements = await queryAll(db, `
      SELECT * FROM push_subscriptions
       WHERE user_id = ? AND account_type = ? AND COALESCE(actif, 1) = 1
    `, [userId, accountType]);
    if (!abonnements.length) return { sent: 0, failed: 0 };

    const high = config.priorite === 'high';
    const notification = {
      title: payload.titre || config.titre,
      body: payload.corps || payload.body || '',
      icon: payload.icone || ICON,
      badge: BADGE,
      vibrate: config.vibration,
      tag: type,
      renotify: high,
      requireInteraction: high,
      data: {
        type,
        url: payload.url || '/',
        ...(terrainId ? { terrain_id: Number(terrainId) } : {}),
        ...(payload.data || {}),
      },
      actions: payload.actions || [],
    };

    const resultats = await Promise.allSettled(
      abonnements.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(notification),
            { TTL: high ? 86400 : 3600 },
          );
          await runSql(db, 'UPDATE push_subscriptions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [sub.id]);
          return { ok: true };
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await runSql(db, 'UPDATE push_subscriptions SET actif = 0 WHERE id = ?', [sub.id]);
          }
          throw err;
        }
      }),
    );

    const sent = resultats.filter((r) => r.status === 'fulfilled').length;
    const failed = resultats.filter((r) => r.status === 'rejected').length;
    await logPush({
      userId,
      accountType,
      type,
      titre: notification.title,
      corps: notification.body,
      data: notification.data,
      statut: failed === abonnements.length ? 'echoue' : 'envoye',
      erreur: failed ? `${failed}/${abonnements.length} échoués` : null,
    });
    return { sent, failed };
  } catch (err) {
    logger.error('pushService', `envoyerPush ${type} user ${userId}`, err);
    return { sent: 0, failed: 1 };
  }
}

async function envoyerPushGroupe(userIds, type, payload = {}, accountType = 'user') {
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  await Promise.allSettled(ids.map((id) => envoyerPush(id, type, payload, accountType)));
}

async function sendToUser(userId, payload, preferenceKey = null, accountType = 'user') {
  if (preferenceKey) {
    const prefs = await getPreferences(userId, accountType);
    const mapped = {
      reservation_confirmation: 'push_resa_confirmee',
      rappel_reservation: 'push_rappel_match',
    }[preferenceKey] || preferenceKey;
    if (prefs[mapped] === 0) return { sent: 0, failed: 0, skipped: true };
  }
  return envoyerPush(userId, payload.type || 'RESA_CONFIRMEE', {
    titre: payload.title,
    corps: payload.body,
    url: payload.url,
    data: payload.data,
    actions: payload.actions,
  }, accountType);
}

async function reservationContext(reservationId) {
  const db = await getDb();
  return queryOne(db, `
    SELECT r.*, t.nom AS terrain_nom, t.proprietaire_id,
           t.modele_revenus, t.mode_essai, t.essai_debut_at, t.essai_fin_at,
           t.essai_duree_jours, t.essai_suspendu_auto, t.delai_negociation_jours,
           t.politique_paiement, t.delai_remboursement_heures, t.is_active,
           t.abonnement_montant, t.abonnement_prochain_paiement,
           COALESCE(u.prenom, split_part(COALESCE(r.joueur_nom, ''), ' ', 1)) AS joueur_prenom
      FROM reservations r
      JOIN terrains t ON t.id = r.terrain_id
      LEFT JOIN users u ON u.id = r.joueur_id
     WHERE r.id = ?
  `, [reservationId]);
}

function terrainFromResa(r) {
  if (!r) return null;
  return {
    id: r.terrain_id,
    modele_revenus: r.modele_revenus,
    mode_essai: r.mode_essai,
    essai_debut_at: r.essai_debut_at,
    essai_fin_at: r.essai_fin_at,
    essai_duree_jours: r.essai_duree_jours,
    essai_suspendu_auto: r.essai_suspendu_auto,
    delai_negociation_jours: r.delai_negociation_jours,
    politique_paiement: r.politique_paiement,
    delai_remboursement_heures: r.delai_remboursement_heures,
    is_active: r.is_active,
    abonnement_montant: r.abonnement_montant,
    abonnement_prochain_paiement: r.abonnement_prochain_paiement,
  };
}

function pushPayloadBase(r, extra = {}) {
  const terrain = terrainFromResa(r);
  return {
    ...extra,
    terrain,
    terrain_id: r.terrain_id,
    data: { reservation_id: r.id, terrain_id: r.terrain_id, ...(extra.data || {}) },
  };
}

async function notifyReservationConfirmee(reservationId, { sansAvance = false } = {}) {
  const r = await reservationContext(reservationId);
  if (!r) return;
  const corps = `${r.terrain_nom} · ${formaterDateHeurePush(r.date, r.heure_debut)}`;
  const type = sansAvance || String(r.politique_paiement || '') === 'sans_avance'
    ? 'RESA_CONFIRMEE_SANS_AVANCE'
    : 'RESA_CONFIRMEE';
  if (r.joueur_id) {
    await envoyerPush(r.joueur_id, type, pushPayloadBase(r, {
      corps,
      url: '/reservations',
      actions: [{ action: 'voir', title: 'Voir ma résa' }],
    }), 'user');
  }
  const gerant = await getGerantActor(r.terrain_id);
  if (gerant) {
    await envoyerPush(gerant.userId, 'NOUVELLE_RESA', pushPayloadBase(r, {
      corps: `${r.joueur_prenom || r.joueur_nom || 'Joueur'} · ${formaterDateHeurePush(r.date, r.heure_debut)}`,
      url: `/backoffice/gerant/reservations/${reservationId}`,
    }), gerant.accountType);
  }
  if (r.proprietaire_id) {
    await envoyerPush(r.proprietaire_id, 'MATCH_CONFIRME_TERRAIN', pushPayloadBase(r, {
      corps: `${r.terrain_nom} · ${formaterDateHeurePush(r.date, r.heure_debut)}`,
      url: '/backoffice/proprietaire',
    }), 'proprietaire');
  }
}

async function notifyLienPaiement(reservationId) {
  const r = await reservationContext(reservationId);
  if (!r) return;
  if (String(r.politique_paiement || 'avance') === 'sans_avance') return;
  const corps = `${r.terrain_nom} · ${formaterDateHeurePush(r.date, r.heure_debut)}`;
  if (r.joueur_id) {
    await envoyerPush(r.joueur_id, 'RESA_EN_ATTENTE', pushPayloadBase(r, {
      titre: '⏳ Paiement en attente',
      corps,
      url: '/reservations',
    }), 'user');
  }
  const gerant = await getGerantActor(r.terrain_id);
  if (gerant) {
    await envoyerPush(gerant.userId, 'RESA_EN_ATTENTE', pushPayloadBase(r, {
      corps,
      url: `/backoffice/gerant/reservations/${reservationId}`,
    }), gerant.accountType);
  }
}

async function notifyRemboursement(reservationId) {
  const r = await reservationContext(reservationId);
  if (!r?.joueur_id) return;
  await envoyerPush(r.joueur_id, 'REMBOURSEMENT', pushPayloadBase(r, {
    corps: `${r.terrain_nom} · remboursement en cours`,
    url: `/terrains/${r.terrain_id}`,
  }), 'user');
}

async function notifyCreneauPris(reservationId) {
  const r = await reservationContext(reservationId);
  if (!r?.joueur_id) return;
  await envoyerPush(r.joueur_id, 'RESA_ANNULEE_CONFLIT', pushPayloadBase(r, {
    corps: "Quelqu'un a payé en premier. Remboursement en cours.",
    url: `/terrains/${r.terrain_id}`,
  }), 'user');
}

async function notifyAnnulation(reservationId, { traiteParGerant = false } = {}) {
  const r = await reservationContext(reservationId);
  if (!r) return;
  const corps = `${r.terrain_nom} · ${formaterDateHeurePush(r.date, r.heure_debut)}`;
  if (r.joueur_id) {
    await envoyerPush(r.joueur_id, 'RESA_ANNULEE_GERANT', pushPayloadBase(r, {
      corps,
      url: '/reservations',
    }), 'user');
  }
  if (!traiteParGerant) {
    const gerant = await getGerantActor(r.terrain_id);
    if (gerant) {
      await envoyerPush(gerant.userId, 'RESA_ANNULEE_JOUEUR', pushPayloadBase(r, {
        corps: `${r.joueur_prenom || r.joueur_nom || 'Joueur'} · ${corps}`,
        url: `/backoffice/gerant/reservations/${reservationId}`,
      }), gerant.accountType);
    }
  }
}

async function notifyReversement(gerantId, { montant, terrainNom, terrainId } = {}) {
  if (!gerantId) return;
  let terrain = null;
  if (terrainId) {
    const db = await getDb();
    terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(terrainId)]);
  }
  await envoyerPush(gerantId, 'REVERSEMENT_CREDITE', {
    terrain,
    terrain_id: terrainId || terrain?.id,
    corps: `${formaterMontant(montant)}${terrainNom ? ` · ${terrainNom}` : ''}`,
    url: '/backoffice/gerant/finances',
    data: { montant, terrain_id: terrainId || terrain?.id },
  }, 'employe');
}

async function notifySanteTransition({ terrainId, gerantPrenom, score, scoreAvant, terrainNom }) {
  const db = await getDb();
  const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(terrainId)]);
  const proprio = await getProprietaireActor(terrainId);
  const base = { terrain, terrain_id: terrainId, data: { terrain_id: terrainId } };
  if (score < 75 && scoreAvant >= 75 && proprio) {
    await envoyerPush(proprio.userId, 'SANTE_ORANGE', {
      ...base,
      corps: `Score de ${gerantPrenom || 'gérant'} à ${score}/100 sur ${terrainNom || 'le terrain'}`,
      url: '/backoffice/proprietaire',
    }, proprio.accountType);
  }
  if (score < 50 && scoreAvant >= 50) {
    if (proprio) {
      await envoyerPush(proprio.userId, 'SANTE_ROUGE', {
        ...base,
        corps: `Score de ${gerantPrenom || 'gérant'} à ${score}/100 — attention requise`,
        url: '/backoffice/proprietaire',
      }, proprio.accountType);
    }
    const admins = await getSuperAdminIds();
    await envoyerPushGroupe(admins, 'SCORE_CRITIQUE_ADMIN', {
      ...base,
      corps: `${terrainNom || 'Terrain'} — gérant : ${gerantPrenom || '—'}`,
      url: `/backoffice/superadmin/terrains/${terrainId}`,
    }, 'user');
  }
}

function nowDakarSql() {
  return `(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Dakar')`;
}

async function cronRappelH2() {
  if (!ensureConfigured()) return { processed: 0 };
  const db = await getDb();
  const matchs = await queryAll(db, `
    SELECT r.id, r.joueur_id, r.terrain_id, t.nom AS terrain_nom, r.heure_debut,
           t.modele_revenus, t.mode_essai, t.politique_paiement, t.delai_remboursement_heures,
           t.essai_debut_at, t.essai_fin_at, t.essai_duree_jours, t.essai_suspendu_auto, t.delai_negociation_jours
      FROM reservations r
      JOIN terrains t ON t.id = r.terrain_id
     WHERE r.statut IN ('confirme', 'acceptee')
       AND r.joueur_id IS NOT NULL
       AND COALESCE(r.push_rappel_h2, 0) = 0
       AND (r.date + r.heure_debut) BETWEEN
           ${nowDakarSql()} + INTERVAL '1 hour 45 minutes'
       AND ${nowDakarSql()} + INTERVAL '2 hours 15 minutes'
  `);
  let processed = 0;
  for (const m of matchs) {
    await envoyerPush(m.joueur_id, 'RAPPEL_MATCH_H2', pushPayloadBase(m, {
      corps: `${m.terrain_nom} · ${formaterHeure(m.heure_debut)}`,
      url: '/reservations',
      actions: [{ action: 'qr', title: 'Voir mon QR code' }],
    }), 'user');
    await runSql(db, 'UPDATE reservations SET push_rappel_h2 = 1 WHERE id = ?', [m.id]);
    processed += 1;
  }
  return { processed };
}

async function cronRappelJ1() {
  if (!ensureConfigured()) return { processed: 0 };
  const db = await getDb();
  const matchs = await queryAll(db, `
    SELECT r.id, r.joueur_id, r.terrain_id, t.nom AS terrain_nom, r.heure_debut,
           t.modele_revenus, t.mode_essai, t.politique_paiement, t.delai_remboursement_heures,
           t.essai_debut_at, t.essai_fin_at, t.essai_duree_jours, t.essai_suspendu_auto, t.delai_negociation_jours
      FROM reservations r
      JOIN terrains t ON t.id = r.terrain_id
     WHERE r.statut IN ('confirme', 'acceptee')
       AND r.joueur_id IS NOT NULL
       AND COALESCE(r.push_rappel_j1, 0) = 0
       AND r.date = (${nowDakarSql()}::date + 1)
  `);
  let processed = 0;
  for (const m of matchs) {
    await envoyerPush(m.joueur_id, 'RAPPEL_MATCH_J1', pushPayloadBase(m, {
      corps: `${m.terrain_nom} · demain à ${formaterHeure(m.heure_debut)}`,
      url: '/reservations',
    }), 'user');
    await runSql(db, 'UPDATE reservations SET push_rappel_j1 = 1 WHERE id = ?', [m.id]);
    processed += 1;
  }
  return { processed };
}

async function cronMatchImminent() {
  if (!ensureConfigured()) return { processed: 0 };
  const db = await getDb();
  const matchs = await queryAll(db, `
    SELECT r.id, r.terrain_id, t.nom AS terrain_nom, r.heure_debut,
           t.modele_revenus, t.mode_essai, t.politique_paiement, t.delai_remboursement_heures,
           t.essai_debut_at, t.essai_fin_at, t.essai_duree_jours, t.essai_suspendu_auto, t.delai_negociation_jours
      FROM reservations r
      JOIN terrains t ON t.id = r.terrain_id
     WHERE r.statut IN ('confirme', 'acceptee')
       AND r.qr_code_scanne_at IS NULL
       AND COALESCE(r.push_match_imminent, 0) = 0
       AND (r.date + r.heure_debut) BETWEEN
           ${nowDakarSql()} + INTERVAL '25 minutes'
       AND ${nowDakarSql()} + INTERVAL '35 minutes'
  `);
  let processed = 0;
  for (const m of matchs) {
    const gerant = await getGerantActor(m.terrain_id);
    if (gerant) {
      await envoyerPush(gerant.userId, 'MATCH_IMMINENT', pushPayloadBase(m, {
        corps: `${m.terrain_nom} · dans 30 min`,
        url: '/backoffice/gerant',
        actions: [{ action: 'scanner', title: 'Ouvrir le scanner' }],
      }), gerant.accountType);
    }
    await runSql(db, 'UPDATE reservations SET push_match_imminent = 1 WHERE id = ?', [m.id]);
    processed += 1;
  }
  return { processed };
}

async function cronRappelsDettes() {
  if (!ensureConfigured()) return { processed: 0 };
  const db = await getDb();
  const dettes = await queryAll(db, `
    SELECT rdp.*, t.nom AS terrain_nom, t.modele_revenus, t.mode_essai,
           t.politique_paiement, t.delai_remboursement_heures,
           CAST(rdp.date_echeance - (${nowDakarSql()}::date) AS INTEGER) AS jours_restants
      FROM resume_dette_periode rdp
      JOIN terrains t ON t.id = rdp.terrain_id
     WHERE rdp.solde_restant > 0
       AND COALESCE(t.modele_revenus, 'commission') = 'commission'
  `);
  let processed = 0;
  const admins = await getSuperAdminIds();
  for (const d of dettes) {
    const jours = Number(d.jours_restants);
    const montant = formaterMontant(d.solde_restant);
    const terrain = {
      id: d.terrain_id,
      modele_revenus: d.modele_revenus,
      mode_essai: d.mode_essai,
      politique_paiement: d.politique_paiement,
      delai_remboursement_heures: d.delai_remboursement_heures,
    };
    const payload = {
      terrain,
      terrain_id: d.terrain_id,
      url: '/backoffice/gerant/finances',
      data: { periode: d.periode, terrain_id: d.terrain_id },
    };
    if (jours === 7 && !Number(d.notif_j7_envoyee)) {
      await envoyerPush(d.gerant_id, 'DETTE_RAPPEL_J7', { corps: `${montant} à régler`, ...payload }, 'employe');
      await runSql(db, 'UPDATE resume_dette_periode SET notif_j7_envoyee = 1 WHERE id = ?', [d.id]);
      processed += 1;
    }
    if (jours === 3 && !Number(d.notif_j3_envoyee)) {
      await envoyerPush(d.gerant_id, 'DETTE_RAPPEL_J3', { corps: `${montant} — plus que 3 jours`, ...payload }, 'employe');
      await runSql(db, 'UPDATE resume_dette_periode SET notif_j3_envoyee = 1 WHERE id = ?', [d.id]);
      processed += 1;
    }
    if (jours === 1 && !Number(d.notif_j1_envoyee)) {
      await envoyerPush(d.gerant_id, 'DETTE_RAPPEL_J1', { corps: `${montant} — dernier délai demain`, ...payload }, 'employe');
      await runSql(db, 'UPDATE resume_dette_periode SET notif_j1_envoyee = 1 WHERE id = ?', [d.id]);
      processed += 1;
    }
    if (jours < 0 && !Number(d.notif_retard_envoyee)) {
      await envoyerPush(d.gerant_id, 'DETTE_RETARD', { corps: `${montant} en retard`, ...payload }, 'employe');
      await envoyerPushGroupe(admins, 'DETTE_RETARD_ADMIN', {
        ...payload,
        corps: `${d.terrain_nom} — ${montant}`,
        url: '/backoffice/superadmin/caisse',
      }, 'user');
      await runSql(db, 'UPDATE resume_dette_periode SET notif_retard_envoyee = 1 WHERE id = ?', [d.id]);
      processed += 1;
    }
  }
  return { processed };
}

async function cronRappelsAbonnements() {
  if (!ensureConfigured()) return { processed: 0 };
  const db = await getDb();
  const { getDefaults } = require('./services/modeRevenuService');
  const defaults = await getDefaults(db);
  if (!Number(defaults.abo_j7) && !Number(defaults.abo_j3) && !Number(defaults.abo_j1) && !Number(defaults.abo_suspension_auto)) {
    return { processed: 0 };
  }

  await addColumnIfMissingPush(db, 'abonnements', 'notif_abo_j7', 'INTEGER DEFAULT 0');
  await addColumnIfMissingPush(db, 'abonnements', 'notif_abo_j3', 'INTEGER DEFAULT 0');
  await addColumnIfMissingPush(db, 'abonnements', 'notif_abo_j1', 'INTEGER DEFAULT 0');
  await addColumnIfMissingPush(db, 'abonnements', 'notif_abo_retard', 'INTEGER DEFAULT 0');

  const rows = await queryAll(db, `
    SELECT a.*, t.nom AS terrain_nom, t.proprietaire_id, t.modele_revenus, t.mode_essai,
           t.is_active, t.politique_paiement, t.delai_remboursement_heures,
           CAST(a.date_echeance - (${nowDakarSql()}::date) AS INTEGER) AS jours_restants
      FROM abonnements a
      JOIN terrains t ON t.id = a.terrain_id
     WHERE t.modele_revenus = 'abonnement'
       AND a.statut IN ('en_attente', 'en_retard')
  `);
  let processed = 0;
  const admins = await getSuperAdminIds();
  for (const a of rows) {
    const jours = Number(a.jours_restants);
    const terrain = {
      id: a.terrain_id,
      modele_revenus: a.modele_revenus,
      mode_essai: a.mode_essai,
      politique_paiement: a.politique_paiement,
      delai_remboursement_heures: a.delai_remboursement_heures,
      is_active: a.is_active,
    };
    const base = {
      terrain,
      terrain_id: a.terrain_id,
      data: { terrain_id: a.terrain_id, abonnement_id: a.id },
    };
    const montant = formaterMontant(a.montant);
    if (Number(defaults.abo_j7) && jours === 7 && !Number(a.notif_abo_j7) && a.proprietaire_id) {
      await envoyerPush(a.proprietaire_id, 'ABONNEMENT_J7', {
        ...base,
        corps: `${a.terrain_nom} · ${montant}`,
        url: '/backoffice/proprietaire',
      }, 'proprietaire');
      await runSql(db, 'UPDATE abonnements SET notif_abo_j7 = 1 WHERE id = ?', [a.id]);
      processed += 1;
    }
    if (Number(defaults.abo_j3) && jours === 3 && !Number(a.notif_abo_j3) && a.proprietaire_id) {
      await envoyerPush(a.proprietaire_id, 'ABONNEMENT_RETARD', {
        ...base,
        titre: '⚠️ Abonnement — 3 jours restants',
        corps: `${a.terrain_nom} · ${montant}`,
        url: '/backoffice/proprietaire',
      }, 'proprietaire');
      await runSql(db, 'UPDATE abonnements SET notif_abo_j3 = 1 WHERE id = ?', [a.id]);
      processed += 1;
    }
    if (Number(defaults.abo_j1) && jours === 1 && !Number(a.notif_abo_j1) && a.proprietaire_id) {
      await envoyerPush(a.proprietaire_id, 'ABONNEMENT_RETARD', {
        ...base,
        titre: '🚨 Abonnement — demain dernier délai',
        corps: `${a.terrain_nom} · ${montant}`,
        url: '/backoffice/proprietaire',
      }, 'proprietaire');
      await runSql(db, 'UPDATE abonnements SET notif_abo_j1 = 1 WHERE id = ?', [a.id]);
      processed += 1;
    }
    if (jours < 0 && !Number(a.notif_abo_retard)) {
      if (a.proprietaire_id) {
        await envoyerPush(a.proprietaire_id, 'ABONNEMENT_RETARD', {
          ...base,
          corps: `${a.terrain_nom} · ${montant} en retard`,
          url: '/backoffice/proprietaire',
        }, 'proprietaire');
      }
      await envoyerPushGroupe(admins, 'ABONNEMENT_RETARD_ADMIN', {
        ...base,
        corps: `${a.terrain_nom} — ${montant}`,
        url: '/backoffice/superadmin/caisse',
      }, 'user');
      await runSql(db, 'UPDATE abonnements SET notif_abo_retard = 1 WHERE id = ?', [a.id]);
      processed += 1;
    }
  }
  return { processed };
}

async function cronRappelsEssai() {
  if (!ensureConfigured()) return { processed: 0 };
  const db = await getDb();
  const { getDefaults } = require('./services/modeRevenuService');
  const defaults = await getDefaults(db);
  if (!Number(defaults.essai_notifs)) return { processed: 0 };

  const terrains = await queryAll(db, `
    SELECT t.*
      FROM terrains t
     WHERE COALESCE(t.mode_essai, 0) = 1
       AND t.essai_fin_at IS NOT NULL
  `);
  let processed = 0;
  const admins = await getSuperAdminIds();
  for (const t of terrains) {
    const fin = String(t.essai_fin_at).slice(0, 10);
    const jours = Math.round(
      (new Date(`${fin}T12:00:00`).getTime() - Date.now()) / 86400000,
    );
    const base = {
      terrain: t,
      terrain_id: t.id,
      data: { terrain_id: t.id },
      url: '/backoffice/proprietaire',
    };
    const map = [
      [7, 'notif_essai_fin_j7', 'ESSAI_EXPIRE_J7', defaults.essai_j7],
      [3, 'notif_essai_fin_j3', 'ESSAI_EXPIRE_J3', defaults.essai_j3],
      [1, 'notif_essai_fin_j1', 'ESSAI_EXPIRE_J1', defaults.essai_j1],
    ];
    for (const [j, flag, type, enabled] of map) {
      if (!Number(enabled) || jours !== j || Number(t[flag])) continue;
      if (t.proprietaire_id) {
        await envoyerPush(t.proprietaire_id, type, {
          ...base,
          corps: `${t.nom} · essai se termine bientôt`,
        }, 'proprietaire');
      }
      await envoyerPushGroupe(admins, type, {
        ...base,
        corps: `${t.nom} — essai J-${j}`,
        url: `/backoffice/superadmin/terrains/${t.id}`,
      }, 'user');
      await runSql(db, `UPDATE terrains SET ${flag} = 1 WHERE id = ?`, [t.id]);
      processed += 1;
    }
  }
  return { processed };
}

async function notifyTerrainSuspendu(terrainId, { motif = 'abonnement' } = {}) {
  const db = await getDb();
  const t = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(terrainId)]);
  if (!t) return;
  const base = {
    terrain: t,
    terrain_id: t.id,
    data: { terrain_id: t.id, motif },
    corps: `${t.nom} · suspendu (${motif})`,
  };
  if (t.proprietaire_id) {
    await envoyerPush(t.proprietaire_id, 'TERRAIN_SUSPENDU', {
      ...base,
      url: '/backoffice/proprietaire',
    }, 'proprietaire');
  }
  const admins = await getSuperAdminIds();
  await envoyerPushGroupe(admins, 'TERRAIN_SUSPENDU', {
    ...base,
    url: `/backoffice/superadmin/terrains/${t.id}`,
  }, 'user');
}

async function notifyTerrainReactive(terrainId) {
  const db = await getDb();
  const t = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(terrainId)]);
  if (!t?.proprietaire_id) return;
  await envoyerPush(t.proprietaire_id, 'TERRAIN_REACTIVE', {
    terrain: t,
    terrain_id: t.id,
    corps: `${t.nom} · réactivé`,
    url: '/backoffice/proprietaire',
    data: { terrain_id: t.id },
  }, 'proprietaire');
}

async function addColumnIfMissingPush(db, table, column, definition) {
  try {
    const { addColumnIfMissing } = require('./database');
    if (typeof addColumnIfMissing === 'function') {
      await addColumnIfMissing(db, table, column, definition);
      return;
    }
  } catch {
    /* fallback */
  }
  try {
    await runSql(db, `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
  } catch {
    /* already exists */
  }
}

async function envoyerConfirmationPush(reservationId) {
  return notifyReservationConfirmee(reservationId);
}

async function envoyerRappelsReservations() {
  const h2 = await cronRappelH2();
  const imminent = await cronMatchImminent();
  return { processed: (h2.processed || 0) + (imminent.processed || 0) };
}

async function listPushLogs({ userId, type, statut, depuis, jusqua, limit = 50 } = {}) {
  const db = await getDb();
  let sql = `
    SELECT pl.*,
           COALESCE(u.prenom, e.prenom, p.prenom) AS prenom,
           COALESCE(u.nom, e.nom, p.nom) AS nom,
           CASE
             WHEN pl.account_type = 'employe' THEN 'gerant'
             WHEN pl.account_type = 'proprietaire' THEN 'proprietaire'
             ELSE COALESCE(u.role, 'joueur')
           END AS role
      FROM push_logs pl
      LEFT JOIN users u ON pl.account_type = 'user' AND u.id = pl.user_id
      LEFT JOIN employes e ON pl.account_type = 'employe' AND e.id = pl.user_id
      LEFT JOIN proprietaires p ON pl.account_type = 'proprietaire' AND p.id = pl.user_id
     WHERE 1=1
  `;
  const params = [];
  if (userId) {
    sql += ' AND pl.user_id = ?';
    params.push(Number(userId));
  }
  if (type) {
    sql += ' AND pl.type_notif = ?';
    params.push(type);
  }
  if (statut) {
    sql += ' AND pl.statut = ?';
    params.push(statut);
  }
  if (depuis) {
    sql += ' AND pl.created_at >= ?::timestamptz';
    params.push(depuis);
  }
  if (jusqua) {
    sql += ' AND pl.created_at < (?::date + INTERVAL \'1 day\')';
    params.push(jusqua);
  }
  sql += ' ORDER BY pl.created_at DESC LIMIT ?';
  params.push(Math.min(200, Math.max(1, parseInt(limit, 10) || 50)));
  return queryAll(db, sql, params);
}

module.exports = {
  NOTIF_CONFIG,
  PREF_KEYS,
  accountTypeFromUser,
  getPublicKey,
  ensureConfigured,
  upsertSubscription,
  removeSubscription,
  getPreferences,
  updatePreferences,
  sendToUser,
  envoyerPush,
  envoyerPushGroupe,
  envoyerConfirmationPush,
  envoyerRappelsReservations,
  notifyReservationConfirmee,
  notifyLienPaiement,
  notifyRemboursement,
  notifyCreneauPris,
  notifyAnnulation,
  notifyReversement,
  notifySanteTransition,
  cronRappelH2,
  cronRappelJ1,
  cronMatchImminent,
  cronRappelsDettes,
  cronRappelsAbonnements,
  cronRappelsEssai,
  notifyTerrainSuspendu,
  notifyTerrainReactive,
  getSuperAdminIds,
  listPushLogs,
  formaterMontant,
};
