const whatsappManager = require('./services/whatsappManager');

/** Accès créés par l'admin → toujours session superadmin / platform */
async function envoyerAcces({ telephone, motDePasse, role }) {
  const domain = (process.env.APP_DOMAIN || 'http://localhost:8080').replace(/\/$/, '');
  const message =
    `Accès TerrainSN (${role})\n` +
    `Tél : ${telephone}\n` +
    `MDP temporaire : *${motDePasse}*\n` +
    `Connexion : ${domain}/connexion`;

  const ok = await whatsappManager.envoyerMessage(telephone, message, 'superadmin');
  if (!ok && String(process.env.WHATSAPP_MOCK).toLowerCase() !== 'true') {
    throw new Error('WhatsApp plateforme non connecte. Ouvrez Intégrations → WhatsApp pour scanner le QR.');
  }
}

module.exports = { envoyerAcces };
