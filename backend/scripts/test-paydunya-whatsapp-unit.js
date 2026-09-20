/**
 * =====================================================================
 * EFFICACITÉ TECHNIQUE — Tests unitaires Paiement (PayDunya + PayTech) + WhatsApp
 * =====================================================================
 * Couvre : téléphone SN, templates WA, signatures webhooks,
 *          adaptateur PaymentService (sandbox PayDunya ↔ prod PayTech).
 *
 * Usage : node scripts/test-paydunya-whatsapp-unit.js
 */
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const tmpDb = path.join(os.tmpdir(), `terrainsn-unit-pdwa-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
/** Sandbox : PayDunya. Prod : PAYMENT_PROVIDER=paytech */
process.env.PAYMENT_PROVIDER = 'paydunya';
process.env.PAYMENT_GATEWAY = 'paydunya';
process.env.PAYMENT_MODE = 'production';
process.env.PAYTECH_MOCK = 'false';
process.env.PAYDUNYA_MODE = 'test';
process.env.PAYDUNYA_MASTER_KEY = 'test-master-key-mohamed';
process.env.PAYDUNYA_PRIVATE_KEY = 'test_private_mohamed';
process.env.PAYDUNYA_TOKEN = 'test_token_mohamed';
process.env.PAYDUNYA_STORE_NAME = 'TerrainSN-Test';
process.env.PAYDUNYA_PAYOUT_ENABLED = 'true';
process.env.PAYDUNYA_CALLBACK_URL = 'https://tunnel.example.test/webhook/paydunya';
process.env.PAYDUNYA_RETURN_URL = 'https://tunnel.example.test/paydunya/success';
process.env.PAYDUNYA_CANCEL_URL = 'https://tunnel.example.test/paydunya/cancel';
process.env.PAYTECH_API_KEY = 'pk_test_mohamed_unit';
process.env.PAYTECH_API_SECRET = 'sk_test_mohamed_unit';
process.env.WHATSAPP_MOCK = 'true';
process.env.WHATSAPP_RETRY_MEMORY = 'true';
process.env.PAYTECH_IPN_AUTO = 'false';

const { createHarness } = require('../test/helpers/harness');
const { MOHAMED } = require('../test/helpers/mohamed');
const {
  hashDepuisMasterKey,
  fabriquerPayloadConfirme,
  installerFetchMock,
} = require('../test/mocks/paydunyaHttp');
const { creerWhatsappDouble } = require('../test/mocks/whatsappClient');
const {
  validerChatIdWhatsApp,
  validerPayloadMessageTexte,
  validerTemplateConfirmation,
  validerTemplatePayoutRecu,
  validerTemplateRemboursement,
  validerBoutonsOptionnels,
} = require('../lib/whatsappPayloadValidator');
const {
  validerPayloadIpnPaytech,
  validerPayloadCheckoutPaytech,
  fabriquerIpnPaytechMohamed,
  calculerHmacPaytech,
} = require('../lib/paytechPayloadValidator');
const {
  targetProvider,
  activeGateway,
  methodePaiement,
  providerRole,
} = require('../lib/paymentGateway');
const paymentService = require('../services/payment');

const notificationService = require('../notificationService');
const paydunyaService = require('../paydunyaService');
const paytechService = require('../paytechService');
const retryQueue = require('../services/notificationRetryQueue');

const h = createHarness('unit-payment-whatsapp');

async function main() {
  retryQueue.resetMemoire();

  // --- 0. PaymentService : bascule PayDunya (sandbox) ↔ PayTech (prod) ---
  h.assertEqual('targetProvider sandbox = paydunya', targetProvider(), 'paydunya');
  h.assertEqual('activeGateway sandbox = paydunya', activeGateway(), 'paydunya');
  h.assertEqual('methodePaiement sandbox', methodePaiement(), 'paydunya');
  h.assertEqual('adapter actif = paydunya', paymentService.getAdapter().name, 'paydunya');
  h.assert('role PayDunya = sandbox', providerRole('paydunya').role === 'sandbox');
  h.assert('role PayTech = production', providerRole('paytech').role === 'production');
  h.assert(
    'meta adapter PayDunya webhook sha512',
    paymentService.getAdapter().getMeta().webhookSecurity === 'sha512_master_key',
  );

  process.env.PAYMENT_PROVIDER = 'paytech';
  h.assertEqual('bascule PAYMENT_PROVIDER=paytech', targetProvider(), 'paytech');
  h.assertEqual('adapter forcé paytech', paymentService.getAdapter().name, 'paytech');
  h.assertEqual('methode après bascule', methodePaiement(), 'paytech');
  h.assert(
    'meta PayTech HMAC',
    paymentService.getAdapter().getMeta().webhookSecurity === 'hmac_sha256',
  );
  process.env.PAYMENT_PROVIDER = 'paydunya';
  h.assertEqual('retour sandbox paydunya', paymentService.getAdapter().name, 'paydunya');

  // --- 1. Format téléphone WhatsApp (indicatif 221) ---
  h.assertEqual(
    'digitsPhone local 9 → 221',
    notificationService.digitsPhone(MOHAMED.telephoneLocal9),
    MOHAMED.telephoneDigitsIntl,
  );
  h.assertEqual(
    'digitsPhone +221 → intl',
    notificationService.digitsPhone(MOHAMED.telephoneRaw),
    MOHAMED.telephoneDigitsIntl,
  );
  h.assertEqual(
    'digitsPhone store espacé → intl',
    notificationService.digitsPhone(MOHAMED.telephoneStore),
    MOHAMED.telephoneDigitsIntl,
  );
  h.assertEqual(
    'digitsPhone 00 221 → intl',
    notificationService.digitsPhone('00221778261225'),
    MOHAMED.telephoneDigitsIntl,
  );
  h.assertEqual(
    'formatNumero → chatId OpenWA',
    notificationService.formatNumero(MOHAMED.telephoneRaw),
    MOHAMED.whatsappChatId,
  );
  h.assertEqual(
    'normalizeTelephoneStore affichage',
    notificationService.normalizeTelephoneStore('778261225'),
    MOHAMED.telephoneStore,
  );
  h.assertThrows('formatNumero refuse indicatif non-SN', () => {
    notificationService.formatNumero('+33612345678');
  }, 'invalide');
  h.assertThrows('formatNumero refuse trop court', () => {
    notificationService.formatNumero('77826');
  }, 'invalide');

  // --- 2. Payloads / templates WhatsApp ---
  const msgConfirm =
    `⚽ C'est confirmé ${MOHAMED.prenom} !\n\n` +
    `Ton terrain t'attend :\n` +
    `📍 Arena Mohamed Parcelles — Parcelles Assainies\n` +
    `🗓️ lundi 15 septembre à 18:00\n` +
    `🏷️ Code : *TF-482910*\n\n` +
    `💰 Avance payée : ${notificationService.formaterMontant(MOHAMED.montants.avancePayin)} (hors frais opérateur)\n` +
    `💵 À régler sur place : ${notificationService.formaterMontant(MOHAMED.montants.resteSurPlace)}\n\n` +
    `📌 Viens *30 minutes avant* avec ce QR code`;

  const vConfirm = validerTemplateConfirmation(msgConfirm, {
    prenom: MOHAMED.prenom,
    code: 'TF-482910',
    montantAvance: MOHAMED.montants.avancePayin,
  });
  h.assert('template confirmation structure OK', vConfirm.ok, vConfirm.errors.join(','));

  const payloadTexte = validerPayloadMessageTexte({
    chatId: MOHAMED.whatsappChatId,
    message: msgConfirm,
  });
  h.assert('payload texte OpenWA OK', payloadTexte.ok, payloadTexte.errors.join(','));
  h.assert('chatId Mohamed valide', validerChatIdWhatsApp(MOHAMED.whatsappChatId));

  const msgPayout =
    `Mohamed, tu as reçu ${notificationService.formaterMontant(MOHAMED.montants.payoutGerant)} ` +
    `via Wave (reversement TerrainSN).`;
  const vPayout = validerTemplatePayoutRecu(msgPayout, { montant: MOHAMED.montants.payoutGerant });
  h.assert('template payout réception OK', vPayout.ok, vPayout.errors.join(','));

  const msgRefund =
    `😕 Oups ${MOHAMED.prenom}...\nTon paiement sera remboursé sous 24h, promis.\nMontant : 5 000 FCFA.`;
  h.assert('template remboursement OK', validerTemplateRemboursement(msgRefund).ok);

  const boutons = validerBoutonsOptionnels({
    buttons: [{ id: 'voir_resa', text: 'Voir ma réservation' }],
  });
  h.assert('boutons interactifs OK', boutons.ok && boutons.mode === 'interactif');
  h.assert('texte simple sans boutons OK', validerBoutonsOptionnels({}).ok);

  // --- 3a. Signature IPN PayDunya (SHA-512 master key) ---
  const hashOk = hashDepuisMasterKey(process.env.PAYDUNYA_MASTER_KEY);
  h.assert('PayDunya verifierHash hash valide', paydunyaService.verifierHashPaydunya(hashOk));
  h.assert(
    'PayDunya verifierHash hash invalide',
    !paydunyaService.verifierHashPaydunya(crypto.createHash('sha512').update('autre-cle').digest('hex')),
  );
  h.assert(
    'PayDunya refuse longueur incorrecte',
    !paydunyaService.verifierHashPaydunya('abcd'),
  );
  h.assert(
    'PaymentService.verifyWebhook PayDunya',
    paymentService.verifyWebhook({ hash: hashOk }, {}, { provider: 'paydunya' }),
  );

  const nested = paydunyaService.extrairePayloadIpn({
    data: fabriquerPayloadConfirme({ reservationId: 42, refCommand: 'TF-42-MOH-PAYIN' }),
  });
  h.assertEqual('IPN PayDunya nested status', nested.status, 'completed');
  h.assertEqual('IPN PayDunya reservation_id', nested.custom_data.reservation_id, '42');

  // --- 3b. Sécurité / payloads IPN PayTech (prod) ---
  const ipnPaytech = fabriquerIpnPaytechMohamed({
    reservationId: 42,
    amount: MOHAMED.montants.avancePayin,
    apiKey: process.env.PAYTECH_API_KEY,
    apiSecret: process.env.PAYTECH_API_SECRET,
  });
  const structPaytech = validerPayloadIpnPaytech(ipnPaytech);
  h.assert('payload IPN PayTech structure OK', structPaytech.ok, structPaytech.errors.join(','));
  h.assert('PayTech HMAC valide (verifierIpnPaytech)', paytechService.verifierIpnPaytech(ipnPaytech));
  h.assert(
    'PaymentService.verifyWebhook PayTech',
    paymentService.verifyWebhook(ipnPaytech, {}, { provider: 'paytech' }),
  );

  const badIpn = { ...ipnPaytech, hmac_compute: '00'.repeat(32) };
  h.assert('PayTech HMAC invalide rejeté', !paytechService.verifierIpnPaytech(badIpn));

  const keyHash = crypto.createHash('sha256').update(process.env.PAYTECH_API_KEY).digest('hex');
  const secretHash = crypto.createHash('sha256').update(process.env.PAYTECH_API_SECRET).digest('hex');
  h.assert(
    'PayTech SHA256 clés API valide',
    paytechService.verifierIpnPaytech({
      api_key_sha256: keyHash,
      api_secret_sha256: secretHash,
    }),
  );

  const checkoutBody = {
    item_name: 'Avance réservation — Arena Mohamed Parcelles',
    item_price: MOHAMED.montants.avancePayin,
    currency: 'XOF',
    ref_command: 'TF-42-MOH-PAYIN',
    ipn_url: 'https://api.example.test/webhook/paytech',
    success_url: 'https://app.example.test/succes',
    cancel_url: 'https://app.example.test/annule',
  };
  const vCheckout = validerPayloadCheckoutPaytech(checkoutBody);
  h.assert('payload checkout PayTech OK', vCheckout.ok, vCheckout.errors.join(','));
  h.assert(
    'checkout sans HTTPS rejeté',
    !validerPayloadCheckoutPaytech({ ...checkoutBody, ipn_url: 'http://localhost/webhook' }).ok,
  );

  const hmacAttendu = calculerHmacPaytech({
    amount: MOHAMED.montants.avancePayin,
    refCommand: ipnPaytech.ref_command,
    apiKey: process.env.PAYTECH_API_KEY,
    apiSecret: process.env.PAYTECH_API_SECRET,
  });
  h.assertEqual('HMAC fabriqué = hmac_compute', ipnPaytech.hmac_compute, hmacAttendu);

  // --- 4. Mock API PayDunya via PaymentService (sandbox) ---
  const fetchMock = installerFetchMock({
    reservationId: 99,
    refCommand: 'TF-99-MOH-PAYIN',
    totalAmount: MOHAMED.montants.avancePayin,
  });
  try {
    const checkout = await paymentService.createCheckout({
      reservationId: 99,
      terrain: { nom: 'Arena Mohamed Parcelles' },
      montantAvance: MOHAMED.montants.avancePayin,
      montantRestant: MOHAMED.montants.resteSurPlace,
      prix: MOHAMED.montants.prixTotal,
      refCommand: 'TF-99-MOH-PAYIN',
      joueurNom: MOHAMED.nom,
      joueurTelephone: MOHAMED.telephoneLocal9,
    });
    h.assert('mock checkout via PaymentService', checkout.success && checkout.provider === 'paydunya');
    h.assert('mock checkout token', Boolean(checkout.token));

    const confirme = await paydunyaService.confirmerFacture(checkout.token);
    h.assertEqual('mock confirm status', confirme.status, 'completed');
    h.assert('mock confirm hash valide', paydunyaService.verifierHashPaydunya(confirme.hash));

    const payout = await paymentService.payout({
      numero: MOHAMED.telephoneLocal9,
      montant: MOHAMED.montants.payoutGerant,
      canal: 'wave',
      reservationId: 99,
    });
    h.assert('mock payout via PaymentService', payout.success && payout.provider === 'paydunya');

    fetchMock.setFailCheckout(true);
    let checkoutFailed = false;
    try {
      await paymentService.createCheckout({
        reservationId: 100,
        terrain: { nom: 'Arena' },
        montantAvance: 5000,
        montantRestant: 35000,
        prix: 40000,
        refCommand: 'TF-100-X',
        joueurNom: MOHAMED.nom,
        joueurTelephone: MOHAMED.telephoneLocal9,
      });
    } catch {
      checkoutFailed = true;
    }
    h.assert('mock checkout 500 remonté', checkoutFailed);
  } finally {
    fetchMock.restore();
  }

  // --- 5. Mock client WhatsApp + file de rejeu ---
  const wa = creerWhatsappDouble();
  const client = require('../whatsappClient');
  const origSend = client.sendMessageForSession;
  const origImg = client.sendImageForSession;
  wa.installerSur(client);
  process.env.WHATSAPP_MOCK = 'false';

  try {
    const okSend = await notificationService.envoyerMessage(
      MOHAMED.telephoneRaw,
      msgConfirm,
      'platform',
      { type: 'confirmation_payin', destinataire_type: 'joueur', destinataire_id: 1 },
    );
    h.assert('WA mock envoi OK', okSend.ok === true);
    h.assertEqual('WA mock chatId Mohamed', wa.sent[0]?.chatId, MOHAMED.whatsappChatId);
    h.assert('WA mock message contient FCFA', /FCFA/.test(wa.sent[0]?.message || ''));

    wa.failOnce(500);
    const failSend = await notificationService.envoyerMessage(
      MOHAMED.telephoneRaw,
      'Message qui doit échouer',
      'platform',
      {
        type: 'confirmation_payin',
        destinataire_type: 'joueur',
        destinataire_id: 1,
        idempotency_key: 'unit-fail-1',
      },
    );
    h.assert('WA 500 → queued sans throw', failSend.ok === false && failSend.queued === true);
    h.assertEqual('file rejeu a 1 job', await retryQueue.compterPending(), 1);

    const dup = await retryQueue.enfiler({
      telephone: MOHAMED.telephoneRaw,
      message: 'Message qui doit échouer',
      idempotency_key: 'unit-fail-1',
    });
    h.assert('idempotency_key déduplique en file', dup.deduped === true);
  } finally {
    client.sendMessageForSession = origSend;
    client.sendImageForSession = origImg;
    process.env.WHATSAPP_MOCK = 'true';
    retryQueue.resetMemoire();
  }

  await h.assertThrowsAsync(
    'rembourser PayDunya → manuel (501)',
    () => paydunyaService.rembourser('pd_tok_x'),
    'non automatisé',
  );

  h.exitIfFailed();
  console.log('\nTous les tests unitaires Paiement/WhatsApp OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
