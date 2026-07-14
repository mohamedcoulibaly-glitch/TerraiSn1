const client = require('./whatsappClient');
const { getDb, queryOne, queryAll } = require('./database');

function formatNumero(telephone) {
  let numero = String(telephone || '').replace(/\D/g, '');
  if (numero.startsWith('00')) numero = numero.slice(2);
  if (numero.length === 9) numero = `221${numero}`;
  if (!numero.startsWith('221') || numero.length !== 12) {
    throw new Error(`Numéro WhatsApp sénégalais invalide : ${telephone}`);
  }
  return `${numero}@c.us`;
}

async function envoyerMessage(telephone, message) {
  if (!telephone) return;
  if (String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true') {
    console.log(`[WHATSAPP MOCK] Message vers ${telephone} : ${message}`);
    return;
  }
  if (!client.isReady) throw new Error('Le client WhatsApp n\'est pas encore connecté');
  await client.sendMessage(formatNumero(telephone), message);
}

async function details(reservationId) {
  const db = await getDb();
  return queryOne(db, `SELECT r.*, t.nom AS terrain_nom,
    e.nom AS gerant_nom, e.telephone AS gerant_telephone, e.whatsapp_number AS gerant_whatsapp
    FROM reservations r JOIN terrains t ON t.id = r.terrain_id
    LEFT JOIN employes e ON e.terrain_id = t.id AND e.is_active = 1
    WHERE r.id = ? LIMIT 1`, [reservationId]);
}

async function envoyerLienPaiement(reservationId) {
  const reservation = await details(reservationId);
  if (!reservation) return;
  await envoyerMessage(reservation.joueur_telephone,
    `🏟️ Votre réservation sur ${reservation.terrain_nom} a été créée par le gérant. Payez ici pour confirmer votre créneau du ${reservation.date} à ${reservation.heure_debut} : ${reservation.lien_paiement}. Lien valable 2h.`);
}

async function envoyerConfirmation(reservationId) {
  const reservation = await details(reservationId);
  if (!reservation) return;
  await Promise.all([
    envoyerMessage(reservation.joueur_telephone,
      `✅ Réservation confirmée ! ${reservation.terrain_nom} - ${reservation.date} à ${reservation.heure_debut}. Votre code : ${reservation.code_reservation}. Bonne partie ! ⚽`),
    envoyerMessage(reservation.gerant_whatsapp || reservation.gerant_telephone,
      `🔔 Paiement reçu. Joueur : ${reservation.joueur_nom}. ${reservation.date} à ${reservation.heure_debut}. Code : ${reservation.code_reservation}.`),
  ]);
}

async function envoyerRemboursement(reservationId) {
  const reservation = await details(reservationId);
  if (!reservation) return;
  const db = await getDb();
  const prochains = queryAll(db, `SELECT date FROM creneaux WHERE terrain_id = ? AND statut = 'libre' AND date >= ? ORDER BY date, heure_debut LIMIT 3`, [reservation.terrain_id, reservation.date]);
  const date = prochains[0]?.date || reservation.date;
  const domain = (process.env.APP_DOMAIN || 'http://localhost:8080').replace(/\/$/, '');
  await envoyerMessage(reservation.joueur_telephone,
    `⚠️ Désolé, ce créneau vient d'être pris. Remboursement sous 24h. Créneaux disponibles : ${domain}/terrain/${reservation.terrain_id}?date=${date}`);
}

async function envoyerReversement({ telephone, montant_acompte, montant_commission, montant_reverse, reservationId, solde_disponible }) {
  await envoyerMessage(telephone,
    `Reversement recu ! Reservation #TF-${reservationId} confirmee. Acompte joueur : ${Number(montant_acompte || 0).toLocaleString()} FCFA. Commission plateforme : ${Number(montant_commission || 0).toLocaleString()} FCFA. Credite sur votre portefeuille : ${Number(montant_reverse || 0).toLocaleString()} FCFA. Solde disponible : ${Number(solde_disponible || 0).toLocaleString()} FCFA.`);
}

module.exports = { formatNumero, envoyerMessage, envoyerLienPaiement, envoyerConfirmation, envoyerRemboursement, envoyerReversement };
