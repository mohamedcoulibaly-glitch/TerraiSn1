const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const client = require('./whatsappClient');
const { getDb, queryOne, runSql } = require('./database');
const pushService = require('./pushService');

function firePush(work) {
  Promise.resolve()
    .then(work)
    .catch((err) => console.warn('[PUSH]', err.message || err));
}
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

/** Montants réservation pour WhatsApp — avance ≠ commission, jamais l'acompte terrain. */
function montantsReservation(data = {}) {
  const total = Number(data.prix_total || data.montant || 0);
  const avance = Number(data.montant_avance);
  const avanceOk = Number.isFinite(avance) && avance > 0 ? avance : Number(data.acompte || 0);
  const restantRaw = Number(data.montant_restant);
  const restant =
    Number.isFinite(restantRaw) && restantRaw >= 0
      ? restantRaw
      : Math.max(0, total - (Number.isFinite(avanceOk) ? avanceOk : 0));
  return {
    total: Number.isFinite(total) ? total : 0,
    avance: Number.isFinite(avanceOk) ? avanceOk : 0,
    restant: Number.isFinite(restant) ? restant : 0,
  };
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

/**
 * Session prête pour écrire au joueur : gérant si connecté, sinon plateforme.
 */
async function resolvePlayerOutboundSession(reservation = {}) {
  const preferred = sessionKeyFromReservation(reservation);
  try {
    const st = await client.getStatus(preferred);
    if (st?.connected) return preferred;
  } catch {
    /* ignore */
  }
  if (preferred !== 'platform') {
    try {
      const platform = await client.getStatus('platform');
      if (platform?.connected) {
        console.log(
          `↪️ Notif joueur via session plateforme (gérant ${preferred} non connecté)`,
        );
        return 'platform';
      }
    } catch {
      /* ignore */
    }
  }
  const err = new Error(
    preferred === 'platform'
      ? 'WhatsApp n’est pas connecté. Contactez le développeur.'
      : 'WhatsApp n’est pas connecté. Allez dans Paramètres pour le lier (ou reconnectez WhatsApp plateforme).',
  );
  err.statusCode = 503;
  throw err;
}

/**
 * Attache le gérant de garde (source de vérité multi-gérants) aux détails réservation.
 * Ne lit plus le premier employes.terrain_id au hasard.
 */
async function attachGerantDeGarde(data) {
  if (!data?.terrain_id) return data;
  const { getGerantDeGarde, getGerantPrincipal } = require('./services/gerantService');
  let garde = await getGerantDeGarde(data.terrain_id, new Date());
  if (!garde) {
    console.error(`[NOTIF] Aucun gérant trouvé pour terrain ${data.terrain_id}`);
    garde = await getGerantPrincipal(data.terrain_id);
  }
  if (!garde) return data;
  data.gerant_id = garde.gerant_id;
  data.gerant_nom = [garde.prenom, garde.nom].filter(Boolean).join(' ').trim() || garde.nom;
  data.gerant_prenom = garde.prenom;
  data.gerant_telephone = garde.telephone;
  data.gerant_whatsapp = garde.whatsapp_number || garde.telephone;
  data.gerant_est_principal = Number(garde.est_principal) === 1 ? 1 : 0;
  return data;
}

/** Notifie le gérant de garde + copie au principal si différent. */
async function notifierGerantTerrain(terrainId, message, sessionKey = 'platform', dateTime = new Date()) {
  const { getGerantDeGarde, getGerantPrincipal } = require('./services/gerantService');
  let garde = await getGerantDeGarde(terrainId, dateTime);
  if (!garde) {
    console.error(`[NOTIF] Aucun gérant trouvé pour terrain ${terrainId}`);
    garde = await getGerantPrincipal(terrainId);
  }
  if (!garde) return null;

  const tel = garde.whatsapp_number || garde.telephone;
  if (tel) {
    await envoyerWhatsApp(tel, message, sessionKey || client.gerantSessionKey(garde.gerant_id) || 'platform');
  }

  if (!Number(garde.est_principal)) {
    const principal = await getGerantPrincipal(terrainId);
    const pTel = principal?.whatsapp_number || principal?.telephone;
    if (principal && pTel && pTel !== tel) {
      const prenom = garde.prenom || 'Un gérant';
      await envoyerWhatsApp(
        pTel,
        `📋 [Info] ${prenom} est de garde et vient de recevoir la notification suivante :\n\n${message}`,
        client.gerantSessionKey(principal.gerant_id) || 'platform',
      );
    }
  }
  return garde;
}

async function details(reservationId) {
  const db = await getDb();
  const data = await queryOne(
    db,
    `SELECT r.*, t.nom AS terrain_nom, t.adresse, t.ville, t.latitude, t.longitude,
      u.prenom AS joueur_prenom, u.telephone AS joueur_tel_user
     FROM reservations r
     JOIN terrains t ON t.id = r.terrain_id
     LEFT JOIN users u ON u.id = r.joueur_id
     WHERE r.id = ?
     LIMIT 1`,
    [reservationId]
  );
  return attachGerantDeGarde(data);
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
  const row = await queryOne(
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
  await runSql(db, 'UPDATE reservations SET qr_code_url = ?, qr_code_payload = COALESCE(qr_code_payload, ?) WHERE id = ?', [
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
  const { avance, restant } = montantsReservation(data);
  await envoyerWhatsApp(
    tel,
    `👋 Salut ${prenom} !\n\n` +
      `Le gérant de *${data.terrain_nom}* a enregistré ta réservation ` +
      `pour le ${formaterDate(data.date)} ` +
      `à ${formaterHeure(data.heure_debut)}.\n\n` +
      `Pour confirmer ta place, paie ton avance de ` +
      `*${formaterMontant(avance)}* ici :\n` +
      `👉 ${lien}\n\n` +
      `Le reste (*${formaterMontant(restant)}*) ` +
      `tu l'amènes le jour du match, pas de stress 😊\n\n` +
      `⚠️ Ce lien est valable *2 heures*. Après ça, la place repart.`,
    waKey
  );
  firePush(() => pushService.notifyLienPaiement(reservationId));
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
    `💰 Avance payée : ${formaterMontant(montantsReservation(data).avance)}\n` +
    `💵 À régler sur place : ${formaterMontant(montantsReservation(data).restant)}\n\n` +
    `📌 Viens *30 minutes avant* avec ce QR code, ` +
    `c'est lui qui ouvre les portes 😄\n` +
    `⚠️ Ce QR code est à usage unique — ne le partage pas.`;

  const waKey = await resolvePlayerOutboundSession(data);
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

  if (data.terrain_id) {
    await notifierGerantTerrain(
      data.terrain_id,
      `Paiement reçu. Joueur : ${data.joueur_nom}. ${data.date} à ${formaterHeure(data.heure_debut)}. Code : ${data.code_reservation}.`,
      'platform',
    ).catch((err) => {
      console.warn('⚠️ Notif gérant après confirmation:', err.message || err);
    });
  }
  firePush(() => pushService.notifyReservationConfirmee(reservationId));
}

/** Template — confirmation manuelle (avance reçue hors PayTech) */
async function envoyerConfirmationManuelle(reservationId) {
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
    `💰 Avance reçue : ${formaterMontant(montantsReservation(data).avance)} ✓\n` +
    `💵 À régler sur place : ${formaterMontant(montantsReservation(data).restant)}\n\n` +
    `📌 Viens *30 minutes avant* avec ce QR code 😄\n` +
    `⚠️ Ce QR code est à usage unique.`;

  const waKey = await resolvePlayerOutboundSession(data);
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
  firePush(() => pushService.notifyReservationConfirmee(reservationId));
}

/** Template — créneau confirmé par un autre joueur (perdant non payé) */
async function envoyerCreneauPris(reservationId) {
  const data = await details(reservationId);
  if (!data) return;
  const prenom = prenomJoueur(data);
  const tel = telephoneJoueur(data);
  const domain = (process.env.APP_DOMAIN || 'http://localhost:8080').replace(/\/$/, '');
  const lienDispo = `${domain}/terrain/${data.terrain_id}`;
  await envoyerWhatsApp(
    tel,
    `😕 Oups ${prenom}...\n\n` +
      `Ce créneau du ${formaterDate(data.date)} à ${formaterHeure(data.heure_debut)} ` +
      `vient d'être confirmé par un autre joueur.\n\n` +
      `Ton lien de paiement n'est plus valable.\n\n` +
      `Voici ce qui est encore dispo :\n` +
      `👉 ${lienDispo}\n\n` +
      `On t'en trouve un autre 💪`,
    sessionKeyFromReservation(data)
  );
  firePush(() => pushService.notifyCreneauPris(reservationId));
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
  firePush(() => pushService.notifyRemboursement(reservationId));
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
  gerant_id,
  terrain_nom,
  terrain_id,
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
  if (gerant_id) {
    firePush(() =>
      pushService.notifyReversement(gerant_id, {
        montant: reverse,
        terrainNom: terrain_nom,
        terrainId: terrain_id,
      }),
    );
  }
}

/** Annulation joueur / gérant — messages selon politique terrain + notif gérants. */
async function envoyerAnnulation(
  reservationId,
  { rembourse = false, politique = null, traiteParGerant = false } = {},
) {
  const data = await details(reservationId);
  if (!data) return;
  const prenom = prenomJoueur(data);
  const tel = telephoneJoueur(data);
  const domain = (process.env.APP_DOMAIN || 'http://localhost:8080').replace(/\/$/, '');
  const lienDispo = `${domain}/terrain/${data.terrain_id}`;
  const code = data.code_reservation || `TF-${reservationId}`;
  const raison = politique?.raison || (rembourse ? 'dans_delai' : 'hors_delai');
  const typeLabel =
    politique?.type_annulation === 'avec_remboursement' || rembourse
      ? 'avec remboursement'
      : 'sans remboursement';

  let detailRemboursement;
  if (rembourse || raison === 'dans_delai') {
    detailRemboursement = `Type : *annulation avec remboursement*.\nTon avance sera remboursée sous 24h.`;
  } else if (raison === 'pas_confirmee') {
    detailRemboursement = `Type : *annulation sans remboursement*.\nAucun paiement n'avait encore été confirmé.`;
  } else if (raison === 'politique_sans_remboursement') {
    detailRemboursement =
      `Type : *annulation sans remboursement*.\n` +
      `La politique de ce terrain n'autorise pas de remboursement.`;
  } else {
    const delai = Number(politique?.delai_heures || 0);
    detailRemboursement =
      `Type : *annulation sans remboursement* (délai dépassé).\n` +
      (delai > 0
        ? `Le délai de ${delai} h après confirmation est dépassé : l'avance n'est pas remboursée.`
        : `L'avance n'est pas remboursée.`);
  }

  const initiateur = traiteParGerant ? 'par le gérant du terrain' : 'à ta demande';
  if (tel) {
    await envoyerWhatsApp(
      tel,
      `ℹ️ ${prenom || 'Salut'}, ta réservation *${code}* du ${formaterDate(data.date)} à ${formaterHeure(data.heure_debut)} a été annulée ${initiateur}.\n\n` +
        `${detailRemboursement}\n\n` +
        `D'autres créneaux sont dispo ici :\n` +
        `👉 ${lienDispo}`,
      await resolvePlayerOutboundSession(data),
    );
  }

  const joueurLabel = data.joueur_nom || prenom || 'Joueur';
  const telJoueur = tel || '—';
  await notifierGerantTerrain(
    data.terrain_id,
    `⚠️ Réservation annulée — *${code}*\n\n` +
      `${joueurLabel} (${telJoueur})\n` +
      `${formaterDate(data.date)} · ${formaterHeure(data.heure_debut)}–${formaterHeure(data.heure_fin)}\n` +
      `Type : *${typeLabel}*\n` +
      `Créneau libéré — disponible pour une nouvelle réservation.`,
  );
  firePush(() => pushService.notifyAnnulation(reservationId, { traiteParGerant }));
}

/**
 * Reversement : toujours au gérant principal (gestion de l'argent).
 * Si telephone/nom fournis explicitement (flow paiement Mohamed), on les respecte.
 */
async function envoyerReversementGerant(opts = {}) {
  if (opts.telephone) {
    return envoyerReversement(opts);
  }
  if (opts.terrain_id) {
    const { getGerantPrincipal } = require('./services/gerantService');
    const principal = await getGerantPrincipal(opts.terrain_id);
    if (!principal) {
      console.error(`[NOTIF] Reversement : aucun principal pour terrain ${opts.terrain_id}`);
      return;
    }
    return envoyerReversement({
      ...opts,
      telephone: principal.whatsapp_number || principal.telephone,
      nom: [principal.prenom, principal.nom].filter(Boolean).join(' ') || principal.nom,
      gerant_id: principal.gerant_id,
    });
  }
  return envoyerReversement(opts);
}

/** Alerte score : toujours au principal (si terrain_id) ou telephone fourni. */
async function envoyerAlerteSilencieuse({ telephone, prenom, gerant_prenom, terrain_nom, terrain_id }) {
  let tel = telephone;
  if (!tel && terrain_id) {
    const { getGerantPrincipal } = require('./services/gerantService');
    const principal = await getGerantPrincipal(terrain_id);
    tel = principal?.whatsapp_number || principal?.telephone;
  }
  if (!tel) return;
  await envoyerWhatsApp(
    tel,
    `Petit point sur ${terrain_nom} ${prenom || ''}.\n\n` +
      `Ces deux derniers mois, quelques indicateurs sont un peu bas pour ${gerant_prenom || 'votre gerant'}. ` +
      `Rien d'alarmant, mais ca vaut peut-etre une petite discussion avec lui.\n\n` +
      `Tu peux voir le detail dans ton dashboard.`
  );
}

/** Résumé semaine → tous les gérants actifs du terrain. */
async function envoyerResumeSemaine(terrainId, message) {
  const { getGerantsTerrain } = require('./services/gerantService');
  const gerants = await getGerantsTerrain(terrainId);
  if (!gerants.length) {
    console.error(`[NOTIF] Resume semaine : aucun gérant pour terrain ${terrainId}`);
    return;
  }
  for (const g of gerants) {
    const tel = g.whatsapp_number || g.telephone;
    if (!tel) continue;
    await envoyerWhatsApp(
      tel,
      message,
      client.gerantSessionKey(g.gerant_id) || 'platform',
    );
  }
}

/** Template — confirmation sans avance (paiement intégral sur place) */
async function envoyerConfirmationSansAvance(reservationId) {
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
  const total = Number(data.montant_total || data.prix_total || data.montant || 0);

  const message =
    `⚽ C'est confirmé ${prenom} !\n\n` +
    `Ton terrain t'attend :\n` +
    `📍 ${data.terrain_nom} — ${quartier}\n` +
    `🗓️ ${formaterDate(data.date)} à ${formaterHeure(data.heure_debut)}\n` +
    `🏷️ Code : *${data.code_reservation}*\n\n` +
    (lienMaps ? `🗺️ Itinéraire : ${lienMaps}\n\n` : '') +
    `💵 Règlement complet sur place : ${formaterMontant(total)}\n` +
    `(pas d'avance en ligne pour ce terrain)\n\n` +
    `📌 Viens *30 minutes avant* avec ce QR code 😄\n` +
    `⚠️ Ce QR code est à usage unique.`;

  const waKey = await resolvePlayerOutboundSession(data);
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

  if (data.terrain_id) {
    await notifierGerantTerrain(
      data.terrain_id,
      `Réservation sans avance confirmée. Joueur : ${data.joueur_nom}. ${data.date} à ${formaterHeure(data.heure_debut)}. Code : ${data.code_reservation}. Total sur place : ${formaterMontant(total)}.`,
      'platform',
    ).catch((err) => {
      console.warn('⚠️ Notif gérant après confirmation sans avance:', err.message || err);
    });
  }
  firePush(() => pushService.notifyReservationConfirmee(reservationId, { sansAvance: true }));
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
  envoyerConfirmationManuelle,
  envoyerConfirmationSansAvance,
  envoyerCreneauPris,
  envoyerRemboursement,
  envoyerAnnulation,
  envoyerReversement,
  envoyerReversementGerant,
  envoyerAlerteSilencieuse,
  envoyerResumeSemaine,
  notifierGerantTerrain,
  attachGerantDeGarde,
  sessionKeyFromReservation,
};
