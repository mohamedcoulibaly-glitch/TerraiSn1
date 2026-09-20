/**
 * =====================================================================
 * PayTech — Tests d'intégration (Pay-In ↔ IPN ↔ BDD ↔ HTTP)
 * =====================================================================
 *
 * Framework : harness Node + Express réel (équivalent Supertest via fetch)
 * Base      : sql.js (SQLite) — DB temporaire isolée (Setup / Teardown)
 * Isolation : mock strict `fetch` vers PayTech (sandbox logique, 0 appel réseau externe)
 *
 * Routes couvertes :
 *   POST /api/payments/checkout   (alias FinTech de /api/paiements)
 *   POST /api/paiements
 *   POST /api/payments/webhook    (alias FinTech de /webhook/paytech)
 *   POST /webhook/paytech
 *
 * Vocabulaire statut :
 *   PENDING  → paiements.statut = 'en_attente' / reservations.statut = 'en_attente'
 *   SUCCESS  → paiements.statut = 'paye'       / reservations.statut = 'confirme'
 *   CANCELLED→ paiements.statut = 'annule'     / reservations.statut = 'annule'
 *
 * Usage : node scripts/test-paytech-integration.js
 *      ou npm run test:paytech-integration
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `terrainsn-int-paytech-${process.pid}-${Date.now()}.db`);

process.env.DB_PATH = tmpDb;
process.env.PAYMENT_PROVIDER = 'paytech';
process.env.PAYMENT_GATEWAY = 'paytech';
process.env.PAYMENT_MODE = 'production';
process.env.PAYTECH_MOCK = 'false';
process.env.PAYTECH_ENV = 'test';
process.env.PAYTECH_API_KEY = 'pk_test_integration_paytech';
process.env.PAYTECH_API_SECRET = 'sk_test_integration_paytech';
process.env.PAYTECH_BASE_URL = 'https://paytech.sn/api';
process.env.PAYTECH_API_URL = 'https://paytech.sn/api/payment/request-payment';
process.env.PAYTECH_IPN_AUTO = 'false';
process.env.PAYTECH_IPN_URL = 'https://api.terrainsn.test/webhook/paytech';
process.env.PAYTECH_SUCCESS_URL = 'https://api.terrainsn.test/paytech/success';
process.env.PAYTECH_CANCEL_URL = 'https://api.terrainsn.test/paytech/cancel';
process.env.PAYTECH_PAYOUT_ENABLED = 'false';
process.env.PAYDUNYA_FALLBACK_PAYTECH = 'false';
process.env.WHATSAPP_MOCK = 'true';
process.env.WHATSAPP_RETRY_MEMORY = 'true';
process.env.APP_DOMAIN = 'https://app.terrainsn.test';
process.env.NODE_ENV = 'test';

const { createHarness } = require('../test/helpers/harness');
const { MOHAMED } = require('../test/helpers/mohamed');
const { seedMohamedCompte, creerReservationMohamed } = require('../test/helpers/dbFixtures');
const { demarrerPaytechTestApp } = require('../test/helpers/paytechTestApp');
const { installerPaytechFetchMock } = require('../test/mocks/paytechHttp');
const {
  fabriquerIpnPaytechMohamed,
  calculerHmacPaytech,
} = require('../lib/paytechPayloadValidator');
const {
  getDb,
  queryOne,
  queryAll,
  setDbForceFailForTests,
} = require('../database');
const logger = require('../logger');
const { targetProvider } = require('../lib/paymentGateway');
const paymentService = require('../services/payment');

const h = createHarness('integration-paytech-lifecycle');

const API_KEY = process.env.PAYTECH_API_KEY;
const API_SECRET = process.env.PAYTECH_API_SECRET;

/** @type {{ close: Function, request: Function, baseUrl: string } | null} */
let httpApp = null;
/** @type {{ restore: Function, calls: Array, lastCheckoutBody: Function, lastCheckoutHeaders: Function } | null} */
let fetchMock = null;
/** @type {{ proprioId: number, terrainId: number, gerantId: number, joueurId: number } | null} */
let fixtures = null;
/** @type {Array<{ level: string, file: string, message: string }>} */
const securityLogs = [];

