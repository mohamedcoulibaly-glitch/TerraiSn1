const client = require('./whatsappClient');
const { getDb, queryOne, queryAll } = require('./database');

function formatNumero(telephone) {
  let numero = String(telephone || '').replace(/\D/g, '');
  if (numero.startsWith('00')) numero = numero.slice(2);
  if (numero.length === 9) numero = `221${numero}`;
  if (!numero.startsWith('221') || numero.length !== 12) {
    throw new Error(`Numero WhatsApp senegalais invalide : ${telephone}`);
  }
  return `${numero}@c.us`;
}

async function envoyerMessage(telephone, message) {
  if (!telephone) return;
  if (String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true') {
    console.log(`[WHATSAPP MOCK] Message vers ${telephone} : ${message}`);
    return;
  }
  if (!client.isReady) throw new Error("Le client WhatsApp n'est pas encore connecte");
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
    `Votre reservation sur ${reservation.terrain_nom} a ete creee par le gerant. Payez votre avance de ${Number(reservation.montant_avance || reservation.acompte || 0).toLocaleString()} FCFA ici pour confirmer votre creneau du ${reservation.date} a ${reservation.heure_debut} : ${reservation.lien_paiement}. Lien valable 2h.`);
}

async function envoyerConfirmation(reservationId) {
  const reservation = await details(reservationId);
  if (!reservation) return;
  await Promise.all([
    envoyerMessage(reservation.joueur_telephone,
      `Reservation confirmee ! ${reservation.terrain_nom} - ${reservation.date} a ${reservation.heure_debut}. Ton code : ${reservation.code_reservation}. Garde bien ton QR code, il est a usage unique.`),
    envoyerMessage(reservation.gerant_whatsapp || reservation.gerant_telephone,
      `Paiement recu. Joueur : ${reservation.joueur_nom}. ${reservation.date} a ${reservation.heure_debut}. Code : ${reservation.code_reservation}.`),
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
    `Desole, ce creneau vient d'etre pris. Ton avance sera remboursee sous 24h. Creneaux disponibles : ${domain}/terrain/${reservation.terrain_id}?date=${date}`);
}

async function envoyerReversement({ telephone, montant_acompte, montant_avance, montant_commission, montant_reverse, reservationId, solde_disponible }) {
  const avance = montant_avance ?? montant_acompte;
  await envoyerMessage(telephone,
    `Reversement recu ! Reservation #TF-${reservationId} confirmee. Avance joueur : ${Number(avance || 0).toLocaleString()} FCFA. Commission plateforme : ${Number(montant_commission || 0).toLocaleString()} FCFA. Credite sur votre portefeuille : ${Number(montant_reverse || 0).toLocaleString()} FCFA. Solde disponible : ${Number(solde_disponible || 0).toLocaleString()} FCFA.`);
}

async function envoyerAlerteSilencieuse({ telephone, prenom, gerant_prenom, terrain_nom }) {
  await envoyerMessage(
    telephone,
    `Petit point sur ${terrain_nom} ${prenom || ''}.\n\n` +
      `Ces deux derniers mois, quelques indicateurs sont un peu bas pour ${gerant_prenom || 'votre gerant'}. ` +
      `Rien d'alarmant, mais ca vaut peut-etre une petite discussion avec lui.\n\n` +
      `Tu peux voir le detail dans ton dashboard.`
  );
}

module.exports = {
  formatNumero,
  envoyerMessage,
  envoyerLienPaiement,
  envoyerConfirmation,
  envoyerRemboursement,
  envoyerReversement,
  envoyerAlerteSilencieuse,
};
