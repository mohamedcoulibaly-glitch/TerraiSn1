/**
 * =====================================================================
 * EFFICACITÉ RELATIONNELLE — Tests d'intégration PayDunya ↔ BDD ↔ WA
 * =====================================================================
 * Exécutés sur la SANDBOX PayDunya (PAYMENT_PROVIDER=paydunya).
 * Le code métier passe par PaymentService → prêt pour PAYMENT_PROVIDER=paytech.
 *
 * Usage : node scripts/test-paydunya-whatsapp-integration.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `terrainsn-int-pdwa-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.PAYMENT_PROVIDER = 'paydunya';
process.env.PAYMENT_GATEWAY = 'paydunya';
process.env.PAYMENT_MODE = 'production';
process.env.PAYTECH_MOCK = 'false';
process.env.PAYDUNYA_MODE = 'test';
process.env.PAYDUNYA_MASTER_KEY = 'test-master-key-mohamed';
process.env.PAYDUNYA_PRIVATE_KEY = 'test_private_mohamed';
process.env.PAYDUNYA_TOKEN = 'test_token_mohamed';
process.env.PAYDUNYA_PAYOUT_ENABLED = 'false';
process.env.PAYTECH_PAYOUT_ENABLED = 'false';
process.env.WHATSAPP_MOCK = 'true';
process.env.WHATSAPP_RETRY_MEMORY = 'true';
process.env.WHATSAPP_DEV_NUMBER = '778261225';
process.env.PAYTECH_API_KEY = 'pk_test_mohamed_int';
process.env.PAYTECH_API_SECRET = 'sk_test_mohamed_int';
process.env.PAYTECH_IPN_AUTO = 'false';

const { createHarness } = require('../test/helpers/harness');
const { MOHAMED } = require('../test/helpers/mohamed');
const { seedMohamedCompte, creerReservationMohamed } = require('../test/helpers/dbFixtures');
const {
  fabriquerPayloadConfirme,
  fabriquerBodyIpn,
  stubConfirmerFacture,
} = require('../test/mocks/paydunyaHttp');
const { creerWhatsappDouble } = require('../test/mocks/whatsappClient');
const paymentService = require('../services/payment');
const { targetProvider, methodePaiement } = require('../lib/paymentGateway');

const { getDb, queryOne, queryAll } = require('../database');
const paydunyaService = require('../paydunyaService');
const { handlePaydunyaIpn } = require('../payments/flow');
const notificationService = require('../notificationService');
const retryQueue = require('../services/notificationRetryQueue');
const whatsappClient = require('../whatsappClient');

const h = createHarness('integration-paydunya-whatsapp');

async function main() {
  retryQueue.resetMemoire();

  h.assertEqual('intégration tourne sur PayDunya sandbox', targetProvider(), 'paydunya');
  h.assertEqual('PaymentService adapter sandbox', paymentService.getAdapter().name, 'paydunya');
  h.assertEqual('methode stockée = paydunya', methodePaiement(), 'paydunya');
  process.env.PAYMENT_PROVIDER = 'paytech';
  h.assertEqual('bascule env → PayTech sans redéploiement code', paymentService.getAdapter().name, 'paytech');
  process.env.PAYMENT_PROVIDER = 'paydunya';

  const db = await getDb();
  const fx = seedMohamedCompte(db, { payoutMode: 'retrait', paiementProduction: 0 });

  const resa1 = creerReservationMohamed(db, {
    terrainId: fx.terrainId,
    joueurId: fx.joueurId,
    date: '2026-09-16',
    heure: '18:00',
  });
  const token1 = 'pd_tok_int_success_001';
  const payload1 = fabriquerPayloadConfirme({
    token: token1,
    reservationId: resa1.reservationId,
    refCommand: resa1.refCommand,
    totalAmount: MOHAMED.montants.avancePayin,
  });

  const restoreConfirm = stubConfirmerFacture(paydunyaService, async () => payload1);
  const wa = creerWhatsappDouble();
  const origSend = whatsappClient.sendMessageForSession;
  const origImg = whatsappClient.sendImageForSession;
  wa.installerSur(whatsappClient);

  let result1;
  try {
    result1 = await handlePaydunyaIpn(fabriquerBodyIpn(payload1));
  } finally {
    restoreConfirm();
  }

  h.assertEqual('IPN1 event completed', result1.event, 'completed');
  h.assertEqual('IPN1 provider paydunya', result1.provider, 'paydunya');

  const resaAfter = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [resa1.reservationId]);
  h.assertEqual('réservation → confirme', resaAfter.statut, 'confirme');

  const paiement = queryOne(
    db,
    `SELECT * FROM paiements WHERE reservation_id = ? AND statut = 'paye' ORDER BY id DESC LIMIT 1`,
    [resa1.reservationId],
  );
  h.assert('paiement SUCCESS (paye)', Boolean(paiement));
  h.assertEqual('paiement methode paydunya', paiement.methode, 'paydunya');
  h.assertEqual('paiement montant avance XOF', Number(paiement.montant), MOHAMED.montants.avancePayin);

  const notifs = queryAll(db, `SELECT * FROM notifications WHERE canal = 'whatsapp' ORDER BY id DESC LIMIT 10`);
  h.assert('notification WhatsApp déclenchée (log BDD)', notifs.length >= 1, notifs.length);

  const paiementsAvant = queryAll(
    db,
    `SELECT id FROM paiements WHERE reservation_id = ? AND statut = 'paye'`,
    [resa1.reservationId],
  ).length;
  const notifsAvant = queryAll(db, `SELECT id FROM notifications`).length;

  const restoreConfirm2 = stubConfirmerFacture(paydunyaService, async () => payload1);
  let result2;
  try {
    result2 = await handlePaydunyaIpn(fabriquerBodyIpn(payload1));
  } finally {
    restoreConfirm2();
  }

  h.assertEqual('IPN2 toujours received completed', result2.event, 'completed');
  const paiementsApres = queryAll(
    db,
    `SELECT id FROM paiements WHERE reservation_id = ? AND statut = 'paye'`,
    [resa1.reservationId],
  ).length;
  h.assertEqual('idempotence : pas de 2e paiement', paiementsApres, paiementsAvant);
  const resaStill = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [resa1.reservationId]);
  h.assertEqual('idempotence : statut inchangé', resaStill.statut, 'confirme');
  const notifsApres = queryAll(db, `SELECT id FROM notifications`).length;
  h.assert(
    'idempotence : pas de double notif confirmation',
    notifsApres === notifsAvant,
    `avant=${notifsAvant} apres=${notifsApres}`,
  );

  const resa2 = creerReservationMohamed(db, {
    terrainId: fx.terrainId,
    joueurId: fx.joueurId,
    date: '2026-09-17',
    heure: '19:00',
  });
  const payload2 = fabriquerPayloadConfirme({
    token: 'pd_tok_int_wa_fail_002',
    reservationId: resa2.reservationId,
    refCommand: resa2.refCommand,
    totalAmount: MOHAMED.montants.avancePayin,
  });

  process.env.WHATSAPP_MOCK = 'false';
  wa.reset();
  wa.failPermanently(500);
  retryQueue.resetMemoire();

  const restoreConfirm3 = stubConfirmerFacture(paydunyaService, async () => payload2);
  let result3;
  try {
    result3 = await handlePaydunyaIpn(fabriquerBodyIpn(payload2));
  } finally {
    restoreConfirm3();
    process.env.WHATSAPP_MOCK = 'true';
    whatsappClient.sendMessageForSession = origSend;
    whatsappClient.sendImageForSession = origImg;
  }

  h.assertEqual('IPN3 completed malgré WA down', result3.event, 'completed');
  const resaFailWa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [resa2.reservationId]);
  h.assertEqual('paiement reste valide (confirme)', resaFailWa.statut, 'confirme');
  const payFailWa = queryOne(
    db,
    `SELECT * FROM paiements WHERE reservation_id = ? AND statut = 'paye'`,
    [resa2.reservationId],
  );
  h.assert('ligne paiement SUCCESS conservée', Boolean(payFailWa));

  const pending = await retryQueue.compterPending();
  h.assert('notification poussée en file de rejeu', pending >= 1, `pending=${pending}`);
  const jobs = retryQueue.snapshotMemoire();
  h.assert(
    'job rejeu cible Mohamed',
    jobs.some((j) => String(j.telephone).includes('778261225') || String(j.telephone).includes('221778261225')),
  );
  h.assert('job rejeu status HTTP 500', jobs.some((j) => Number(j.http_status) === 500));

  wa.recover();
  process.env.WHATSAPP_MOCK = 'false';
  wa.installerSur(whatsappClient);
  const replay = await retryQueue.rejouerPending(async (job) => {
    await notificationService.envoyerMessage(job.telephone, job.message, job.session_key, { type: job.type });
  });
  process.env.WHATSAPP_MOCK = 'true';
  whatsappClient.sendMessageForSession = origSend;
  whatsappClient.sendImageForSession = origImg;
  h.assert('rejeu file → au moins un envoi OK', replay.some((r) => r.ok), JSON.stringify(replay));

  let rejected = false;
  try {
    await handlePaydunyaIpn({ data: { ...payload1, hash: '00'.repeat(64) } });
  } catch (e) {
    rejected = e.statusCode === 400;
  }
  h.assert('IPN signature invalide → 400', rejected);

  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }

  h.exitIfFailed();
  console.log('\nTous les tests d\'intégration PayDunya/WhatsApp OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
