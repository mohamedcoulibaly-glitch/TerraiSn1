const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const mockMode = String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true';

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: process.env.WHATSAPP_SESSION_PATH || '.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.isReady = false;

client.on('qr', (qr) => {
  console.log('📱 Scannez ce QR code avec WhatsApp :');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  client.isReady = true;
  console.log('✅ WhatsApp connecté');
});

client.on('disconnected', () => {
  client.isReady = false;
  console.warn('⚠️ WhatsApp déconnecté');
});

client.on('auth_failure', (message) => {
  client.isReady = false;
  console.error('❌ Échec authentification WhatsApp :', message);
});

if (mockMode) {
  console.log('[WHATSAPP MOCK] Client simulé, aucun QR requis.');
} else {
  client.initialize().catch((error) => console.error('❌ Initialisation WhatsApp :', error.message));
}

module.exports = client;
