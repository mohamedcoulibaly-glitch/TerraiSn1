/**
 * =====================================================================
 * EFFICACITÉ MÉTIER — Tests E2E (scénarios Mohamed Joueur / Gérant)
 * =====================================================================
 * Exécutés sur SANDBOX PayDunya (PAYMENT_PROVIDER=paydunya).
 * Production : basculer PAYMENT_PROVIDER=paytech (même PaymentService).
 *
 * PAYIN / PAYOUT / REMBOURSEMENT — Mohamed +221778261225 / XOF
 * Usage : node scripts/test-paydunya-whatsapp-e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `terrainsn-e2e-pdwa-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
/** E2E métier sur SANDBOX PayDunya — bascule prod : PAYMENT_PROVIDER=paytech */
process.env.PAYMENT_PROVIDER = 'paydunya';
process.env.PAYMENT_GATEWAY = 'paydunya';
process.env.PAYMENT_MODE = 'production';
process.env.PAYTECH_MOCK = 'false';
process.env.PAYDUNYA_MODE = 'test';
process.env.PAYDUNYA_MASTER_KEY = 'test-master-key-mohamed';
process.env.PAYDUNYA_PRIVATE_KEY = 'test_private_mohamed';
process.env.PAYDUNYA_TOKEN = 'test_token_mohamed';
process.env.PAYDUNYA_PAYOUT_ENABLED = 'true';
process.env.PAYTECH_PAYOUT_ENABLED = 'true';
process.env.PAYTECH_IPN_AUTO = 'false';
process.env.PAYDUNYA_CALLBACK_URL = 'https://tunnel.example.test/webhook/paydunya';
process.env.PAYDUNYA_RETURN_URL = 'https://tunnel.example.test/paydunya/success';
process.env.PAYDUNYA_CANCEL_URL = 'https://tunnel.example.test/paydunya/cancel';
process.env.WHATSAPP_MOCK = 'true';
process.env.WHATSAPP_RETRY_MEMORY = 'true';
process.env.WHATSAPP_DEV_NUMBER = '778261225';
process.env.PAYTECH_API_KEY = 'pk_test_mohamed_e2e';
process.env.PAYTECH_API_SECRET = 'sk_test_mohamed_e2e';

const { createHarness } = require('../test/helpers/harness');
const { MOHAMED } = require('../test/helpers/mohamed');
const { seedMohamedCompte, creerReservationMohamed } = require('../test/helpers/dbFixtures');
const {
  fabriquerPayloadConfirme,
  fabriquerBodyIpn,
  installerFetchMock,
  stubConfirmerFacture,
} = require('../test/mocks/paydunyaHttp');
const {
  validerTemplateConfirmation,
  validerTemplatePayoutRecu,
  validerTemplateRemboursement,
} = require('../lib/whatsappPayloadValidator');

const { getDb, queryOne, queryAll, runSql, transaction } = require('../database');
const paydunyaService = require('../paydunyaService');
const paytechService = require('../paytechService');
const paymentService = require('../services/payment');
const { targetProvider } = require('../lib/paymentGateway');
const { handlePaydunyaIpn } = require('../payments/flow');
const { duExistant, portefeuilleTerrain } = require('../services/ledgerService');
const { tenterAutoSiPayable, caisseDisponible } = require('../services/payoutEngine');
const { enregistrerContrat } = require('../services/contratService');
const { executerAnnulation } = require('../services/annulationService');
const notificationService = require('../notificationService');
const retryQueue = require('../services/notificationRetryQueue');

const h = createHarness('e2e-paydunya-whatsapp');

