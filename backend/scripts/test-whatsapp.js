/**
 * Test d'envoi WhatsApp réel.
 * Usage: node scripts/test-whatsapp.js [numero]
 * Exemple: node scripts/test-whatsapp.js +221778261225
 *
 * Prérequis: scanner le QR au premier lancement (WhatsApp → Appareils connectés).
 */
require('dotenv').config();

const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const target = process.argv[2] || process.env.WHATSAPP_TEST_NUMBER || '+221778261225';
const message =
  process.argv.slice(3).join(' ') ||
  `\u2705 *TerrainSN* — test WhatsApp OK \u26BD\n` +
  `\uD83D\uDCF1 Message envoye le ${new Date().toLocaleString('fr-SN')}.\n` +
  `QR + WhatsApp operationnels !`;

function toChatId(telephone) {
  let numero = String(telephone || '').replace(/\D/g, '');
  if (numero.startsWith('00')) numero = numero.slice(2);
  if (numero.length === 9) numero = `221${numero}`;
  if (!numero.startsWith('221') || numero.length !== 12) {
    throw new Error(`Numéro WhatsApp sénégalais invalide : ${telephone}`);
  }
  return `${numero}@c.us`;
}

async function main() {
  const chatId = toChatId(target);
  console.log(`Cible: ${target} → ${chatId}`);
  console.log('Démarrage WhatsApp (Chromium)…');

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: process.env.WHATSAPP_SESSION_PATH || '.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  client.on('qr', (qr) => {
    console.log('\n📱 Scannez ce QR avec WhatsApp → Paramètres → Appareils connectés :\n');
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => console.log('🔐 Authentifié, synchronisation…'));
  client.on('auth_failure', (msg) => {
    console.error('❌ Échec auth:', msg);
    process.exit(1);
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timeout 180s — QR non scanné ou session bloquée')),
      180000
    );
    client.on('ready', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  await client.initialize();
  await ready;
  console.log('✅ WhatsApp connecté — envoi…');

  await client.sendMessage(chatId, message);
  console.log(`✅ Message envoyé à ${target}`);

  await client.destroy();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
