const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const client = require('./whatsappClient');
const whatsappManager = require('./services/whatsappManager');
const { getDb, queryOne, runSql } = require('./database');
const { masquerNumero } = require('./services/calculsPaiement');
const { UPLOAD_ROOT } = require('./terrainPhotoService');
const { signQrPayload, verifyQrPayload } = require('./domain/qrSignature');
const { calculerFenetreCheckIn, DEFAULT_FENETRE_RETARD_MIN } = require('./services/checkInFenetre');

/** Session plateforme (OTP, admin, notifs → gérants/proprios) */
const SESSION_PLATFORM = 'platform';

function digitsPhone(telephone) {
  // Aligne sur toWaIntlDigits (OpenWA) — uniquement SN mobile 7X
  const intl = client.toWaIntlDigits(telephone);
  if (intl) return intl;
  let numero = String(telephone || '').replace(/\D/g, '');
  if (numero.startsWith('00')) numero = numero.slice(2);
  if (numero.startsWith('0') && numero.length === 10) numero = numero.slice(1);
  if (numero.length === 9 && numero.startsWith('7')) return `221${numero}`;
  if (numero.startsWith('221') && numero.length >= 12) return numero.slice(0, 12);
  return numero;
}

function formatNumero(telephone) {
  const numero = digitsPhone(telephone);
  if (!/^2217\d{8}$/.test(numero)) {
    throw new Error(`Numero WhatsApp senegalais invalide : ${telephone}`);
  }
  return `${numero}@c.us`;
}

/** Stockage / affichage normalise : +221 77 XXX XX XX */
function normalizeTelephoneStore(telephone) {
  const numero = digitsPhone(telephone);
  if (!/^2217\d{8}$/.test(numero)) {
    throw new Error('Numero WhatsApp invalide. Saisissez 9 chiffres (ex: 77 826 12 25)');
  }
  return `+${numero.slice(0, 3)} ${numero.slice(3, 5)} ${numero.slice(5, 8)} ${numero.slice(8, 10)} ${numero.slice(10)}`;
}

function formaterDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('fr-SN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function formaterHeure(heureStr) {
  return String(heureStr || '').substring(0, 5);
}

function formaterMontant(montant) {
  return Number(montant || 0).toLocaleString('fr-SN') + ' FCFA';
}

async function envoyerMessage(telephone, message, sessionKey = SESSION_PLATFORM, meta = {}) {
  // null explicite = gérant déconnecté → ne pas envoyer (pas de fallback platform)
  if (sessionKey === null) {
    console.warn(`[Notif] Envoi annulé (${meta.type || 'message'}) — session WhatsApp indisponible`);
    return { ok: false, skipped: true, reason: 'session_indisponible' };
  }
  const key = sessionKey || SESSION_PLATFORM;
  try {
    const db = await getDb();
    runSql(
      db,
      `INSERT INTO notifications (destinataire_type, destinataire_id, type, canal, contenu)
       VALUES (?, ?, ?, 'whatsapp', ?)`,
      [meta.destinataire_type || 'unknown', meta.destinataire_id || 0, meta.type || 'message', String(message || '')],
    );
  } catch {
    // persistance best-effort
  }
  if (!telephone) return { ok: true, skipped: true };
  if (String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true') {
    console.log(`[WHATSAPP MOCK][${key}] Message vers ${telephone} : ${message}`);
    return { ok: true, mocked: true };
  }
  try {
    await client.sendMessageForSession(key, formatNumero(telephone), message);
    return { ok: true };
  } catch (error) {
    // Paiement / flux métier restent valides : la notif part en file de rejeu.
    if (!meta.skipRetryQueue) {
      try {
        const retryQueue = require('./services/notificationRetryQueue');
        await retryQueue.enfiler({
          telephone,
          message: String(message || ''),
          session_key: key,
          type: meta.type || 'message',
          destinataire_type: meta.destinataire_type,
          destinataire_id: meta.destinataire_id,
          erreur: error.message || String(error),
          http_status: error.statusCode || error.status || 500,
          idempotency_key: meta.idempotency_key || null,
        });
      } catch {
        // file best-effort
      }
    }
    return { ok: false, queued: !meta.skipRetryQueue, error };
  }
}

/** Alias CDC */
const envoyerWhatsApp = envoyerMessage;

