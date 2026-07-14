const client = require('./whatsappClient');
const { formatNumero } = require('./notificationService');

async function envoyerAcces({ telephone, motDePasse, role }) {
  const domain = (process.env.APP_DOMAIN || 'http://localhost:8080').replace(/\/$/, '');
  const message = `🔐 Vos accès TerrainSN (${role}) : Téléphone : ${telephone} / Mot de passe temporaire : ${motDePasse} / Connectez-vous ici : ${domain}/connexion`;
  if (String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true') {
    console.log(`[WHATSAPP MOCK] Accès vers ${telephone} : ${message}`);
    return;
  }
  if (!client.isReady) throw new Error('Le client WhatsApp n\'est pas connecté');
  await client.sendMessage(formatNumero(telephone), message);
}

module.exports = { envoyerAcces };
