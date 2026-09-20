const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const client = require('./whatsappClient');
const { getDb, queryOne, runSql } = require('./database');
const { masquerNumero } = require('./services/calculsPaiement');
const { UPLOAD_ROOT } = require('./terrainPhotoService');
const { serializeQrPayload } = require('./services/qrPayload');
const { calculerFenetreCheckIn, DEFAULT_FENETRE_RETARD_MIN } = require('./services/checkInFenetre');

function digitsPhone(telephone) {
  let numero = String(telephone || '').replace(/\D/g, '');
  if (numero.startsWith('00')) numero = numero.slice(2);
  if (numero.startsWith('0') && numero.length === 10) numero = numero.slice(1);
  if (numero.startsWith('221') && numero.length >= 12) return numero.slice(0, 12);
  if (numero.length === 9) return `221${numero}`;
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

async function envoyerMessage(telephone, message, sessionKey = 'platform', meta = {}) {
  const key = sessionKey || 'platform';
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
    return { ok: false, queued: true, error };
  }
}

/** Alias CDC */
const envoyerWhatsApp = envoyerMessage;

async function envoyerImageWhatsApp(telephone, mediaUrl, caption, sessionKey = 'platform') {
  if (!telephone || !mediaUrl) return { ok: true, skipped: true };
  const key = sessionKey || 'platform';
  if (String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true') {
    console.log(`[WHATSAPP MOCK][${key}] Image vers ${telephone} : ${mediaUrl} (${caption || ''})`);
    return { ok: true, mocked: true };
  }
  try {
    await client.sendImageForSession(key, formatNumero(telephone), {
      url: mediaUrl,
      caption: caption || '',
    });
    return { ok: true };
  } catch (error) {
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

function sessionKeyFromReservation(reservation = {}) {
  return client.gerantSessionKey(reservation.gerant_id) || 'platform';
}

async function details(reservationId) {
  const db = await getDb();
  return queryOne(
    db,
    `SELECT r.*, t.nom AS terrain_nom, t.adresse, t.ville, t.latitude, t.longitude,
      e.id AS gerant_id, e.nom AS gerant_nom, e.telephone AS gerant_telephone, e.whatsapp_number AS gerant_whatsapp,
      u.prenom AS joueur_prenom, u.telephone AS joueur_tel_user
     FROM reservations r
     JOIN terrains t ON t.id = r.terrain_id
     LEFT JOIN employes e ON e.terrain_id = t.id AND e.is_active = 1
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
async function assurerQrCodeUrl(reservationId) {
  const db = await getDb();
  const row = queryOne(
    db,
    `SELECT r.id, r.code_reservation, r.qr_code_url, r.qr_code_payload, r.creneau_id, r.terrain_id,
            r.date, r.heure_debut, r.heure_fin,
            COALESCE(c.fenetre_retard, ${DEFAULT_FENETRE_RETARD_MIN}) AS fenetre_retard
     FROM reservations r
     LEFT JOIN creneaux c ON c.id = r.creneau_id
     WHERE r.id = ?`,
    [reservationId]
  );
  if (!row) return null;
  if (row.qr_code_url) return row.qr_code_url;
  if (!row.code_reservation) return null;

  const fenetre = calculerFenetreCheckIn({
    date: row.date,
    heure_debut: row.heure_debut,
    heure_fin: row.heure_fin,
    fenetre_retard: row.fenetre_retard,
  });
  const payload = row.qr_code_payload || serializeQrPayload({
    reservation_id: row.id,
    code: row.code_reservation,
    creneau_id: row.creneau_id,
    terrain_id: row.terrain_id,
    expire_at: Math.floor(fenetre.finFenetre / 1000),
  });

  const dir = path.join(UPLOAD_ROOT, 'qr');
  fs.mkdirSync(dir, { recursive: true });
  const safeCode = String(row.code_reservation).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${safeCode}.png`;
  const absolute = path.join(dir, filename);
  await QRCode.toFile(absolute, payload, {
    type: 'png',
    width: 480,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
  const publicUrl = `/uploads/qr/${filename}`;
  runSql(db, 'UPDATE reservations SET qr_code_url = ?, qr_code_payload = COALESCE(qr_code_payload, ?) WHERE id = ?', [
    publicUrl,
    payload,
    reservationId,
  ]);
  return publicUrl;
}

/** Template 1 — OTP inscription */
async function envoyerOTP({ telephone, prenom, code }) {
  await envoyerWhatsApp(
    telephone,
    `👋 Salut ${prenom || ''} ! Bienvenue sur TerrainSN.\n\n` +
      `Ton code de confirmation : *${code}*\n` +
      `Il est valable 10 minutes. Ne le partage avec personne 🔒`
  );
}

/** Template 3 — Lien paiement réservation téléphone / gérant */
async function envoyerLienPaiement(reservationId) {
  const data = await details(reservationId);
  if (!data) return;
  const prenom = prenomJoueur(data);
  const tel = telephoneJoueur(data);
  const lien = data.lien_paiement || data.lien_paytech;
  const waKey = sessionKeyFromReservation(data);
  await envoyerWhatsApp(
    tel,
    `👋 Salut ${prenom} !\n\n` +
      `Le gérant de *${data.terrain_nom}* a enregistré ta résa ` +
      `pour le ${formaterDate(data.date)} ` +
      `à ${formaterHeure(data.heure_debut)}.\n\n` +
      `Pour confirmer ta place, paie ton avance de ` +
      `*${formaterMontant(data.montant_avance || data.acompte)}* ici :\n` +
      `👉 ${lien}\n\n` +
      `Le reste (*${formaterMontant(data.montant_restant || data.reste_a_payer)}*) ` +
      `tu l'amènes le jour du match, pas de stress 😊\n\n` +
      `⚠️ Ce lien est valable *2 heures*. Après ça, la place repart.`,
    waKey
  );
}

/** Template 2 — Confirmation réservation avec QR code */
async function envoyerConfirmation(reservationId) {
  const qrUrl = await assurerQrCodeUrl(reservationId);
  const data = await details(reservationId);
  if (!data) return;
  if (qrUrl) data.qr_code_url = qrUrl;

  const prenom = prenomJoueur(data);
  const tel = telephoneJoueur(data);
  const quartier = data.adresse || data.ville || '';
  const lienMaps =
    data.latitude && data.longitude
      ? `https://maps.google.com/?q=${data.latitude},${data.longitude}`
      : null;

  const message =
    `⚽ C'est confirmé ${prenom} !\n\n` +
    `Ton terrain t'attend :\n` +
    `📍 ${data.terrain_nom} — ${quartier}\n` +
    `🗓️ ${formaterDate(data.date)} à ${formaterHeure(data.heure_debut)}\n` +
    `🏷️ Code : *${data.code_reservation}*\n\n` +
    (lienMaps ? `🗺️ Itinéraire : ${lienMaps}\n\n` : '') +
    `💰 Avance payée : ${formaterMontant(data.montant_avance || data.acompte)} (hors frais opérateur)\n` +
    `💵 À régler sur place : ${formaterMontant(data.montant_restant || data.reste_a_payer)}\n\n` +
    `📌 Viens *30 minutes avant* avec ce QR code, ` +
    `c'est lui qui ouvre les portes 😄\n` +
    `⚠️ Ce QR code est à usage unique — ne le partage pas.`;

  const waKey = sessionKeyFromReservation(data);
  await envoyerWhatsApp(tel, message, waKey);

  if (data.qr_code_url) {
    const domain = (process.env.APP_DOMAIN || 'http://localhost:8080').replace(/\/$/, '');
    const relative = String(data.qr_code_url).replace(/^\/uploads\//, '');
    const absolutePath = path.join(UPLOAD_ROOT, relative);
    const caption = `QR Code — ${data.code_reservation}`;

    if (fs.existsSync(absolutePath) && String(process.env.WHATSAPP_MOCK).toLowerCase() !== 'true') {
      try {
        await client.sendImageForSession(waKey, formatNumero(tel), {
          filePath: absolutePath,
          mimetype: 'image/png',
          caption,
        });
      } catch (error) {
        try {
          const retryQueue = require('./services/notificationRetryQueue');
          await retryQueue.enfiler({
            telephone: tel,
            message: `[IMAGE_QR] ${caption} ${data.qr_code_url}`,
            session_key: waKey,
            type: 'image_qr',
            erreur: error.message || String(error),
            http_status: error.statusCode || error.status || 500,
          });
        } catch {
          // best-effort
        }
      }
    } else {
      const imageUrl = data.qr_code_url.startsWith('http')
        ? data.qr_code_url
        : `${domain}${data.qr_code_url}`;
      await envoyerImageWhatsApp(tel, imageUrl, caption, waKey);
    }
  }

  if (data.gerant_whatsapp || data.gerant_telephone) {
    await envoyerWhatsApp(
      data.gerant_whatsapp || data.gerant_telephone,
      `Avance reçue chez TerrainSN — pas encore un virement vers toi.\n` +
        `Joueur : ${data.joueur_nom}. ${data.date} à ${formaterHeure(data.heure_debut)}. Code : ${data.code_reservation}.\n` +
        `Reste sur place : ${formaterMontant(data.montant_restant || data.reste_a_payer)}.\n` +
        `Ton dû s'accumule selon le contrat du terrain (auto / retrait).`,
      waKey,
      { destinataire_type: 'gerant', destinataire_id: data.gerant_id, type: 'avance_payee_gerant' },
    );
  }
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
    `😕 Oups ${prenom}...\n\n` +
      `Quelqu'un a grillé la priorité sur ce créneau à la ` +
      `dernière seconde. Ton paiement sera remboursé sous 24h, promis.\n\n` +
      `Mais t'inquiète, voilà ce qui est encore dispo :\n` +
      `👉 ${lienDispo}\n\n` +
      `On t'en trouve un autre 💪`,
    sessionKeyFromReservation(data)
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
    `Dû gérant mis à jour${nom ? ` ${nom}` : ''}.\n\n` +
      `Réservation *${code}* confirmée (avance chez TerrainSN, pas encore un virement).\n` +
      (avance != null ? `Avance joueur : ${formaterMontant(avance)}\n` : '') +
      `Commission plateforme : ${formaterMontant(commission)}\n` +
      `*Crédité sur ton compte : ${formaterMontant(reverse)}*\n\n` +
      `Solde disponible : *${formaterMontant(solde)}*`
  );
}

const envoyerReversementGerant = envoyerReversement;

async function envoyerDuAccumuleGerant({ contrat, du, reservationId }) {
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
    undefined,
    { destinataire_type: 'gerant', destinataire_id: contrat.gerant_id, type: 'du_accumule' },
  );
}

async function envoyerPayoutAutoEnCours({ contrat, du }) {
  if (!contrat?.gerant_whatsapp) return;
  await envoyerWhatsApp(
    contrat.gerant_whatsapp,
    `Reversement en cours vers ton Wave/OM (${formaterMontant(du.du_gerant)}).`,
    undefined,
    { destinataire_type: 'gerant', destinataire_id: contrat.gerant_id, type: 'payout_auto_en_cours' },
  );
}

async function envoyerPayoutAutoOk({ contrat, du, dest }) {
  if (!contrat?.gerant_whatsapp) return;
  const suffixe = masquerNumero(dest?.numero || contrat.wave_numero || contrat.om_numero);
  await envoyerWhatsApp(
    contrat.gerant_whatsapp,
    `${formaterMontant(du.du_gerant)} envoyés sur ${suffixe}.`,
    undefined,
    { destinataire_type: 'gerant', destinataire_id: contrat.gerant_id, type: 'payout_auto_ok' },
  );
}

async function envoyerPayoutManuelOk({ contrat, montant, numero }) {
  if (!contrat?.gerant_whatsapp) return;
  await envoyerWhatsApp(
    contrat.gerant_whatsapp,
    `${formaterMontant(montant)} envoyés manuellement sur ${masquerNumero(numero)}.`,
    undefined,
    { destinataire_type: 'gerant', destinataire_id: contrat.gerant_id, type: 'payout_manuel_ok' },
  );
}

async function envoyerEchecPayout({ contrat, du, raison }) {
  const msg =
    `Échec du reversement auto (${formaterMontant(du?.du_gerant)}). Dû inchangé. ` +
    `Corriger le numéro Wave/OM si besoin. ${raison || ''}`.trim();
  if (contrat?.gerant_whatsapp) {
    await envoyerWhatsApp(contrat.gerant_whatsapp, msg, undefined, {
      destinataire_type: 'gerant',
      destinataire_id: contrat.gerant_id,
      type: 'payout_echec',
    });
  }
  await envoyerWhatsApp(process.env.WHATSAPP_DEV_NUMBER || process.env.WHATSAPP_EQUIPE_DEV, msg, undefined, {
    destinataire_type: 'superadmin',
    destinataire_id: 0,
    type: 'payout_echec_admin',
  });
}

async function envoyerAlerteNumeroManquant(contrat) {
  const msg = `Terrain ${contrat?.terrain_nom || contrat?.terrain_id} : 1er dû sans Wave/OM gérant vérifié. Configurer en superadmin.`;
  await envoyerWhatsApp(process.env.WHATSAPP_DEV_NUMBER || process.env.WHATSAPP_EQUIPE_DEV, msg, undefined, {
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
    undefined,
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
    sessionKeyFromReservation(data),
    { destinataire_type: 'joueur', destinataire_id: data.joueur_id, type: 'annulation' },
  );
}

async function envoyerAlerteSilencieuse({ telephone, prenom, gerant_prenom, terrain_nom }) {
  await envoyerWhatsApp(
    telephone,
    `Petit point sur ${terrain_nom} ${prenom || ''}.\n\n` +
      `Ces deux derniers mois, quelques indicateurs sont un peu bas pour ${gerant_prenom || 'votre gerant'}. ` +
      `Rien d'alarmant, mais ca vaut peut-etre une petite discussion avec lui.\n\n` +
      `Tu peux voir le detail dans ton dashboard.`
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
  sessionKeyFromReservation,
};