let origLoggerError = null;
let origLoggerWarn = null;

async function beforeAll() {
  h.assertEqual('provider cible = paytech', targetProvider(), 'paytech');
  h.assertEqual('adapter PaymentService = paytech', paymentService.getAdapter().name, 'paytech');

  fetchMock = installerPaytechFetchMock({ mode: 'success' });
  httpApp = await demarrerPaytechTestApp();

  origLoggerError = logger.error;
  origLoggerWarn = logger.warn;
  logger.error = (file, message, err) => {
    securityLogs.push({
      level: 'error',
      file: String(file || ''),
      message: String(message || ''),
      detail: err && err.message ? String(err.message) : '',
    });
    return origLoggerError(file, message, err);
  };
  logger.warn = (file, message) => {
    securityLogs.push({ level: 'warn', file: String(file || ''), message: String(message || '') });
    return origLoggerWarn(file, message);
  };

  const db = await getDb();
  fixtures = seedMohamedCompte(db, { payoutMode: 'retrait', paiementProduction: 0, avancePct: 12.5 });
  console.log(`\n[beforeAll] DB=${tmpDb}`);
  console.log(`[beforeAll] HTTP=${httpApp.baseUrl}`);
}

async function beforeEach() {
  securityLogs.length = 0;
  setDbForceFailForTests(false);
  if (fetchMock) fetchMock.setMode('success');
}

async function afterAll() {
  setDbForceFailForTests(false);
  if (logger.error && origLoggerError) logger.error = origLoggerError;
  if (logger.warn && origLoggerWarn) logger.warn = origLoggerWarn;
  if (fetchMock) fetchMock.restore();
  if (httpApp) await httpApp.close();
  try {
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }
  console.log('[afterAll] Teardown HTTP + DB temporaire OK');
}

function lirePaiement(db, reservationId) {
  return queryOne(
    db,
    `SELECT * FROM paiements WHERE reservation_id = ? ORDER BY id DESC LIMIT 1`,
    [reservationId],
  );
}

function lireReservation(db, reservationId) {
  return queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
}

function assertPending(db, reservationId, label) {
  const resa = lireReservation(db, reservationId);
  const pay = lirePaiement(db, reservationId);
  h.assertEqual(`${label} : réservation PENDING (en_attente)`, resa?.statut, 'en_attente');
  h.assert('PENDING paiement existe', Boolean(pay), `reservationId=${reservationId}`);
  h.assertEqual(`${label} : paiement PENDING (en_attente)`, pay?.statut, 'en_attente');
  return { resa, pay };
}

function assertSuccess(db, reservationId, label) {
  const resa = lireReservation(db, reservationId);
  const pay = queryOne(
    db,
    `SELECT * FROM paiements WHERE reservation_id = ? AND statut = 'paye' ORDER BY id DESC LIMIT 1`,
    [reservationId],
  );
  h.assertEqual(`${label} : réservation SUCCESS (confirme)`, resa?.statut, 'confirme');
  h.assert(`${label} : paiement SUCCESS (paye)`, Boolean(pay));
  h.assertEqual(`${label} : montant XOF`, Number(pay.montant), MOHAMED.montants.avancePayin);
  h.assertEqual(`${label} : methode paytech`, pay.methode, 'paytech');
  return { resa, pay };
}

function assertCancelled(db, reservationId, label) {
  const resa = lireReservation(db, reservationId);
  const pay = queryOne(
    db,
    `SELECT * FROM paiements WHERE reservation_id = ? ORDER BY id DESC LIMIT 1`,
    [reservationId],
  );
  h.assertEqual(`${label} : réservation CANCELLED (annule)`, resa?.statut, 'annule');
  h.assertEqual(`${label} : paiement CANCELLED (annule)`, pay?.statut, 'annule');
  return { resa, pay };
}

