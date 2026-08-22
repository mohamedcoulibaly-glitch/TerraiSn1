const webpush = require('web-push');
const { getDb, queryAll, queryOne, runSql } = require('./database');
const logger = require('./logger');

let configured = false;

function getVapidConfig() {
  return {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:contact@terrainsn.com',
  };
}

function ensureConfigured() {
  if (configured) return true;
  const { publicKey, privateKey, subject } = getVapidConfig();
  if (!publicKey || !privateKey) {
    logger.warn('pushService', 'VAPID keys manquantes — Web Push desactive. Lancez: node scripts/generate-vapid-keys.js');
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

function getPublicKey() {
  return getVapidConfig().publicKey || null;
}

async function upsertSubscription(userId, subscription, userAgent = '') {
  const db = await getDb();
  const { endpoint, keys } = subscription;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new Error('Subscription Web Push invalide');
  }

  await runSql(db, `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent`, [
    userId,
    endpoint,
    keys.p256dh,
    keys.auth,
    userAgent.slice(0, 255),
  ]);

  await runSql(db, `INSERT INTO push_preferences (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING`, [userId]);
}

async function removeSubscription(userId, endpoint) {
  const db = await getDb();
  await runSql(db, 'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [userId, endpoint]);
}

async function getPreferences(userId) {
  const db = await getDb();
  const prefs = await queryOne(db, 'SELECT * FROM push_preferences WHERE user_id = ?', [userId]);
  if (!prefs) {
    return {
      reservation_confirmation: true,
      rappel_reservation: true,
      promotion: false,
      nouveau_message: true,
      avis_reponse: true,
    };
  }
  return {
    reservation_confirmation: !!prefs.reservation_confirmation,
    rappel_reservation: !!prefs.rappel_reservation,
    promotion: !!prefs.promotion,
    nouveau_message: !!prefs.nouveau_message,
    avis_reponse: !!prefs.avis_reponse,
  };
}

async function updatePreferences(userId, prefs) {
  const db = await getDb();
  await runSql(db, `INSERT INTO push_preferences (user_id, reservation_confirmation, rappel_reservation, promotion, nouveau_message, avis_reponse)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      reservation_confirmation = excluded.reservation_confirmation,
      rappel_reservation = excluded.rappel_reservation,
      promotion = excluded.promotion,
      nouveau_message = excluded.nouveau_message,
      avis_reponse = excluded.avis_reponse`, [
    userId,
    prefs.reservation_confirmation ? 1 : 0,
    prefs.rappel_reservation ? 1 : 0,
    prefs.promotion ? 1 : 0,
    prefs.nouveau_message ? 1 : 0,
    prefs.avis_reponse ? 1 : 0,
  ]);
  return getPreferences(userId);
}

async function getSubscriptionsForUser(userId) {
  const db = await getDb();
  return await queryAll(db, 'SELECT * FROM push_subscriptions WHERE user_id = ?', [userId]);
}

async function sendToUser(userId, payload, preferenceKey = null) {
  if (!ensureConfigured()) return { sent: 0, failed: 0 };

  if (preferenceKey) {
    const prefs = await getPreferences(userId);
    if (!prefs[preferenceKey]) return { sent: 0, failed: 0, skipped: true };
  }

  const subscriptions = await getSubscriptionsForUser(userId);
  let sent = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload),
      );
      sent++;
    } catch (err) {
      failed++;
      if (err.statusCode === 404 || err.statusCode === 410) {
        const db = await getDb();
        await runSql(db, 'DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
      }
      logger.error('pushService', `Envoi push echoue (user ${userId})`, err);
    }
  }

  return { sent, failed };
}

async function envoyerConfirmationPush(reservationId) {
  const db = await getDb();
  const reservation = await queryOne(db, `SELECT r.*, t.nom AS terrain_nom
    FROM reservations r JOIN terrains t ON t.id = r.terrain_id WHERE r.id = ?`, [reservationId]);
  if (!reservation?.joueur_id) return;

  await sendToUser(reservation.joueur_id, {
    title: 'Réservation confirmée ⚽',
    body: `${reservation.terrain_nom} — ${reservation.date} à ${reservation.heure_debut}. Code : ${reservation.code_reservation || 'N/A'}`,
    url: '/reservations',
    tag: `reservation-${reservationId}`,
    type: 'reservation_confirmation',
  }, 'reservation_confirmation');

  await runSql(db, `INSERT INTO notifications (destinataire_type, destinataire_id, type, canal, contenu, lu)
    VALUES ('user', ?, 'confirmation', 'push', ?, 0)`, [
    reservation.joueur_id,
    `Réservation confirmée : ${reservation.terrain_nom} le ${reservation.date} à ${reservation.heure_debut}`,
  ]);
}

function parseReservationDateTime(dateStr, timeStr) {
  const date = String(dateStr).slice(0, 10);
  const time = String(timeStr).slice(0, 5);
  return new Date(`${date}T${time}:00`);
}

async function envoyerRappelsReservations() {
  if (!ensureConfigured()) return { processed: 0 };

  const db = await getDb();
  const now = new Date();
  const windowStart = new Date(now.getTime() + 45 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 75 * 60 * 1000);

  const reservations = await queryAll(db, `
    SELECT r.*, t.nom AS terrain_nom
    FROM reservations r
    JOIN terrains t ON t.id = r.terrain_id
    LEFT JOIN reservation_reminders rr ON rr.reservation_id = r.id
    WHERE r.statut IN ('confirme', 'acceptee')
      AND r.joueur_id IS NOT NULL
      AND rr.id IS NULL
      AND r.date >= CURRENT_DATE
  `);

  let processed = 0;

  for (const reservation of reservations) {
    const startAt = parseReservationDateTime(reservation.date, reservation.heure_debut);
    if (Number.isNaN(startAt.getTime())) continue;
    if (startAt < windowStart || startAt > windowEnd) continue;

    const prefs = await getPreferences(reservation.joueur_id);
    if (!prefs.rappel_reservation) continue;

    const result = await sendToUser(reservation.joueur_id, {
      title: 'Rappel — match dans 1h ⏰',
      body: `${reservation.terrain_nom} — ${reservation.date} à ${reservation.heure_debut}. Préparez-vous !`,
      url: '/reservations',
      tag: `reminder-${reservation.id}`,
      type: 'rappel_reservation',
    }, 'rappel_reservation');

    if (result.sent > 0) {
      await runSql(db, 'INSERT INTO reservation_reminders (reservation_id) VALUES (?)', [reservation.id]);
      await runSql(db, `INSERT INTO notifications (destinataire_type, destinataire_id, type, canal, contenu, lu)
        VALUES ('user', ?, 'rappel', 'push', ?, 0)`, [
        reservation.joueur_id,
        `Rappel : match au ${reservation.terrain_nom} dans 1h`,
      ]);
      processed++;
    }
  }

  return { processed };
}

module.exports = {
  getPublicKey,
  ensureConfigured,
  upsertSubscription,
  removeSubscription,
  getPreferences,
  updatePreferences,
  sendToUser,
  envoyerConfirmationPush,
  envoyerRappelsReservations,
};