async function envoyerImageWhatsApp(telephone, mediaUrl, caption, sessionKey = SESSION_PLATFORM, options = {}) {
  if (!telephone || !mediaUrl) return { ok: true, skipped: true };
  // null explicite = gérant déconnecté → NE PAS fallback sur platform (superadmin)
  if (sessionKey === null) {
    console.warn('[Notif] Image annulée — session WhatsApp gérant indisponible');
    return { ok: false, skipped: true, reason: 'session_indisponible' };
  }
  const key = sessionKey || SESSION_PLATFORM;
  if (String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true') {
    console.log(`[WHATSAPP MOCK][${key}] Image vers ${telephone} : ${mediaUrl} (${caption || ''})`);
    return { ok: true, mocked: true };
  }
  try {
    // /uploads/… ou chemin local → disque → base64 (jamais dépendre d'un fetch
    // public par OpenWA, ni d'APP_DOMAIN=localhost injoignable depuis le serveur distant).
    const raw = String(mediaUrl);
    let media;
    if (/^https?:\/\//i.test(raw)) {
      media = { url: raw, caption: caption || '' };
    } else {
      const cheminAbsolu = path.isAbsolute(raw) && !raw.startsWith('/uploads/')
        ? raw
        : path.join(UPLOAD_ROOT, raw.replace(/^\/?uploads\//, ''));
      if (!fs.existsSync(cheminAbsolu)) {
        throw Object.assign(new Error(`[QR] Fichier introuvable : ${cheminAbsolu}`), { statusCode: 404 });
      }
      media = {
        filePath: cheminAbsolu,
        mimetype: 'image/png',
        filename: path.basename(cheminAbsolu),
        caption: caption || '',
      };
    }
    await client.sendImageForSession(key, formatNumero(telephone), media);
    return { ok: true };
  } catch (error) {
    if (options.skipRetryQueue) return { ok: false, queued: false, error };
    try {
      const retryQueue = require('./services/notificationRetryQueue');
      await retryQueue.enfiler({
        telephone,
        message: `[IMAGE] ${caption || ''} ${mediaUrl}`.trim(),
        session_key: key,
        type: 'image',
        erreur: error.message || String(error),
        http_status: error.statusCode || error.status || 500,
      });
    } catch {
      // best-effort
    }
    return { ok: false, queued: true, error };
  }
}

/**
 * Session OpenWA pour messages JOUEUR liés à un terrain.
 *
 * RÈGLE ABSOLUE : seul le WhatsApp du gérant du terrain envoie
 * (confirmation, lien paiement manuel, remboursement, rappel, check-in).
 * Le superadmin (platform) n'envoie JAMAIS un message terrain.
 * Gérant absent / déconnecté → null (message non envoyé + log),
 * AUCUN fallback vers platform.
 */
async function sessionKeyFromReservation(reservation = {}) {
  const clientId = await whatsappManager.getClientPourTerrain(
    reservation.terrain_id,
    reservation.gerant_id,
  );
  if (!clientId) return null;

  // Garde-fou : getClientPourTerrain ne doit jamais renvoyer le superadmin
  // pour un message terrain (ancien fallback session partagée / WA_FALLBACK_PLATFORM).
  if (clientId === 'superadmin' || clientId === 'platform') {
    console.warn(
      `[Notif] Message terrain bloqué — aucun client gérant prêt (terrain=${reservation.terrain_id || '?'}). ` +
        'Pas d\'envoi depuis le superadmin.',
    );
    return null;
  }
  return whatsappManager.toSessionKey(clientId);
}

async function details(reservationId) {
  const db = await getDb();
  return queryOne(
    db,
    `SELECT r.*, t.nom AS terrain_nom, t.adresse, t.ville, t.latitude, t.longitude,
      t.delai_verrou_paiement_min,
      e.id AS gerant_id, e.nom AS gerant_nom, e.telephone AS gerant_telephone, e.whatsapp_number AS gerant_whatsapp,
      u.prenom AS joueur_prenom, u.telephone AS joueur_tel_user
     FROM reservations r
     JOIN terrains t ON t.id = r.terrain_id
     LEFT JOIN employes e ON e.id = COALESCE(
       t.gerant_id,
       (SELECT e2.id FROM employes e2
         WHERE e2.terrain_id = t.id AND e2.is_active = 1
         ORDER BY e2.id ASC LIMIT 1)
     )
     LEFT JOIN users u ON u.id = r.joueur_id
     WHERE r.id = ?
     LIMIT 1`,
    [reservationId]
  );
}

function telephoneJoueur(data) {
  return data?.joueur_telephone || data?.joueur_tel_user || null;
}

function prenomJoueur(data) {
  return data?.joueur_prenom || String(data?.joueur_nom || '').split(/\s+/)[0] || '';
}

/**
 * Génère (si besoin) le QR PNG de la réservation et persiste qr_code_url.
 * Contenu encodé = JSON métier (reservation_id + code) pour le scan gérant.
 */
async function assurerQrCodeUrl(reservationId, { force = false } = {}) {
  const db = await getDb();
  const row = queryOne(
    db,
    `SELECT r.id, r.code_reservation, r.qr_code_url, r.qr_code_payload, r.creneau_id, r.terrain_id,
            r.date, r.heure_debut, r.heure_fin,
            t.nom AS terrain_nom,
            COALESCE(c.fenetre_retard, ${DEFAULT_FENETRE_RETARD_MIN}) AS fenetre_retard
     FROM reservations r
     LEFT JOIN creneaux c ON c.id = r.creneau_id
     LEFT JOIN terrains t ON t.id = r.terrain_id
     WHERE r.id = ?`,
    [reservationId]
  );
  if (!row) return null;
  if (!row.code_reservation) return null;
  // qr_code_url en DB ≠ PNG sur le disque (redéploiement / disque éphémère) :
  // ne faire confiance à l'URL que si le fichier existe, sinon régénérer ci-dessous.
  const dir = path.join(UPLOAD_ROOT, 'qr');
  const safeCode = String(row.code_reservation).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${safeCode}.png`;
  const absolute = path.join(dir, filename);
  const publicUrl = `/uploads/qr/${filename}`;

  // Le QR doit TOUJOURS être signé (HMAC) et associé à CETTE réservation :
  // on vérifie la signature ET la correspondance (reservation_id, code,
  // terrain). Un payload legacy non signé, ou associé à un autre code,
  // est régénéré — sinon le scan gérant rejette le QR du joueur.
  const payloadStocke = String(row.qr_code_payload || '');
  const verif = payloadStocke ? verifyQrPayload(payloadStocke) : { ok: false };
  const payloadOk = Boolean(
    verif.ok
      && verif.reservation_id === Number(row.id)
      && verif.code === String(row.code_reservation).toUpperCase()
      && verif.terrain_id === Number(row.terrain_id),
  );
  let payload = payloadStocke;
  if (!payloadOk) {
    const fenetre = calculerFenetreCheckIn({
      date: row.date,
      heure_debut: row.heure_debut,
      heure_fin: row.heure_fin,
      fenetre_retard: row.fenetre_retard,
    });
    payload = signQrPayload({
      reservation_id: row.id,
      code: row.code_reservation,
      creneau_id: row.creneau_id,
      terrain_id: row.terrain_id,
      expire_at: Math.floor(fenetre.finFenetre / 1000),
    });
  }

  // Ne jamais faire confiance à la seule URL en base : sur un disque
  // éphémère (Render), le PNG peut avoir disparu alors que qr_code_url
  // subsiste → l'URL publique renvoyait 404 et le joueur n'avait aucun QR.
  const fichierPresent = fs.existsSync(absolute) && fs.statSync(absolute).size > 0;
  // Régénérer si PNG absent, payload régénéré (ancien PNG périmé) ou force
  // (ex. changement de couleur du terrain via regenererQrCodeUrl).
  if (!fichierPresent || !payloadOk || force) {
    fs.mkdirSync(dir, { recursive: true });
    // QR stylisé à la charte du terrain (nom + couleur dynamiques).
    // Fallback QR brut si Sharp échoue : la confirmation ne doit jamais casser.
    let stylise = false;
    try {
      let couleur = null;
      try {
        couleur = queryOne(db, 'SELECT couleur_primaire FROM terrains WHERE id = ?', [row.terrain_id])?.couleur_primaire;
      } catch { /* colonne absente sur anciennes bases de test */ }
      const { genererQRCodeStylise } = require('./services/qrCodeService');
      await genererQRCodeStylise({
        payload,
        codeReservation: row.code_reservation,
        terrainNom: row.terrain_nom || 'TerrainSN',
        terrainCouleur: couleur || undefined,
        date: row.date,
        heureDebut: row.heure_debut,
        heureFin: row.heure_fin,
        cheminSortie: absolute,
      });
      stylise = true;
    } catch (err) {
      console.warn(`[QR] Stylisé indisponible (${err.message}) — QR brut pour ${row.code_reservation}`);
    }
    if (!stylise) {
      await QRCode.toFile(absolute, payload, {
        type: 'png',
        width: 480,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
    }
  }
  if (!payloadOk || row.qr_code_url !== publicUrl) {
    // Persiste le payload réellement encodé dans le PNG.
    runSql(db, 'UPDATE reservations SET qr_code_url = ?, qr_code_payload = ? WHERE id = ?', [
      publicUrl,
      payload,
      reservationId,
    ]);
  }
  return publicUrl;
}

/** URL publique absolue d'un QR (lien ouvrable depuis un téléphone). */
function qrImagePublicUrl(qrUrl) {
  const raw = String(qrUrl || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const domain = String(process.env.APP_DOMAIN || '').replace(/\/$/, '');
  const rel = raw.startsWith('/') ? raw : `/${raw}`;
  return domain ? `${domain}${rel}` : rel;
}

/**
 * Envoie le QR d'une réservation par WhatsApp.
 * 1) Image native (base64 via OpenWA) — mode 'image'.
 * 2) Si le moteur média OpenWA refuse (ex. 502 SEND_FAILED côté
 *    whatsapp-web.js hébergé), repli PROPRE : un texte avec le lien
 *    public de l'image. Jamais de marqueur technique type [IMAGE_QR]
 *    envoyé tel quel au joueur, et pas de job de rejeu « image »
 *    rejoué en texte brut.
 */
async function envoyerQrCodeWhatsApp({ telephone, sessionKey, codeReservation, qrUrl, reservationId } = {}) {
  if (!telephone || !qrUrl) return { ok: false, skipped: true, reason: 'qr_ou_telephone_manquant' };
  if (sessionKey === null) {
    console.warn('[Notif] QR non envoyé — session WhatsApp gérant indisponible');
    return { ok: false, skipped: true, reason: 'session_indisponible' };
  }
  const key = sessionKey || SESSION_PLATFORM;
  const caption = `QR ${codeReservation || ''}`.trim();
  const relative = String(qrUrl).replace(/^\/uploads\//, '');
  const absolutePath = path.join(UPLOAD_ROOT, relative);
  const isMock = String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true';

  if (!isMock && fs.existsSync(absolutePath)) {
    try {
      const res = await client.sendImageForSession(key, formatNumero(telephone), {
        filePath: absolutePath,
        mimetype: 'image/png',
        caption,
      });
      return { ok: true, mode: 'image', messageId: res?.messageId || null };
    } catch (error) {
      console.warn(
        `[Notif] Image QR ${codeReservation || ''} refusée par OpenWA (${error.message}) → repli lien public`,
      );
    }
  }

  const lien = qrImagePublicUrl(qrUrl);
  const texte =
    `📷 *${caption}*\n` +
    `Ouvre ce lien pour afficher ton QR code, puis présente-le à l'entrée (usage unique) :\n${lien}`;
  const resTexte = await envoyerWhatsApp(telephone, texte, key, {
    type: 'qr_lien',
    destinataire_type: 'joueur',
    destinataire_id: 0,
    idempotency_key: reservationId ? `qr-lien:${reservationId}` : undefined,
  });
  return { ...resTexte, mode: resTexte?.ok ? 'lien' : 'echec' };
}

/** Template 1 — OTP inscription (toujours superadmin / platform) */
async function envoyerOTP({ telephone, prenom, code }) {
  await envoyerWhatsApp(
    telephone,
    `TerrainSN — code : *${code}*\nValable 10 min.`,
    SESSION_PLATFORM,
    { type: 'otp', destinataire_type: 'joueur' },
  );
}

/**
 * Template 3 — Lien paiement par WhatsApp.
 * UNIQUEMENT pour les réservations manuelles créées par le gérant
 * (le joueur n'est pas devant l'écran et doit payer plus tard).
 * En ligne (origine 'joueur'), le joueur est déjà redirigé vers PayTech :
 * aucun lien WhatsApp (redondance / confusion) → envoi refusé ici,
 * même si un ancien appelant le demande encore.
 */
async function envoyerLienPaiement(reservationId, options = {}) {
  if (options.origine === 'joueur') {
    console.warn(
      `[Notif] Lien paiement WhatsApp refusé pour résa #${reservationId} — ` +
        'parcours en ligne : redirection PayTech directe, pas de WhatsApp.',
    );
    return { ok: false, skipped: true, reason: 'lien_en_ligne_interdit' };
  }
  const data = await details(reservationId);
  if (!data) return { ok: false, error: new Error('Réservation introuvable') };
  const prenom = prenomJoueur(data);
  const tel = telephoneJoueur(data);
  if (!tel) return { ok: false, skipped: true, error: new Error('Téléphone joueur manquant') };
  const lien = data.lien_paiement || data.lien_paytech;
  if (!lien) return { ok: false, error: new Error('Lien de paiement manquant') };
  const waKey = await sessionKeyFromReservation(data);
  const minutes = Math.max(1, Number(data.delai_verrou_paiement_min) || 15);
  const intro = `Résa *${data.terrain_nom}* — ${formaterDate(data.date)} ${formaterHeure(data.heure_debut)}`;
  return envoyerWhatsApp(
    tel,
    `${prenom ? `${prenom}, ` : ''}${intro}.\n` +
      `Avance *${formaterMontant(data.montant_avance || data.acompte)}* : ${lien}\n` +
      `Reste sur place : ${formaterMontant(data.montant_restant || data.reste_a_payer)}\n` +
      `Lien valable ${minutes} min.`,
    waKey,
    {
      type: 'lien_paiement',
      destinataire_type: 'joueur',
      destinataire_id: data.joueur_id || 0,
      idempotency_key: `lien_paiement:${reservationId}`,
    },
  );
}

/** Template 2 — Confirmation réservation avec QR code */
async function envoyerConfirmation(reservationId) {
  const qrUrl = await assurerQrCodeUrl(reservationId);
  const data = await details(reservationId);
  if (!data) return { ok: false, error: new Error('Réservation introuvable') };
  if (qrUrl) data.qr_code_url = qrUrl;

  const prenom = prenomJoueur(data);
  const tel = telephoneJoueur(data);
  const quartier = data.adresse || data.ville || '';
  const lienMaps =
    data.latitude && data.longitude
      ? `https://maps.google.com/?q=${data.latitude},${data.longitude}`
      : null;

  const message =
    `Confirmé${prenom ? ` ${prenom}` : ''} ✅\n` +
    `*${data.terrain_nom}*${quartier ? ` — ${quartier}` : ''}\n` +
    `${formaterDate(data.date)} ${formaterHeure(data.heure_debut)}\n` +
    `Code : *${data.code_reservation}*\n` +
    `Avance : ${formaterMontant(data.montant_avance || data.acompte)}\n` +
    `Reste sur place : ${formaterMontant(data.montant_restant || data.reste_a_payer)}\n` +
    (lienMaps ? `Maps : ${lienMaps}\n` : '') +
    `Présente le QR 30 min avant (usage unique).\n` +
    `Si le QR ne passe pas, donne ce code au gérant : *${data.code_reservation}* (il le saisira pour valider ton entrée).`;

  const waKey = await sessionKeyFromReservation(data);
  const texte = await envoyerWhatsApp(tel, message, waKey, {
    type: 'confirmation',
    destinataire_type: 'joueur',
    destinataire_id: data.joueur_id || 0,
    idempotency_key: `confirmation-texte:${reservationId}`,
  });

  if (waKey && data.qr_code_url) {
    // Image native d'abord ; repli lien public propre si le moteur média
    // OpenWA est indisponible. Aucun job « [IMAGE_QR] … » en file : c'est
    // ce marqueur, rejoué en texte brut, que le joueur recevait avant.
    await envoyerQrCodeWhatsApp({
      telephone: tel,
      sessionKey: waKey,
      codeReservation: data.code_reservation,
      qrUrl: data.qr_code_url,
      reservationId,
    }).catch((error) => {
      console.warn(`[Notif] Envoi QR résa #${reservationId} :`, error.message);
      return { ok: false, mode: 'echec', error };
    });
  }

  // Notifications AU gérant → toujours platform (jamais depuis son propre numéro)
  if (data.gerant_whatsapp || data.gerant_telephone) {
    await envoyerWhatsApp(
      data.gerant_whatsapp || data.gerant_telephone,
      `Avance reçue — ${data.joueur_nom}, ${data.date} ${formaterHeure(data.heure_debut)}, code ${data.code_reservation}.\n` +
        `Reste joueur : ${formaterMontant(data.montant_restant || data.reste_a_payer)}. Dû selon contrat.`,
      SESSION_PLATFORM,
      {
        destinataire_type: 'gerant',
        destinataire_id: data.gerant_id,
        type: 'avance_payee_gerant',
        idempotency_key: `avance_payee_gerant:${reservationId}`,
      },
    );
  }
  return texte || { ok: true };
}

/** Template 4 — Remboursement créneau pris */
async function envoyerRemboursement(reservationId) {
  const data = await details(reservationId);
  if (!data) return;
  const prenom = prenomJoueur(data);
  const tel = telephoneJoueur(data);
  const domain = (process.env.APP_DOMAIN || 'http://localhost:8080').replace(/\/$/, '');
  const lienDispo = `${domain}/terrain/${data.terrain_id}`;
  await envoyerWhatsApp(
    tel,
    `Créneau pris${prenom ? ` ${prenom}` : ''} — remboursement sous 24h.\n` +
      `Autres dispos : ${lienDispo}`,
    await sessionKeyFromReservation(data),
    { type: 'remboursement', destinataire_type: 'joueur', destinataire_id: data.joueur_id || 0 },
  );
}

/** Template 5 — Reversement solde gérant */
async function envoyerReversement({
  telephone,
  nom,
  montantReverse,
  montant_reverse,
  montantCommission,
  montant_commission,
  soldeTotal,
  solde_disponible,
  codeReservation,
  reservationId,
  montant_acompte,
  montant_avance,
}) {
  const reverse = montantReverse ?? montant_reverse;
  const commission = montantCommission ?? montant_commission;
  const solde = soldeTotal ?? solde_disponible;
  const code = codeReservation || (reservationId ? `TF-${reservationId}` : '');
  const avance = montant_avance ?? montant_acompte;
  await envoyerWhatsApp(
    telephone,
    `Dû mis à jour${nom ? ` ${nom}` : ''} — résa *${code}*.\n` +
      (avance != null ? `Avance : ${formaterMontant(avance)}\n` : '') +
      `Commission : ${formaterMontant(commission)}\n` +
      `Crédit : *${formaterMontant(reverse)}* — solde *${formaterMontant(solde)}*`,
    SESSION_PLATFORM,
    { type: 'reversement_gerant', destinataire_type: 'gerant' },
  );
}

const envoyerReversementGerant = envoyerReversement;

/**
 * Toast in-app (+ push si abonné) pour le gérant du contrat — jamais bloquant.
 * Complète les messages WhatsApp ci-dessous sans toucher au flux paiement.
 */
async function notifierGerantInApp(contrat, notif) {
  try {
    if (!contrat?.gerant_id) return;
    const pushService = require('./pushService');
    await pushService.notifyAccount({
      userId: contrat.gerant_id,
      accountType: 'employe',
      url: require('./lib/appDomains').withProPath('/backoffice/gerant/finances'),
      ...notif,
    });
  } catch {
    // best-effort
  }
}

async function envoyerDuAccumuleGerant({ contrat, du, reservationId }) {
  // Pas de toast in-app ici : la « nouvelle réservation » (pushService) couvre déjà l'événement.
  if (!contrat?.gerant_whatsapp) return;
  const mode = contrat.payout_mode === 'auto' ? 'auto' : 'retrait';
  await envoyerWhatsApp(
    contrat.gerant_whatsapp,
    `Avance joueur confirmée (résa #${reservationId}).\n` +
      `Dû ${mode} : ${formaterMontant(du.du_gerant)} (avance ${formaterMontant(du.avance)} − commission ${formaterMontant(du.commission)}` +
      (Number(du.frais_gerant) ? ` − frais ${formaterMontant(du.frais_gerant)}` : '') +
      `).\n` +
      (du.statut === 'en_fenetre'
        ? `Encore en fenêtre de remboursement — pas de virement pour l'instant.`
        : `Dû payable selon le contrat.`),
    SESSION_PLATFORM,
    { destinataire_type: 'gerant', destinataire_id: contrat.gerant_id, type: 'du_accumule' },
  );
}

async function envoyerPayoutAutoEnCours({ contrat, du }) {
  await notifierGerantInApp(contrat, {
    type: 'reversement_en_cours',
    titre: 'Reversement en cours',
    corps: `${formaterMontant(du?.du_gerant)} en route vers ton Wave/OM.`,
    level: 'info',
    tag: `payout-cours-${du?.id || du?.reservation_id || ''}`,
    prefColumn: 'push_reversement',
  });
  if (!contrat?.gerant_whatsapp) return;
  await envoyerWhatsApp(
    contrat.gerant_whatsapp,
    `Reversement en cours vers ton Wave/OM (${formaterMontant(du.du_gerant)}).`,
    SESSION_PLATFORM,
    { destinataire_type: 'gerant', destinataire_id: contrat.gerant_id, type: 'payout_auto_en_cours' },
  );
}

async function envoyerPayoutAutoOk({ contrat, du, dest }) {
  const suffixeInApp = masquerNumero(dest?.numero || contrat?.wave_numero || contrat?.om_numero);
  await notifierGerantInApp(contrat, {
    type: 'reversement_ok',
    titre: 'Reversement reçu ✅',
    corps: `${formaterMontant(du?.du_gerant)} envoyés sur ${suffixeInApp}.`,
    level: 'success',
    tag: `payout-ok-${du?.id || du?.reservation_id || ''}`,
    prefColumn: 'push_reversement',
  });
  if (!contrat?.gerant_whatsapp) return;
  const suffixe = suffixeInApp;
  await envoyerWhatsApp(
    contrat.gerant_whatsapp,
    `${formaterMontant(du.du_gerant)} envoyés sur ${suffixe}.`,
    SESSION_PLATFORM,
    { destinataire_type: 'gerant', destinataire_id: contrat.gerant_id, type: 'payout_auto_ok' },
  );
}

async function envoyerPayoutManuelOk({ contrat, montant, numero }) {
  await notifierGerantInApp(contrat, {
    type: 'reversement_ok',
    titre: 'Retrait versé ✅',
    corps: `${formaterMontant(montant)} envoyés sur ${masquerNumero(numero)}.`,
    level: 'success',
    prefColumn: 'push_reversement',
  });
  if (!contrat?.gerant_whatsapp) return;
  await envoyerWhatsApp(
    contrat.gerant_whatsapp,
    `${formaterMontant(montant)} envoyés manuellement sur ${masquerNumero(numero)}.`,
    SESSION_PLATFORM,
    { destinataire_type: 'gerant', destinataire_id: contrat.gerant_id, type: 'payout_manuel_ok' },
  );
}

async function envoyerEchecPayout({ contrat, du, raison }) {
  const msg =
    `Échec du reversement auto (${formaterMontant(du?.du_gerant)}). Dû inchangé. ` +
    `Corriger le numéro Wave/OM si besoin. ${raison || ''}`.trim();
  await notifierGerantInApp(contrat, {
    type: 'reversement_echec',
    titre: 'Échec du reversement',
    corps: `${formaterMontant(du?.du_gerant)} non versés. Vérifie ton numéro Wave/OM.`,
    level: 'error',
    tag: `payout-echec-${du?.id || du?.reservation_id || ''}`,
    prefColumn: 'push_reversement',
  });
  if (contrat?.gerant_whatsapp) {
    await envoyerWhatsApp(contrat.gerant_whatsapp, msg, SESSION_PLATFORM, {
      destinataire_type: 'gerant',
      destinataire_id: contrat.gerant_id,
      type: 'payout_echec',
    });
  }
  await envoyerWhatsApp(process.env.WHATSAPP_DEV_NUMBER || process.env.WHATSAPP_EQUIPE_DEV, msg, SESSION_PLATFORM, {
    destinataire_type: 'superadmin',
    destinataire_id: 0,
    type: 'payout_echec_admin',
  });
}

async function envoyerAlerteNumeroManquant(contrat) {
  const msg = `Terrain ${contrat?.terrain_nom || contrat?.terrain_id} : 1er dû sans Wave/OM gérant vérifié. Configurer en superadmin.`;
  await envoyerWhatsApp(process.env.WHATSAPP_DEV_NUMBER || process.env.WHATSAPP_EQUIPE_DEV, msg, SESSION_PLATFORM, {
    destinataire_type: 'superadmin',
    destinataire_id: 0,
    type: 'numero_manquant',
  });
}

async function envoyerTest100({ telephone, canal, montant = 100 }) {
  if (!telephone) return;
  await envoyerWhatsApp(
    telephone,
    `Mini-virement test ${montant} FCFA via ${canal === 'om' ? 'Orange Money' : 'Wave'}. Confirme-nous la réception.`,
    SESSION_PLATFORM,
    { destinataire_type: 'gerant', type: 'test_100' },
  );
}

async function envoyerAnnulation(reservationId, { rembourse = false, politique } = {}) {
  const data = await details(reservationId);
  if (!data) return;
  const prenom = prenomJoueur(data);
  const tel = telephoneJoueur(data);
  const texte = politique?.texte_joueur || (rembourse
    ? 'Ton avance sera remboursée (hors frais opérateur).'
    : 'Annulation sans remboursement de l’avance.');
  await envoyerWhatsApp(
    tel,
    `Réservation annulée ${prenom}.\n${texte}`,
    await sessionKeyFromReservation(data),
    { destinataire_type: 'joueur', destinataire_id: data.joueur_id, type: 'annulation' },
  );
}

async function envoyerAlerteSilencieuse({ telephone, prenom, gerant_prenom, terrain_nom }) {
  await envoyerWhatsApp(
    telephone,
    `Petit point sur ${terrain_nom} ${prenom || ''}.\n\n` +
      `Ces deux derniers mois, quelques indicateurs sont un peu bas pour ${gerant_prenom || 'votre gerant'}. ` +
      `Rien d'alarmant, mais ca vaut peut-etre une petite discussion avec lui.\n\n` +
      `Tu peux voir le detail dans ton dashboard.`,
    SESSION_PLATFORM,
    { type: 'alerte_proprio', destinataire_type: 'proprietaire' },
  );
}

/** Rappel match ~1h avant (WhatsApp). */
async function envoyerRappelReservation(reservationId) {
  const data = await details(reservationId);
  if (!data) return { ok: false, skipped: true };
  const { buildRappelWhatsAppMessage } = require('./services/reminderWindow');
  const message = buildRappelWhatsAppMessage({
    prenom: prenomJoueur(data),
    terrain_nom: data.terrain_nom,
    date: data.date,
    heure_debut: data.heure_debut,
    code_reservation: data.code_reservation,
  });
  return envoyerWhatsApp(telephoneJoueur(data), message, await sessionKeyFromReservation(data), {
    type: 'rappel',
    destinataire_type: 'joueur',
    destinataire_id: data.joueur_id || 0,
    idempotency_key: `rappel:${reservationId}`,
  });
}

/** Confirmation entrée après scan QR gérant. */
async function envoyerCheckinValide(reservationId) {
  const data = await details(reservationId);
  if (!data) return { ok: false, skipped: true };
  const tel = telephoneJoueur(data);
  if (!tel) return { ok: false, skipped: true };
  const prenom = prenomJoueur(data);
  return envoyerWhatsApp(
    tel,
    `Entrée OK${prenom ? ` ${prenom}` : ''} — *${data.terrain_nom}*\n` +
      `${formaterHeure(data.heure_debut)}–${formaterHeure(data.heure_fin)}. Bon match ⚽`,
    await sessionKeyFromReservation(data),
    {
      type: 'checkin',
      destinataire_type: 'joueur',
      destinataire_id: data.joueur_id || 0,
      idempotency_key: `checkin:${reservationId}`,
    },
  );
}

module.exports = {
  formatNumero,
  normalizeTelephoneStore,
  digitsPhone,
  formaterDate,
  formaterHeure,
  formaterMontant,
  envoyerMessage,
  envoyerWhatsApp,
  envoyerImageWhatsApp,
  assurerQrCodeUrl,
  envoyerQrCodeWhatsApp,
  qrImagePublicUrl,
  regenererQrCodeUrl: (reservationId) => assurerQrCodeUrl(reservationId, { force: true }),
  envoyerOTP,
  envoyerLienPaiement,
  envoyerConfirmation,
  envoyerRemboursement,
  envoyerReversement,
  envoyerReversementGerant,
  envoyerDuAccumuleGerant,
  envoyerPayoutAutoEnCours,
  envoyerPayoutAutoOk,
  envoyerPayoutManuelOk,
  envoyerEchecPayout,
  envoyerAlerteNumeroManquant,
  envoyerTest100,
  envoyerAnnulation,
  envoyerAlerteSilencieuse,
  envoyerRappelReservation,
  envoyerCheckinValide,
  sessionKeyFromReservation,
};
