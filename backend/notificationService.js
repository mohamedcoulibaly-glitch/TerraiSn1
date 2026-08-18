const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const client = require('./whatsappClient');
const { getDb, queryOne, runSql } = require('./database');
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

async function envoyerMessage(telephone, message, sessionKey = 'platform') {
  if (!telephone) return;
  const key = sessionKey || 'platform';
  if (String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true') {
    console.log(`[WHATSAPP MOCK][${key}] Message vers ${telephone} : ${message}`);
    return;
  }
  await client.sendMessageForSession(key, formatNumero(telephone), message);
}

/** Alias CDC */
const envoyerWhatsApp = envoyerMessage;

async function envoyerImageWhatsApp(telephone, mediaUrl, caption, sessionKey = 'platform') {
  if (!telephone || !mediaUrl) return;
  const key = sessionKey || 'platform';
  if (String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true') {
    console.log(`[WHATSAPP MOCK][${key}] Image vers ${telephone} : ${mediaUrl} (${caption || ''})`);
    return;
  }
  await client.sendImageForSession(key, formatNumero(telephone), {
    url: mediaUrl,
    caption: caption || '',
  });
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
    `💰 Avance payée : ${formaterMontant(data.montant_avance || data.acompte)}\n` +
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
      await client.sendImageForSession(waKey, formatNumero(tel), {
        filePath: absolutePath,
        mimetype: 'image/png',
        caption,
      });
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
      `Paiement reçu. Joueur : ${data.joueur_nom}. ${data.date} à ${formaterHeure(data.heure_debut)}. Code : ${data.code_reservation}.`,
      waKey
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
    `💰 Virement reçu${nom ? ` ${nom}` : ''} !\n\n` +
      `Réservation *${code}* confirmée.\n` +
      (avance != null ? `Avance joueur : ${formaterMontant(avance)}\n` : '') +
      `Commission plateforme : ${formaterMontant(commission)}\n` +
      `*Crédité sur ton compte : ${formaterMontant(reverse)}*\n\n` +
      `Solde disponible : *${formaterMontant(solde)}*`
  );
}

const envoyerReversementGerant = envoyerReversement;

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
  envoyerAlerteSilencieuse,
  sessionKeyFromReservation,
};