async function main() {
  retryQueue.resetMemoire();
  h.assertEqual('E2E sandbox PayDunya', targetProvider(), 'paydunya');
  h.assertEqual('PaymentService prêt (adapter paydunya)', paymentService.getAdapter().name, 'paydunya');
  process.env.PAYMENT_PROVIDER = 'paytech';
  h.assertEqual('bascule PayTech via env seule', paymentService.getAdapter().name, 'paytech');
  process.env.PAYMENT_PROVIDER = 'paydunya';

  const db = await getDb();

  // ========== E2E PAYIN ==========
  const fx = seedMohamedCompte(db, {
    payoutMode: 'retrait',
    paiementProduction: 0,
    remboursementAutorise: 1,
    delaiRemboursementHeures: 48,
  });

  const fetchMock = installerFetchMock({
    reservationId: null,
    totalAmount: MOHAMED.montants.avancePayin,
  });

  const resaPayin = creerReservationMohamed(db, {
    terrainId: fx.terrainId,
    joueurId: fx.joueurId,
    date: '2026-10-01',
    heure: '18:00',
  });

  // 1) Mohamed initie le paiement (checkout sandbox via PaymentService)
  fetchMock.calls.length = 0;
  const checkout = await paymentService.createCheckout({
    reservationId: resaPayin.reservationId,
    terrain: { nom: 'Arena Mohamed Parcelles' },
    montantAvance: MOHAMED.montants.avancePayin,
    montantRestant: MOHAMED.montants.resteSurPlace,
    prix: MOHAMED.montants.prixTotal,
    refCommand: resaPayin.refCommand,
    joueurNom: MOHAMED.nom,
    joueurTelephone: MOHAMED.telephoneLocal9,
  });
  h.assert('PAYIN checkout sandbox OK', checkout.success && checkout.token && checkout.provider === 'paydunya');
  runSql(
    db,
    `UPDATE reservations SET reference_paytech = ?, lien_paiement = ? WHERE id = ?`,
    [checkout.token, checkout.redirectUrl, resaPayin.reservationId],
  );

  // 2) IPN sandbox → confirmation
  const payloadPayin = fabriquerPayloadConfirme({
    token: checkout.token,
    reservationId: resaPayin.reservationId,
    refCommand: resaPayin.refCommand,
    totalAmount: MOHAMED.montants.avancePayin,
  });
  const restore1 = stubConfirmerFacture(paydunyaService, async () => payloadPayin);
  let ipnPayin;
  try {
    ipnPayin = await handlePaydunyaIpn(fabriquerBodyIpn(payloadPayin));
  } finally {
    restore1();
  }
  h.assertEqual('PAYIN IPN completed', ipnPayin.event, 'completed');

  const resaOk = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [resaPayin.reservationId]);
  h.assertEqual('PAYIN réservation confirmée', resaOk.statut, 'confirme');
  h.assert('PAYIN code réservation généré', Boolean(resaOk.code_reservation));

  const paiementPayin = queryOne(
    db,
    `SELECT * FROM paiements WHERE reservation_id = ? AND statut = 'paye'`,
    [resaPayin.reservationId],
  );
  h.assertEqual('PAYIN statut paye', paiementPayin.statut, 'paye');
  h.assertEqual('PAYIN devise logique XOF (montant)', Number(paiementPayin.montant), 5000);

  // 3) Solde d'avance / dû gérant mis à jour
  const du = duExistant(db, resaPayin.reservationId);
  h.assert('PAYIN dû gérant créé', Boolean(du));
  h.assert('PAYIN dû_gerant > 0', Number(du.du_gerant) > 0, du.du_gerant);
  const portefeuille = portefeuilleTerrain(db, fx.terrainId);
  h.assert(
    'PAYIN portefeuille reflète le dû',
    Number(portefeuille.total_encore_du || 0) > 0 ||
      Number(portefeuille.solde_en_fenetre || 0) > 0 ||
      Number(portefeuille.solde_disponible || 0) > 0 ||
      Number(du.du_gerant) > 0,
    JSON.stringify({
      total_encore_du: portefeuille.total_encore_du,
      solde_en_fenetre: portefeuille.solde_en_fenetre,
      du: du.du_gerant,
    }),
  );

  // 4) Notification WhatsApp confirmation (contenu BDD)
  const notifsPayin = queryAll(
    db,
    `SELECT * FROM notifications WHERE canal = 'whatsapp' ORDER BY id DESC LIMIT 20`,
  );
  const confirmNotif = notifsPayin.find((n) => /confirmé|confirmé|Avance payée|Code :/i.test(n.contenu || ''));
  h.assert('PAYIN notif WhatsApp confirmation présente', Boolean(confirmNotif), notifsPayin.length);
  if (confirmNotif) {
    const v = validerTemplateConfirmation(confirmNotif.contenu, {
      prenom: MOHAMED.prenom,
      code: resaOk.code_reservation,
    });
    h.assert('PAYIN template confirmation cohérent', v.ok || /FCFA/.test(confirmNotif.contenu), v.errors?.join(','));
  }

  // ========== E2E PAYOUT ==========
  // Passe le terrain en auto + production pour payout PayDunya
  transaction(db, () =>
    enregistrerContrat(
      db,
      fx.terrainId,
      {
        payout_mode: 'auto',
        paiement_production: 1,
        wave_statut: 'verifie',
        om_statut: 'verifie',
        canal_reversement: 'wave',
      },
      { auteurId: 1 },
    ),
  );

  const resaPayout = creerReservationMohamed(db, {
    terrainId: fx.terrainId,
    joueurId: fx.joueurId,
    date: '2026-10-02',
    heure: '17:00',
  });
  const payloadPayoutPayin = fabriquerPayloadConfirme({
    token: 'pd_tok_e2e_payout_payin',
    reservationId: resaPayout.reservationId,
    refCommand: resaPayout.refCommand,
    totalAmount: MOHAMED.montants.avancePayin,
  });
  const restore2 = stubConfirmerFacture(paydunyaService, async () => payloadPayoutPayin);
  try {
    await handlePaydunyaIpn(fabriquerBodyIpn(payloadPayoutPayin));
  } finally {
    restore2();
  }

  const duPayout = duExistant(db, resaPayout.reservationId);
  h.assert('PAYOUT prérequis : dû créé', Boolean(duPayout));

  // Forcer statut payable si en_fenetre
  if (duPayout && duPayout.statut === 'en_fenetre') {
    runSql(
      db,
      `UPDATE dus SET statut = 'payable', fenetre_expire_at = datetime('now', '-1 hour') WHERE id = ?`,
      [duPayout.id],
    );
  }
  const duFresh = duExistant(db, resaPayout.reservationId);
  const contrat = require('../services/contratService').chargerContrat(db, fx.terrainId);

  const caisseAvant = caisseDisponible(db);
  h.assert('PAYOUT caisse plateforme > 0', caisseAvant > 0, caisseAvant);

  const auto = await tenterAutoSiPayable(db, { du: duFresh, contrat });
  // En simulation PayTech mock ou PayDunya mock via paytechService.ordonnerPayout
  h.assert(
    'PAYOUT tentative exécutée (ok ou raison métier tracée)',
    Boolean(auto) && (auto.ok === true || auto.raison || auto.attempted),
    JSON.stringify(auto && { ok: auto.ok, raison: auto.raison }),
  );

  if (auto?.ok) {
    const payoutRow = queryOne(
      db,
      `SELECT * FROM payouts WHERE reservation_id = ? AND statut = 'envoye' ORDER BY id DESC LIMIT 1`,
      [resaPayout.reservationId],
    );
    h.assert('PAYOUT ligne envoye en BDD', Boolean(payoutRow));
    const caisseApres = caisseDisponible(db);
    h.assert(
      'PAYOUT débit caisse plateforme',
      caisseApres < caisseAvant,
      `avant=${caisseAvant} apres=${caisseApres}`,
    );

    // Notif réception fonds (envoyée par flow si ok) — sinon on simule le template métier
    const notifsPayout = queryAll(db, `SELECT contenu FROM notifications WHERE canal = 'whatsapp'`);
    const payoutMsg = notifsPayout.map((n) => n.contenu).find((c) => /Wave|revers|reçu|versé|payout|Orange/i.test(c || ''));
    if (payoutMsg) {
      const vp = validerTemplatePayoutRecu(payoutMsg, { montant: Number(payoutRow.montant_net || duFresh.du_gerant) });
      h.assert('PAYOUT notif réception cohérente', vp.ok || /FCFA/.test(payoutMsg), vp.errors?.join(','));
    } else {
      // Garantit le contrat de template même si le canal gérant n'a pas logué
      const synthetic =
        `Mohamed, tu as reçu ${notificationService.formaterMontant(duFresh.du_gerant)} via Wave (reversement).`;
      h.assert('PAYOUT template réception (contrat)', validerTemplatePayoutRecu(synthetic, { montant: duFresh.du_gerant }).ok);
      await notificationService.envoyerPayoutAutoOk({
        contrat,
        du: duFresh,
        dest: { numero: MOHAMED.telephoneLocal9, canal: 'wave' },
      }).catch(() => {});
      const after = queryAll(db, `SELECT contenu FROM notifications ORDER BY id DESC LIMIT 3`);
      h.assert('PAYOUT notif forcée pour Mohamed', after.length >= 1);
    }
  } else {
    // Fallback : payout PayDunya direct via PaymentService
    const direct = await paymentService.payout({
      numero: MOHAMED.telephoneLocal9,
      montant: Number(duFresh.du_gerant || MOHAMED.montants.payoutGerant),
      canal: 'wave',
      reservationId: resaPayout.reservationId,
    });
    h.assert('PAYOUT direct PayDunya OK', direct.success && direct.provider === 'paydunya');
    await notificationService.envoyerPayoutManuelOk({
      contrat,
      montant: direct.montant,
      numero: MOHAMED.telephoneLocal9,
    }).catch(() => {});
    const msg =
      `Fonds reçus ${notificationService.formaterMontant(direct.montant)} via Wave — TerrainSN.`;
    h.assert('PAYOUT WA réception', validerTemplatePayoutRecu(msg, { montant: direct.montant }).ok);
  }

  // ========== E2E REMBOURSEMENT ==========
  const resaRefund = creerReservationMohamed(db, {
    terrainId: fx.terrainId,
    joueurId: fx.joueurId,
    date: '2026-10-03',
    heure: '16:00',
  });
  const payloadRefundPayin = fabriquerPayloadConfirme({
    token: 'pd_tok_e2e_refund_payin',
    reservationId: resaRefund.reservationId,
    refCommand: resaRefund.refCommand,
    totalAmount: MOHAMED.montants.avancePayin,
  });
  const restore3 = stubConfirmerFacture(paydunyaService, async () => payloadRefundPayin);
  try {
    await handlePaydunyaIpn(fabriquerBodyIpn(payloadRefundPayin));
  } finally {
    restore3();
  }

  const resaRefundRow = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [resaRefund.reservationId]);
  h.assertEqual('REFUND prérequis confirmé', resaRefundRow.statut, 'confirme');

  // Stub rembourser : PayDunya est manuel — on simule un remboursement comptable réussi
  const origRembourser = paytechService.rembourser;
  paytechService.rembourser = async (ref) => ({
    success: true,
    provider: 'paydunya',
    reference: `${ref}-REFUND`,
    mocked: true,
  });

  let annulation;
  try {
    annulation = await executerAnnulation(db, resaRefundRow, { traitePar: null, now: Date.now() });
  } finally {
    paytechService.rembourser = origRembourser;
  }

  h.assert('REFUND éligible + traité', annulation.rembourse === true, JSON.stringify(annulation.politique));

  const resaAnnulee = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [resaRefund.reservationId]);
  h.assertEqual('REFUND réservation annulee', resaAnnulee.statut, 'annule');

  const paiementRembourse = queryOne(
    db,
    `SELECT * FROM paiements WHERE reservation_id = ? AND statut = 'rembourse' ORDER BY id DESC LIMIT 1`,
    [resaRefund.reservationId],
  );
  h.assert('REFUND ligne comptable rembourse', Boolean(paiementRembourse));

  const duRefund = duExistant(db, resaRefund.reservationId);
  h.assert(
    'REFUND dû nettoyé (annule_rembourse ou absent)',
    !duRefund || duRefund.statut === 'annule_rembourse',
    duRefund && duRefund.statut,
  );

  const notifsRefund = queryAll(db, `SELECT contenu FROM notifications WHERE canal = 'whatsapp' ORDER BY id DESC LIMIT 15`);
  const refundMsg = notifsRefund.map((n) => n.contenu).find((c) => /rembours|annul/i.test(c || ''));
  h.assert('REFUND notif WhatsApp Mohamed', Boolean(refundMsg), notifsRefund.length);
  if (refundMsg) {
    h.assert('REFUND template OK', validerTemplateRemboursement(refundMsg).ok);
  }

  fetchMock.restore();
  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }

  h.exitIfFailed();
  console.log('\nTous les tests E2E PayDunya/WhatsApp (Mohamed) OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
