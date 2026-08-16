/**
 * Seed complet Mohamed + optional envois WhatsApp réels.
 *
 * Usage:
 *   node scripts/seed-mohamed.js              # seed DB seulement
 *   node scripts/seed-mohamed.js --send-wa    # seed + envoie des messages WhatsApp
 *
 * Prérequis pour --send-wa :
 *   - WHATSAPP_MOCK=false dans backend/.env
 *   - Session scannée via http://localhost:3001/whatsapp-qr
 *     OU laisser le QR s'afficher dans ce script
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { seed, MOHAMED_PHONE_RAW, DEMO_PASSWORD } = require('../seed');
const { getDb, queryAll, queryOne, saveDb } = require('../database');

const SEND_WA = process.argv.includes('--send-wa');

const WA_MESSAGES = [
  {
    role: 'joueur',
    text:
      `🏆 TerrainSN — message JOUEUR\n` +
      `Salut Mohamed ! Ta réservation d'aujourd'hui est confirmée.\n` +
      `Code : TF-MOH-NOW — présente ton QR au gérant.\n` +
      `Compte : mohamed.joueur@gmail.com / ${DEMO_PASSWORD}`,
  },
  {
    role: 'gerant',
    text:
      `🧤 TerrainSN — message GÉRANT\n` +
      `Check-in du jour prêt : 2 QR à scanner (TF-MOH-NOW, TF-MOH-2H).\n` +
      `Portefeuille : ouvre /backoffice/gerant/portefeuille\n` +
      `Compte : mohamed.gerant@gmail.com / ${DEMO_PASSWORD}`,
  },
  {
    role: 'proprietaire',
    text:
      `🏟️ TerrainSN — message PROPRIÉTAIRE\n` +
      `Arena Mohamed Parcelles : avances du jour enregistrées.\n` +
      `Dashboard revenus : /backoffice/login\n` +
      `Compte : mohamed.proprietaire@gmail.com / ${DEMO_PASSWORD}`,
  },
  {
    role: 'super_admin',
    text:
      `🛡️ TerrainSN — message SUPER ADMIN\n` +
      `Seed Mohamed OK. Terrains, résas, notifs WhatsApp et anti-fraude prêts pour la recette.\n` +
      `Compte : mohamed.admin@gmail.com / ${DEMO_PASSWORD}`,
  },
  {
    role: 'systeme',
    text:
      `📲 TerrainSN — fil conversation démo\n` +
      `📤 Envoyé (plateforme → toi)\n` +
      `📩 Reçu simulé : « OK merci, j'arrive avec mon QR. »\n` +
      `Numéro unique multi-rôles : ${MOHAMED_PHONE_RAW}\n` +
      `Connecte-toi toujours par EMAIL pour choisir le bon rôle.`,
  },
];

async function sendWhatsAppBurst() {
  const mock = String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true';
  if (mock) {
    console.log('ℹ️  WHATSAPP_MOCK=true — messages loggés, aucun envoi réel.');
    for (const msg of WA_MESSAGES) {
      console.log(`[WHATSAPP MOCK][${msg.role}] → ${MOHAMED_PHONE_RAW}\n${msg.text}\n`);
    }
    return { mode: 'mock', sent: WA_MESSAGES.length };
  }

  // Utilise le client applicatif si l'API tourne déjà, sinon client dédié (test-whatsapp style)
  let notificationService;
  try {
    notificationService = require('../notificationService');
  } catch {
    notificationService = null;
  }

  const whatsappClient = require('../whatsappClient');
  if (typeof whatsappClient.ensureStarted === 'function') {
    console.log('📱 Démarrage WhatsApp… (scanne le QR sur /whatsapp-qr si demandé)');
    await whatsappClient.ensureStarted();
  }

  // Attente ready max 3 min
  const deadline = Date.now() + 180000;
  while (!whatsappClient.isReady && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    if (typeof whatsappClient.probeReady === 'function') {
      // probe may be internal — ignore
    }
    process.stdout.write('.');
  }
  console.log('');

  if (!whatsappClient.isReady) {
    throw new Error(
      'WhatsApp non connecté. Ouvre http://localhost:3001/whatsapp-qr, scanne, puis relance avec --send-wa'
    );
  }

  let sent = 0;
  for (const msg of WA_MESSAGES) {
    if (notificationService?.envoyerMessage) {
      await notificationService.envoyerMessage(MOHAMED_PHONE_RAW, msg.text);
    } else {
      const { formatNumero } = require('../notificationService');
      await whatsappClient.sendMessage(formatNumero(MOHAMED_PHONE_RAW), msg.text);
    }
    sent += 1;
    console.log(`✅ WhatsApp [${msg.role}] envoyé → ${MOHAMED_PHONE_RAW}`);
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Trace en base : messages "envoyés" + une réponse "reçue" simulée
  const db = await getDb();
  const joueur = queryOne(db, "SELECT id FROM users WHERE email = 'mohamed.joueur@gmail.com'");
  if (joueur) {
    db.run(
      `INSERT INTO notifications (destinataire_type, destinataire_id, type, canal, contenu, lu)
       VALUES ('user', ?, 'message_envoye', 'whatsapp', ?, 1)`,
      [joueur.id, `📤 Burst WA seed : ${sent} messages envoyés à ${MOHAMED_PHONE_RAW}`]
    );
    db.run(
      `INSERT INTO notifications (destinataire_type, destinataire_id, type, canal, contenu, lu)
       VALUES ('user', ?, 'message_recu', 'whatsapp', ?, 0)`,
      [
        joueur.id,
        `📩 [REÇU WhatsApp] Message bien reçu, j'ouvre l'app TerrainSN. — Mohamed (${new Date().toLocaleString('fr-SN')})`,
      ]
    );
    saveDb();
  }

  return { mode: 'live', sent };
}

async function printSummary() {
  const db = await getDb();
  const accounts = [
    ...queryAll(db, `SELECT 'user/' || role AS role, email, telephone FROM users WHERE email LIKE 'mohamed.%'`),
    ...queryAll(db, `SELECT 'proprietaire' AS role, email, telephone FROM proprietaires WHERE email LIKE 'mohamed.%'`),
    ...queryAll(db, `SELECT 'gerant' AS role, email, telephone FROM employes WHERE email LIKE 'mohamed.%'`),
  ];
  const notifs = queryOne(db, 'SELECT COUNT(*) AS n FROM notifications')?.n;
  const todayResa = queryOne(
    db,
    `SELECT COUNT(*) AS n FROM reservations WHERE date = date('now','localtime') AND terrain_id = 9`
  )?.n;

  console.log('\n═══════════════ RÉCAP MOHAMED ═══════════════');
  for (const a of accounts) {
    console.log(`  ${a.role.padEnd(22)} ${a.email}`);
  }
  console.log(`  notifications DB      ${notifs}`);
  console.log(`  résas aujourd'hui T9  ${todayResa}`);
  console.log('═════════════════════════════════════════════\n');
}

async function main() {
  console.log('🌱 seed-mohamed : seed officiel enrichi…');
  await seed();
  await printSummary();

  if (!SEND_WA) {
    console.log('Astuce : pour envoyer les WhatsApp réels sur ton numéro :');
    console.log('  npm run seed:mohamed -- --send-wa');
    return;
  }

  console.log(`\n📨 Envoi WhatsApp multi-rôles → ${MOHAMED_PHONE_RAW}…`);
  const result = await sendWhatsAppBurst();
  console.log(`\n✅ Terminé (${result.mode}) — ${result.sent} messages.`);
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
