/**
 * Test d'envoi WhatsApp via OpenWA.
 * Usage: node scripts/test-whatsapp.js [numero]
 * Exemple: node scripts/test-whatsapp.js +221778261225
 *
 * Prérequis: session plateforme connectée (QR sur /whatsapp-qr ou dashboard OpenWA).
 */
require('dotenv').config();

const whatsappClient = require('../whatsappClient');
const { formatNumero } = require('../notificationService');

const target = process.argv[2] || process.env.WHATSAPP_TEST_NUMBER || '+221778261225';
const message =
  process.argv.slice(3).join(' ') ||
  `\u2705 *TerrainSN* — test WhatsApp OpenWA OK \u26BD\n` +
  `\uD83D\uDCF1 Message envoye le ${new Date().toLocaleString('fr-SN')}.\n` +
  `Integration OpenWA operationnelle !`;

async function main() {
  if (!process.env.OPENWA_API_KEY) {
    throw new Error('OPENWA_API_KEY manquant dans backend/.env');
  }
  const chatId = formatNumero(target);
  console.log(`Cible: ${target} → ${chatId}`);
  console.log(`OpenWA: ${process.env.OPENWA_BASE_URL || 'https://mywa.tickets-place.net'}`);

  const started = await whatsappClient.ensureStarted('platform');
  if (!started.ready) {
    const qr = await whatsappClient.getQrPayload('platform');
    if (qr.dataUrl) {
      console.log('📱 Session non connectée — ouvrez /whatsapp-qr pour scanner le QR OpenWA.');
    }
    throw new Error(started.error || 'WhatsApp plateforme non connecté sur OpenWA');
  }

  console.log('✅ Session OpenWA prête — envoi…');
  await whatsappClient.sendMessageForSession('platform', chatId, message);
  console.log(`✅ Message envoyé à ${target}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
