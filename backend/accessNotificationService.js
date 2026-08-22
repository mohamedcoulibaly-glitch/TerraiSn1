const client = require('./whatsappClient');
const { formatNumero } = require('./notificationService');

async function envoyerAcces({ telephone, motDePasse, role }) {
  const domain = (process.env.APP_DOMAIN || 'http://localhost:8080').replace(/\/$/, '');
  const normalized = String(role || '').toLowerCase();
  const loginPath =
    normalized === 'super_admin' || normalized === 'superadmin'
      ? '/backoffice/login'
      : normalized === 'gerant' || normalized === 'proprietaire'
        ? '/backoffice/login'
        : '/connexion';
  const label =
    normalized === 'super_admin' || normalized === 'superadmin'
      ? 'Super Admin'
      : normalized === 'proprietaire'
        ? 'Propriétaire'
        : normalized === 'gerant'
          ? 'Gérant'
          : role;
  const message =
    `\uD83D\uDD10 *Vos acces TerrainSN* (${label})\n\n` +
    `\uD83D\uDCF1 Telephone : ${telephone}\n` +
    `\uD83D\uDD11 Mot de passe temporaire : ${motDePasse}\n` +
    `\uD83D\uDD17 Connectez-vous ici : ${domain}${loginPath}`;
  if (String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true') {
    console.log(`[WHATSAPP MOCK] Accès vers ${telephone} : ${message}`);
    return;
  }
  if (!client.isReady && typeof client.ensureStarted === 'function') {
    await client.ensureStarted();
  }
  if (!client.isReady) throw new Error("WhatsApp non connecte. Ouvrez /whatsapp-qr pour scanner le QR.");
  await client.sendMessage(formatNumero(telephone), message);
}

module.exports = { envoyerAcces };