async function creerReservationPropre(date, heure) {
  const db = await getDb();
  return creerReservationMohamed(db, {
    terrainId: fixtures.terrainId,
    joueurId: fixtures.joueurId,
    date,
    heure,
    avance: MOHAMED.montants.avancePayin,
    prix: MOHAMED.montants.prixTotal,
  });
}

/**
 * Setup : réservation + checkout HTTP → transaction PENDING en BDD.
 */
async function setupPendingViaCheckout(date, heure) {
  const resa = await creerReservationPropre(date, heure);
  const callsBefore = fetchMock.calls.length;

  const res = await httpApp.request('POST', '/api/payments/checkout', {
    body: {
      reservation_id: resa.reservationId,
      methode: 'wave',
      canal_paiement: 'wave',
      currency: 'XOF',
      item_price: MOHAMED.montants.avancePayin,
    },
  });

  h.assert(
    'setup checkout HTTP 201',
    res.status === 201 || res.status === 200,
    `status=${res.status} body=${JSON.stringify(res.body)}`,
  );
  h.assert('setup redirect_url', Boolean(res.body?.redirect_url), JSON.stringify(res.body));
  h.assert('setup reference', Boolean(res.body?.reference_paytech), JSON.stringify(res.body));
  h.assert(
    'setup appel PayTech request-payment',
    fetchMock.calls.length > callsBefore,
    `calls=${fetchMock.calls.length}`,
  );

  const db = await getDb();
  const pending = assertPending(db, resa.reservationId, 'setup');
  return {
    reservationId: resa.reservationId,
    refCommand: pending.pay.reference_paytech || pending.pay.reference_externe || res.body.reference_paytech,
    redirectUrl: res.body.redirect_url,
    token: res.body.token,
    checkout: res,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
async function testA_FluxCreationPayIn() {
  console.log('\n--- A. Intégration Flux Création Pay-In ---');
  await beforeEach();

  // Arrange
  const resa = await creerReservationPropre('2026-09-20', '18:00');
  const dbBefore = await getDb();
  const payBefore = lirePaiement(dbBefore, resa.reservationId);
  h.assert('A Arrange : pas de paiement avant checkout', payBefore == null);

  // Act
  const resCanonical = await httpApp.request('POST', '/api/paiements', {
    body: {
      reservation_id: resa.reservationId,
      methode: 'wave',
      currency: 'XOF',
    },
  });
  const resAlias = await httpApp.request('POST', '/api/payments/checkout', {
    body: { reservation_id: resa.reservationId },
  });

  // Assert — HTTP
  h.assertEqual('A HTTP /api/paiements → 201', resCanonical.status, 201);
  h.assert('A redirect_url présent', String(resCanonical.body?.redirect_url || '').includes('paytech.sn/payment/checkout/'));
  h.assert('A token ou reference présents', Boolean(resCanonical.body?.reference_paytech));
  h.assert(
    'A alias checkout réutilise (200) ou crée',
    resAlias.status === 200 || resAlias.status === 201,
    `status=${resAlias.status}`,
  );
  h.assertEqual('A alias reused=true', resAlias.body?.reused, true);

  // Assert — communication PayTech (headers + payload)
  const headers = fetchMock.lastCheckoutHeaders();
  h.assertEqual('A header API_KEY', headers?.API_KEY, API_KEY);
  h.assertEqual('A header API_SECRET', headers?.API_SECRET, API_SECRET);
  const body = fetchMock.lastCheckoutBody();
  h.assertEqual('A currency XOF envoyée', body?.currency, 'XOF');
  h.assertEqual('A item_price XOF', Number(body?.item_price), MOHAMED.montants.avancePayin);
  h.assert('A ref_command envoyé', Boolean(body?.ref_command));
  h.assert('A env test|prod', body?.env === 'test' || body?.env === 'prod', `env=${body?.env}`);
  h.assert('A item_name', Boolean(body?.item_name));
  h.assert('A command_name', Boolean(body?.command_name));

  // Assert — BDD PENDING
  const db = await getDb();
  const pendingState = assertPending(db, resa.reservationId, 'A');
  if (pendingState.pay) {
    h.assertEqual('A reference BDD = réponse', pendingState.pay.reference_paytech, resCanonical.body.reference_paytech);
    h.assertEqual('A montant PENDING', Number(pendingState.pay.montant), MOHAMED.montants.avancePayin);
  }
  const resaRow = lireReservation(db, resa.reservationId);
  h.assert('A lien_paiement persisté', Boolean(resaRow?.lien_paiement));
  h.assertEqual('A reference_paytech résa', resaRow?.reference_paytech, resCanonical.body?.reference_paytech);
}

async function testB1_IpnSucces() {
  console.log('\n--- B1. IPN Paiement Réussi (critique) ---');
  await beforeEach();

  // Arrange — transaction PENDING
  const pending = await setupPendingViaCheckout('2026-09-21', '18:00');
  const ipn = fabriquerIpnPaytechMohamed({
    reservationId: pending.reservationId,
    amount: MOHAMED.montants.avancePayin,
    refCommand: pending.refCommand,
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    typeEvent: 'sale_complete',
  });

  // Act — POST webhook (route canonique + alias)
  const resWebhook = await httpApp.request('POST', '/webhook/paytech', {
    body: ipn,
    headers: { 'x-paytech-source': 'integration-test' },
  });

  // Assert — HTTP 200 ack PayTech
  h.assertEqual('B1 HTTP 200', resWebhook.status, 200);
  h.assertEqual('B1 received', resWebhook.body?.received, true);
  h.assertEqual('B1 event sale_complete', resWebhook.body?.event, 'sale_complete');
  h.assert('B1 pas ignored', resWebhook.body?.ignored !== true, JSON.stringify(resWebhook.body));

  // Assert — BDD SUCCESS
  const db = await getDb();
  assertSuccess(db, pending.reservationId, 'B1');

  // Act — alias /api/payments/webhook (idempotence replay)
  const replay = await httpApp.request('POST', '/api/payments/webhook', { body: ipn });
  h.assertEqual('B1 replay HTTP 200', replay.status, 200);
  const payCount = queryAll(
    db,
    `SELECT id FROM paiements WHERE reservation_id = ? AND statut = 'paye'`,
    [pending.reservationId],
  ).length;
  h.assertEqual('B1 idempotence : un seul paiement SUCCESS', payCount, 1);
}

async function testB2_IpnFraude() {
  console.log('\n--- B2. IPN Fraude / Payload Altéré ---');
  await beforeEach();

  // Arrange
  const pending = await setupPendingViaCheckout('2026-09-22', '19:00');
  const db = await getDb();
  const snapBefore = assertPending(db, pending.reservationId, 'B2 before');

  // --- B2a : signature invalide ---
  const forged = fabriquerIpnPaytechMohamed({
    reservationId: pending.reservationId,
    amount: MOHAMED.montants.avancePayin,
    refCommand: pending.refCommand,
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    typeEvent: 'sale_complete',
  });
  forged.hmac_compute = '00'.repeat(32);

  // Act
  const resForged = await httpApp.request('POST', '/api/payments/webhook', { body: forged });

  // Assert
  h.assertEqual('B2a HTTP 400 (signature)', resForged.status, 400);
  h.assert(
    'B2a message Signature invalide',
    /Signature PayTech invalide/i.test(String(resForged.body?.error || '')),
    resForged.body?.error,
  );
  assertPending(db, pending.reservationId, 'B2a after forge');
  h.assert(
    'B2a alerte sécurité loguée',
    securityLogs.some(
      (l) =>
        /securite|signature|Webhook PayTech|ALERTE/i.test(l.message)
        || /Signature PayTech invalide/i.test(l.detail),
    ),
    JSON.stringify(securityLogs.slice(-5)),
  );

  // --- B2b : montant modifié (HMAC valide sur montant frauduleux) ---
  const amountTampered = 999999;
  const tampered = {
    type_event: 'sale_complete',
    ref_command: pending.refCommand,
    item_price: amountTampered,
    final_item_price: amountTampered,
    currency: 'XOF',
    custom_field: JSON.stringify({ reservation_id: pending.reservationId }),
    hmac_compute: calculerHmacPaytech({
      amount: amountTampered,
      refCommand: pending.refCommand,
      apiKey: API_KEY,
      apiSecret: API_SECRET,
    }),
  };

  // Act
  const resTampered = await httpApp.request('POST', '/webhook/paytech', { body: tampered });

  // Assert — ack 200 mais ignore métier (pas de SUCCESS)
  h.assertEqual('B2b HTTP 200 (ack transport)', resTampered.status, 200);
  h.assertEqual('B2b ignored montant_incoherent', resTampered.body?.ignored, true);
  h.assertEqual('B2b reason', resTampered.body?.reason, 'montant_incoherent');
  assertPending(db, pending.reservationId, 'B2b after tamper');
  h.assertEqual(
    'B2b statut paiement inchangé',
    lirePaiement(db, pending.reservationId)?.statut,
    snapBefore.pay.statut,
  );
  h.assert(
    'B2b alerte montant incoherent loguée',
    securityLogs.some((l) => /montant incoherent/i.test(l.message)),
    JSON.stringify(securityLogs.slice(-8)),
  );

  // --- B2c : absence totale de signature ---
  const naked = {
    type_event: 'sale_complete',
    ref_command: pending.refCommand,
    item_price: MOHAMED.montants.avancePayin,
    final_item_price: MOHAMED.montants.avancePayin,
    currency: 'XOF',
    custom_field: JSON.stringify({ reservation_id: pending.reservationId }),
  };
  const resNaked = await httpApp.request('POST', '/api/payments/webhook', { body: naked });
  h.assertEqual('B2c HTTP 400 sans signature', resNaked.status, 400);
  assertPending(db, pending.reservationId, 'B2c after naked');
}

async function testC_EchecsEtResilience() {
  console.log('\n--- C. Échecs / Annulation / Résilience BDD ---');
  await beforeEach();

  // --- C1 : annulation utilisateur (sale_canceled) ---
  const pendingCancel = await setupPendingViaCheckout('2026-09-23', '17:00');
  const ipnCancel = fabriquerIpnPaytechMohamed({
    reservationId: pendingCancel.reservationId,
    amount: MOHAMED.montants.avancePayin,
    refCommand: pendingCancel.refCommand,
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    typeEvent: 'sale_canceled',
  });

  // Act
  const resCancel = await httpApp.request('POST', '/api/payments/webhook', { body: ipnCancel });

  // Assert
  h.assertEqual('C1 HTTP 200', resCancel.status, 200);
  h.assertEqual('C1 event sale_canceled', resCancel.body?.event, 'sale_canceled');
  const db = await getDb();
  assertCancelled(db, pendingCancel.reservationId, 'C1');

  // --- C2 : événement d'échec non-sale_complete (ignored, pas SUCCESS) ---
  await beforeEach();
  const pendingFail = await setupPendingViaCheckout('2026-09-24', '16:00');
  const ipnFail = fabriquerIpnPaytechMohamed({
    reservationId: pendingFail.reservationId,
    amount: MOHAMED.montants.avancePayin,
    refCommand: pendingFail.refCommand,
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    typeEvent: 'payment_failed',
  });
  const resFail = await httpApp.request('POST', '/webhook/paytech', { body: ipnFail });
  h.assertEqual('C2 HTTP 200', resFail.status, 200);
  h.assertEqual('C2 ignored', resFail.body?.ignored, true);
  h.assertEqual('C2 event payment_failed', resFail.body?.event, 'payment_failed');
  assertPending(await getDb(), pendingFail.reservationId, 'C2 échec → reste PENDING');

  // --- C3 : BDD inaccessible sur checkout ---
  await beforeEach();
  const resaDb = await creerReservationPropre('2026-09-25', '15:00');
  setDbForceFailForTests(true);

  // Act
  const resDbDown = await httpApp.request('POST', '/api/payments/checkout', {
    body: { reservation_id: resaDb.reservationId, methode: 'wave' },
  });

  // Assert
  h.assertEqual('C3 checkout BDD down → 500', resDbDown.status, 500);
  h.assert(
    'C3 message explicite',
    /inaccessible|Erreur|pas configuré|PayTech/i.test(String(resDbDown.body?.error || '')),
    resDbDown.body?.error,
  );
  setDbForceFailForTests(false);

  // BDD rétablie : réservation toujours PENDING (aucune écriture partielle de succès)
  const afterDown = lireReservation(await getDb(), resaDb.reservationId);
  h.assertEqual('C3 réservation intacte en_attente', afterDown?.statut, 'en_attente');

  // --- C4 : BDD inaccessible sur webhook (ack 200 processing_error — contrat PayTech) ---
  await beforeEach();
  const pendingWh = await setupPendingViaCheckout('2026-09-26', '14:00');
  const ipnOk = fabriquerIpnPaytechMohamed({
    reservationId: pendingWh.reservationId,
    amount: MOHAMED.montants.avancePayin,
    refCommand: pendingWh.refCommand,
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    typeEvent: 'sale_complete',
  });
  setDbForceFailForTests(true);
  const resWhDb = await httpApp.request('POST', '/api/payments/webhook', { body: ipnOk });
  setDbForceFailForTests(false);

  h.assertEqual('C4 webhook BDD down → 200 ack', resWhDb.status, 200);
  h.assertEqual('C4 processing_error', resWhDb.body?.processing_error, true);
  assertPending(await getDb(), pendingWh.reservationId, 'C4 pas de SUCCESS après panne');
}

async function testD_ValidationsHttp() {
  console.log('\n--- D. Validations HTTP annexes ---');
  await beforeEach();

  // Arrange / Act / Assert — reservation_id manquant
  const missing = await httpApp.request('POST', '/api/payments/checkout', { body: {} });
  h.assertEqual('D reservation_id manquant → 400', missing.status, 400);

  // Arrange / Act / Assert — réservation inexistante
  const notFound = await httpApp.request('POST', '/api/paiements', {
    body: { reservation_id: 999999 },
  });
  h.assertEqual('D réservation introuvable → 404', notFound.status, 404);

  // Arrange — réservation déjà confirmée
  const pending = await setupPendingViaCheckout('2026-09-27', '13:00');
  const ipn = fabriquerIpnPaytechMohamed({
    reservationId: pending.reservationId,
    amount: MOHAMED.montants.avancePayin,
    refCommand: pending.refCommand,
    apiKey: API_KEY,
    apiSecret: API_SECRET,
  });
  await httpApp.request('POST', '/webhook/paytech', { body: ipn });
  const afterSuccess = await httpApp.request('POST', '/api/payments/checkout', {
    body: { reservation_id: pending.reservationId },
  });
  h.assertEqual('D checkout sur résa confirmée → 400', afterSuccess.status, 400);
}

async function main() {
  console.log('\n=== PayTech Integration Suite (Pay-In / IPN / BDD) ===');
  try {
    await beforeAll();
    await testA_FluxCreationPayIn();
    await testB1_IpnSucces();
    await testB2_IpnFraude();
    await testC_EchecsEtResilience();
    await testD_ValidationsHttp();
  } finally {
    await afterAll();
  }

  h.exitIfFailed();
  console.log('\nTous les tests d\'intégration PayTech OK (cycle de vie complet).');
}

main().catch(async (err) => {
  console.error('SUITE INTEGRATION CRASH:', err);
  try {
    await afterAll();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
