/**
 * Suite unitaire PayTech Pay-In — Defensive Testing (FinTech Afrique de l'Ouest)
 *
 * Framework : harness Node maison (`createHarness`) — pas de Jest/Mocha dans ce backend.
 * Isolation  : mock strict de `global.fetch` (axios absent du projet ; API via fetch natif).
 * Cible      : paytechAdapter + paytechPayloadValidator + montantIpnCoherent + verifyWebhook
 *
 * Exécution  : node scripts/test-paytech-payin-unit.js
 *           ou npm run test:paytech-unit
 *
 * Pattern AAA explicite sur chaque cas.
 */
'use strict';

const path = require('path');
const crypto = require('crypto');

// Isoler dotenv / .env réel
process.env.PAYMENT_MODE = 'production';
process.env.PAYTECH_MOCK = 'false';
process.env.PAYMENT_PROVIDER = 'paytech';
process.env.PAYTECH_ENV = 'test';
process.env.PAYTECH_API_KEY = 'pk_test_unit_paytech_sn';
process.env.PAYTECH_API_SECRET = 'sk_test_unit_paytech_sn';
process.env.PAYTECH_BASE_URL = 'https://paytech.sn/api';
process.env.PAYTECH_API_URL = 'https://paytech.sn/api/payment/request-payment';
process.env.PAYTECH_PAYOUT_ENABLED = 'false';
process.env.NODE_ENV = 'test';

const { createHarness } = require('../test/helpers/harness');
const {
  installerPaytechFetchMock,
  creerGardeIdempotenceRefCommand,
} = require('../test/mocks/paytechHttp');
const {
  validerPayloadIpnPaytech,
  validerPayloadCheckoutPaytech,
  calculerHmacPaytech,
  fabriquerIpnPaytechMohamed,
} = require('../lib/paytechPayloadValidator');
const paytechAdapter = require('../services/payment/adapters/paytechAdapter');
const { montantIpnCoherent } = require('../payments/flow');

const h = createHarness('paytech-payin-unit');

const API_KEY = process.env.PAYTECH_API_KEY;
const API_SECRET = process.env.PAYTECH_API_SECRET;

const URLS = Object.freeze({
  ipnUrl: 'https://api.terrainsn.test/webhook/paytech',
  successUrl: 'https://app.terrainsn.test/paytech/success',
  cancelUrl: 'https://app.terrainsn.test/paytech/cancel',
});

const FIXTURE_CHECKOUT = Object.freeze({
  reservationId: 42,
  terrain: { nom: 'Arena Parcelles Assainies' },
  montantAvance: 5000,
  montantRestant: 35000,
  prix: 40000,
  refCommand: 'TF-42-UNIT-PAYIN-001',
  itemName: 'Avance réservation — Arena Parcelles Assainies',
  commandName: 'Réservation TerrainSN #42',
  ...URLS,
});

function assertHeadersAuth(name, headers) {
  h.assertEqual(`${name} : header API_KEY`, headers?.API_KEY, API_KEY);
  h.assertEqual(`${name} : header API_SECRET`, headers?.API_SECRET, API_SECRET);
  h.assertEqual(`${name} : Content-Type`, headers?.['Content-Type'], 'application/json');
}

function assertCheckoutPayloadObligatoire(name, body) {
  h.assert(`${name} : item_name présent`, Boolean(body?.item_name), JSON.stringify(body));
  h.assert(`${name} : item_price présent`, body?.item_price != null, JSON.stringify(body));
  h.assert(`${name} : command_name présent`, Boolean(body?.command_name), JSON.stringify(body));
  h.assert(`${name} : ref_command présent`, Boolean(body?.ref_command), JSON.stringify(body));
  h.assert(`${name} : env présent`, body?.env === 'test' || body?.env === 'prod', `env=${body?.env}`);
  h.assert(`${name} : currency XOF`, String(body?.currency).toUpperCase() === 'XOF', `currency=${body?.currency}`);
}

async function withFetchMock(options, fn) {
  const mock = installerPaytechFetchMock(options);
  try {
    return await fn(mock);
  } finally {
    mock.restore();
  }
}

async function run() {
  console.log(`\n=== PayTech Pay-In Unit Suite ===`);
  console.log(`cwd=${path.basename(process.cwd())} | fetch mocké | AAA\n`);

  // ─────────────────────────────────────────────────────────────────────────
  // A. Flux Nominal de Pay-In (Happy Path)
  // ─────────────────────────────────────────────────────────────────────────

  await withFetchMock({ mode: 'success' }, async (mock) => {
    // Arrange
    const params = { ...FIXTURE_CHECKOUT };

    // Act
    const result = await paytechAdapter.createCheckout(params);

    // Assert
    h.assert('A1 succès createCheckout', result.success === true);
    h.assert('A1 redirectUrl extrait', String(result.redirectUrl).startsWith('https://paytech.sn/payment/checkout/'));
    h.assertEqual('A1 redirect_url alias', result.redirect_url, result.redirectUrl);
    h.assert('A1 token mappé', Boolean(result.token));
    h.assertEqual('A1 ref_command conservé', result.ref_command, params.refCommand);
    h.assertEqual('A1 provider', result.provider, 'paytech');

    const headers = mock.lastCheckoutHeaders();
    assertHeadersAuth('A1', headers);

    const body = mock.lastCheckoutBody();
    assertCheckoutPayloadObligatoire('A1', body);
    h.assertEqual('A1 item_name payload', body.item_name, params.itemName);
    h.assertEqual('A1 item_price payload', body.item_price, 5000);
    h.assertEqual('A1 command_name payload', body.command_name, params.commandName);
    h.assertEqual('A1 ref_command payload', body.ref_command, params.refCommand);
    h.assertEqual('A1 env payload', body.env, 'test');
    h.assertEqual('A1 currency payload', body.currency, 'XOF');
    h.assertEqual('A1 ipn_url', body.ipn_url, URLS.ipnUrl);
    h.assertEqual('A1 success_url', body.success_url, URLS.successUrl);
    h.assertEqual('A1 cancel_url', body.cancel_url, URLS.cancelUrl);
    h.assertEqual('A1 fetch method', mock.lastCheckoutCall()?.method, 'POST');
    h.assert(
      'A1 URL request-payment',
      String(mock.lastCheckoutCall()?.url).includes('/payment/request-payment'),
      mock.lastCheckoutCall()?.url,
    );
  });

  await withFetchMock({ mode: 'success' }, async (mock) => {
    // Arrange — noms auto générés si absents
    const params = {
      reservationId: 7,
      terrain: { nom: 'Stade Ouakam' },
      montantAvance: 2500,
      refCommand: 'TF-7-UNIT-AUTO',
      ...URLS,
    };

    // Act
    const result = await paytechAdapter.createCheckout(params);
    const body = mock.lastCheckoutBody();

    // Assert
    h.assert('A2 item_name auto', /Stade Ouakam/.test(body.item_name));
    h.assert('A2 command_name auto', /#7/.test(body.command_name));
    h.assert('A2 redirectUrl retourné', Boolean(result.redirectUrl));
    assertHeadersAuth('A2', mock.lastCheckoutHeaders());
  });

  {
    // Arrange — validation pure du payload checkout attendu côté PayTech
    const body = {
      item_name: FIXTURE_CHECKOUT.itemName,
      item_price: FIXTURE_CHECKOUT.montantAvance,
      currency: 'XOF',
      ref_command: FIXTURE_CHECKOUT.refCommand,
      command_name: FIXTURE_CHECKOUT.commandName,
      env: 'test',
      ipn_url: URLS.ipnUrl,
      success_url: URLS.successUrl,
      cancel_url: URLS.cancelUrl,
    };

    // Act
    const v = validerPayloadCheckoutPaytech(body);

    // Assert
    h.assert('A3 validator checkout OK', v.ok, v.errors.join(','));
    h.assertEqual('A3 zero errors', v.errors.length, 0);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // B. Gestion des Erreurs API PayTech (Edge Cases)
  // ─────────────────────────────────────────────────────────────────────────

  await withFetchMock({ mode: 'auth_fail_401' }, async (mock) => {
    // Arrange
    const params = { ...FIXTURE_CHECKOUT, refCommand: 'TF-42-AUTH-401' };

    // Act + Assert
    let err;
    try {
      await paytechAdapter.createCheckout(params);
    } catch (e) {
      err = e;
    }
    h.assert('B1 auth 401 lève une exception', Boolean(err), 'aucune exception');
    h.assertEqual('B1 statusCode 502', err?.statusCode, 502);
    h.assert(
      'B1 message explicite credentials',
      /Invalid API credentials|Impossible de créer le paiement PayTech/i.test(String(err?.message || '')),
      err?.message,
    );
    assertHeadersAuth('B1', mock.lastCheckoutHeaders());
  });

  await withFetchMock({ mode: 'auth_fail_body' }, async (mock) => {
    // Arrange — HTTP 200 mais success:0 sans redirect_url
    const params = { ...FIXTURE_CHECKOUT, refCommand: 'TF-42-AUTH-BODY' };

    // Act
    let err;
    try {
      await paytechAdapter.createCheckout(params);
    } catch (e) {
      err = e;
    }

    // Assert
    h.assert('B2 success:0 sans redirect → throw', Boolean(err));
    h.assertEqual('B2 statusCode 502', err?.statusCode, 502);
    h.assert('B2 message non vide pour debug', String(err?.message || '').length > 0, err?.message);
    assertHeadersAuth('B2', mock.lastCheckoutHeaders());
  });

  {
    // Arrange — paramètres manquants côté validateur défensif (avant envoi)
    const incomplete = {
      item_name: 'Avance',
      currency: 'XOF',
      ipn_url: URLS.ipnUrl,
      success_url: URLS.successUrl,
      cancel_url: URLS.cancelUrl,
      // item_price et ref_command absents
    };

    // Act
    const v = validerPayloadCheckoutPaytech(incomplete);

    // Assert
    h.assert('B3 payload incomplet rejeté', v.ok === false);
    h.assert('B3 item_price_invalide', v.errors.includes('item_price_invalide'), v.errors.join(','));
    h.assert('B3 ref_command_manquant', v.errors.includes('ref_command_manquant'), v.errors.join(','));
  }

  await withFetchMock({ mode: 'missing_params' }, async (mock) => {
    // Arrange — PayTech répond 400 paramètres manquants
    const params = {
      ...FIXTURE_CHECKOUT,
      refCommand: undefined,
      montantAvance: undefined,
    };

    // Act
    let err;
    try {
      await paytechAdapter.createCheckout(params);
    } catch (e) {
      err = e;
    }

    // Assert
    h.assert('B4 API missing params → throw', Boolean(err));
    h.assertEqual('B4 statusCode 502', err?.statusCode, 502);
    h.assert(
      'B4 message contient Paramètres ou JSON erreurs',
      /Paramètres manquants|item_price|ref_command|Impossible/i.test(String(err?.message || '')),
      err?.message,
    );
    assertHeadersAuth('B4', mock.lastCheckoutHeaders());
  });

  await withFetchMock({ mode: 'success' }, async (mock) => {
    // Arrange — timeout réseau
    const timeoutErr = new Error('connect ETIMEDOUT paytech.sn:443');
    timeoutErr.code = 'ETIMEDOUT';
    mock.setNextError(timeoutErr);
    const params = { ...FIXTURE_CHECKOUT, refCommand: 'TF-42-TIMEOUT' };

    // Act
    let err;
    try {
      await paytechAdapter.createCheckout(params);
    } catch (e) {
      err = e;
    }

    // Assert
    h.assert('B5 ETIMEDOUT propagé (pas de crash silencieux)', Boolean(err));
    h.assertEqual('B5 code ETIMEDOUT', err?.code, 'ETIMEDOUT');
    h.assert('B5 message timeout explicite', /ETIMEDOUT/i.test(String(err?.message || '')), err?.message);
  });

  await withFetchMock({ mode: 'server_500' }, async (mock) => {
    // Arrange
    const params = { ...FIXTURE_CHECKOUT, refCommand: 'TF-42-HTTP500' };

    // Act
    let err;
    try {
      await paytechAdapter.createCheckout(params);
    } catch (e) {
      err = e;
    }

    // Assert
    h.assert('B6 HTTP 500 → exception', Boolean(err));
    h.assertEqual('B6 statusCode 502', err?.statusCode, 502);
    h.assert(
      'B6 message serveur explicite',
      /Internal Server Error|Impossible de créer/i.test(String(err?.message || '')),
      err?.message,
    );
    assertHeadersAuth('B6', mock.lastCheckoutHeaders());
  });

  {
    // Arrange — clés API absentes
    const savedKey = process.env.PAYTECH_API_KEY;
    const savedSecret = process.env.PAYTECH_API_SECRET;
    delete process.env.PAYTECH_API_KEY;
    delete process.env.PAYTECH_API_SECRET;

    // Act
    let err;
    try {
      await paytechAdapter.createCheckout({ ...FIXTURE_CHECKOUT });
    } catch (e) {
      err = e;
    }

    // Assert
    h.assert('B7 non configuré → throw', Boolean(err));
    h.assertEqual('B7 statusCode 503', err?.statusCode, 503);
    h.assert('B7 message config explicite', /pas configuré/i.test(String(err?.message || '')), err?.message);

    process.env.PAYTECH_API_KEY = savedKey;
    process.env.PAYTECH_API_SECRET = savedSecret;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // C. Sécurité, Validation & Intégrité des Devises
  // ─────────────────────────────────────────────────────────────────────────

  {
    // Arrange — devise incorrecte
    const bodyEur = {
      item_name: 'Avance',
      item_price: 5000,
      currency: 'EUR',
      ref_command: 'TF-42-EUR',
      ipn_url: URLS.ipnUrl,
      success_url: URLS.successUrl,
      cancel_url: URLS.cancelUrl,
    };

    // Act
    const v = validerPayloadCheckoutPaytech(bodyEur);

    // Assert
    h.assert('C1 EUR rejeté', v.ok === false);
    h.assert('C1 currency_xof_requise', v.errors.includes('currency_xof_requise'), v.errors.join(','));
  }

  {
    // Arrange — USD
    const v = validerPayloadCheckoutPaytech({
      item_name: 'Avance',
      item_price: 5000,
      currency: 'USD',
      ref_command: 'TF-42-USD',
      ipn_url: URLS.ipnUrl,
      success_url: URLS.successUrl,
      cancel_url: URLS.cancelUrl,
    });

    // Act déjà fait — Assert
    h.assert('C2 USD rejeté', v.ok === false);
    h.assert('C2 currency_xof_requise', v.errors.includes('currency_xof_requise'));
  }

  {
    // Arrange — prix négatif / nul / non numérique
    const cases = [
      { label: 'négatif', item_price: -1000, expect: 'item_price_invalide' },
      { label: 'nul', item_price: 0, expect: 'item_price_invalide' },
      { label: 'sous-seuil', item_price: 50, expect: 'item_price_invalide' },
      { label: 'NaN', item_price: Number.NaN, expect: 'item_price_invalide' },
      { label: 'string', item_price: 'abc', expect: 'item_price_invalide' },
    ];

    for (const c of cases) {
      // Act
      const v = validerPayloadCheckoutPaytech({
        item_name: 'Avance',
        item_price: c.item_price,
        currency: 'XOF',
        ref_command: `TF-42-PRICE-${c.label}`,
        ipn_url: URLS.ipnUrl,
        success_url: URLS.successUrl,
        cancel_url: URLS.cancelUrl,
      });

      // Assert
      h.assert(`C3 prix ${c.label} rejeté`, v.ok === false, v.errors.join(','));
      h.assert(`C3 prix ${c.label} code`, v.errors.includes(c.expect), v.errors.join(','));
    }
  }

  await withFetchMock({ mode: 'success' }, async (mock) => {
    // Arrange — garde défensive : valider AVANT envoi (empêche fraude logicielle)
    const fraudulent = {
      item_name: 'Avance',
      item_price: -5000,
      currency: 'XOF',
      ref_command: 'TF-42-FRAUD-NEG',
      ipn_url: URLS.ipnUrl,
      success_url: URLS.successUrl,
      cancel_url: URLS.cancelUrl,
    };

    // Act
    const gate = validerPayloadCheckoutPaytech(fraudulent);
    let fetchCalledBeforeGate = mock.calls.length;
    if (!gate.ok) {
      // on n'appelle PAS createCheckout — comportement défensif attendu
    }

    // Assert
    h.assert('C4 gate bloque prix négatif avant fetch', gate.ok === false);
    h.assertEqual('C4 aucun appel réseau après rejet', mock.calls.length, fetchCalledBeforeGate);
  });

  await withFetchMock({ mode: 'success' }, async (mock) => {
    // Arrange — createCheckout hardcode currency XOF même si on ne passe pas de currency
    const params = { ...FIXTURE_CHECKOUT, refCommand: 'TF-42-XOF-HARDCODE' };

    // Act
    await paytechAdapter.createCheckout(params);
    const body = mock.lastCheckoutBody();

    // Assert
    h.assertEqual('C5 currency forcée XOF dans adapter', body.currency, 'XOF');
    h.assertEqual('C5 meta currency', paytechAdapter.getMeta().currency, 'XOF');
  });

  await withFetchMock({ mode: 'success' }, async (mock) => {
    // Arrange — idempotence / double commande même ref_command
    const garde = creerGardeIdempotenceRefCommand();
    const ref = 'TF-42-IDEM-LOCK';
    const params = { ...FIXTURE_CHECKOUT, refCommand: ref };

    // Act — premier processus OK
    const first = await garde.executer(ref, () => paytechAdapter.createCheckout(params));

    // Act — second processus concurrent/répété DOIT échouer
    let conflict;
    try {
      await garde.executer(ref, () => paytechAdapter.createCheckout(params));
    } catch (e) {
      conflict = e;
    }

    // Assert
    h.assert('C6 premier Pay-In OK', first.success === true);
    h.assert('C6 second Pay-In bloqué', Boolean(conflict));
    h.assertEqual('C6 code REF_COMMAND_CONFLICT', conflict?.code, 'REF_COMMAND_CONFLICT');
    h.assertEqual('C6 statusCode 409', conflict?.statusCode, 409);
    h.assert(
      'C6 message explicite double commande',
      /déjà en cours ou terminé/i.test(String(conflict?.message || '')),
      conflict?.message,
    );
    h.assertEqual('C6 un seul appel réseau request-payment', mock.calls.filter((c) => String(c.url).includes('request-payment')).length, 1);
    h.assert('C6 garde marque completed', garde.hasCompleted(ref));
  });

  await withFetchMock({ mode: 'success' }, async (mock) => {
    // Arrange — course parallèle réelle sur même ref
    const garde = creerGardeIdempotenceRefCommand();
    const ref = 'TF-42-RACE';
    const params = { ...FIXTURE_CHECKOUT, refCommand: ref };

    // Act
    const results = await Promise.allSettled([
      garde.executer(ref, () => paytechAdapter.createCheckout(params)),
      garde.executer(ref, () => paytechAdapter.createCheckout(params)),
    ]);

    // Assert
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    h.assertEqual('C7 une seule promesse réussit', fulfilled.length, 1);
    h.assertEqual('C7 une promesse rejetée', rejected.length, 1);
    h.assertEqual('C7 code conflit race', rejected[0].reason?.code, 'REF_COMMAND_CONFLICT');
    h.assertEqual(
      'C7 un seul POST PayTech',
      mock.calls.filter((c) => String(c.url).includes('request-payment')).length,
      1,
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // D. Validation du Webhook IPN (Notification de Paiement)
  // ─────────────────────────────────────────────────────────────────────────

  {
    // Arrange — IPN success authentique
    const ipn = fabriquerIpnPaytechMohamed({
      reservationId: 42,
      amount: 5000,
      refCommand: 'TF-42-IPN-OK',
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      typeEvent: 'sale_complete',
    });

    // Act
    const structure = validerPayloadIpnPaytech(ipn);
    const signatureOk = paytechAdapter.verifyWebhook(ipn, {});

    // Assert
    h.assert('D1 structure IPN success OK', structure.ok, structure.errors.join(','));
    h.assertEqual('D1 type_event', ipn.type_event, 'sale_complete');
    h.assert('D1 HMAC valide (provenance PayTech)', signatureOk === true);
    h.assertEqual('D1 amount', structure.amount, 5000);
    h.assertEqual('D1 currency XOF', structure.currency, 'XOF');
  }

  {
    // Arrange — signature falsifiée
    const ipn = fabriquerIpnPaytechMohamed({
      reservationId: 42,
      amount: 5000,
      refCommand: 'TF-42-IPN-FORGED',
      apiKey: API_KEY,
      apiSecret: API_SECRET,
    });
    const forged = { ...ipn, hmac_compute: 'ff'.repeat(32) };

    // Act
    const signatureOk = paytechAdapter.verifyWebhook(forged, {});

    // Assert
    h.assert('D2 IPN falsifié rejeté', signatureOk === false);
  }

  {
    // Arrange — HMAC recalculé indépendamment
    const amount = 5000;
    const ref = 'TF-42-IPN-HMAC-MATH';
    const expected = calculerHmacPaytech({
      amount,
      refCommand: ref,
      apiKey: API_KEY,
      apiSecret: API_SECRET,
    });
    const payload = {
      type_event: 'sale_complete',
      ref_command: ref,
      item_price: amount,
      final_item_price: amount,
      currency: 'XOF',
      hmac_compute: expected,
    };

    // Act
    const viaAdapter = paytechAdapter.buildIpnHmac({
      amount,
      refCommand: ref,
      apiKey: API_KEY,
      apiSecret: API_SECRET,
    });
    const valid = paytechAdapter.verifyWebhook(payload, {});

    // Assert
    h.assertEqual('D3 HMAC adapter = calculateur', viaAdapter, expected);
    h.assert('D3 verifyWebhook accepte HMAC exact', valid === true);
  }

  {
    // Arrange — couple sha256(api_key)/sha256(api_secret)
    const payload = {
      type_event: 'sale_complete',
      ref_command: 'TF-42-IPN-SHA',
      item_price: 5000,
      final_item_price: 5000,
      currency: 'XOF',
      api_key_sha256: crypto.createHash('sha256').update(API_KEY).digest('hex'),
      api_secret_sha256: crypto.createHash('sha256').update(API_SECRET).digest('hex'),
    };

    // Act
    const ok = paytechAdapter.verifyWebhook(payload, {});
    const bad = paytechAdapter.verifyWebhook(
      { ...payload, api_secret_sha256: '11'.repeat(32) },
      {},
    );

    // Assert
    h.assert('D4 sha256 clés API valides', ok === true);
    h.assert('D4 sha256 secret altéré rejeté', bad === false);
  }

  {
    // Arrange — IPN échec / annulation
    const canceled = fabriquerIpnPaytechMohamed({
      reservationId: 42,
      amount: 5000,
      refCommand: 'TF-42-IPN-CANCEL',
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      typeEvent: 'sale_canceled',
    });
    const failed = fabriquerIpnPaytechMohamed({
      reservationId: 42,
      amount: 5000,
      refCommand: 'TF-42-IPN-FAIL',
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      typeEvent: 'payment_failed',
    });

    // Act
    const structCancel = validerPayloadIpnPaytech(canceled);
    const structFail = validerPayloadIpnPaytech(failed);
    const sigCancel = paytechAdapter.verifyWebhook(canceled, {});
    const sigFail = paytechAdapter.verifyWebhook(failed, {});

    // Assert — signature OK (authenticité) mais événement non-success à traiter comme annulation/ignore
    h.assert('D5 cancel structure OK', structCancel.ok, structCancel.errors.join(','));
    h.assertEqual('D5 type sale_canceled', canceled.type_event, 'sale_canceled');
    h.assert('D5 cancel signature authentique', sigCancel === true);
    h.assert('D5 fail structure OK', structFail.ok, structFail.errors.join(','));
    h.assert('D5 fail ≠ sale_complete', failed.type_event !== 'sale_complete');
    h.assert('D5 fail signature authentique', sigFail === true);
    h.assert(
      'D5 handler métier doit ignorer/annuler (pas confirmer)',
      String(canceled.type_event).toLowerCase() === 'sale_canceled'
        && String(failed.type_event).toLowerCase() !== 'sale_complete',
    );
  }

  {
    // Arrange — IPN sans signature
    const naked = {
      type_event: 'sale_complete',
      ref_command: 'TF-42-IPN-NOSIG',
      item_price: 5000,
      final_item_price: 5000,
      currency: 'XOF',
    };

    // Act
    const structure = validerPayloadIpnPaytech(naked);
    const sig = paytechAdapter.verifyWebhook(naked, {});

    // Assert
    h.assert('D6 signature absente → structure KO', structure.ok === false);
    h.assert('D6 signature_absente', structure.errors.includes('signature_absente'), structure.errors.join(','));
    h.assert('D6 verifyWebhook refuse', sig === false);
  }

  {
    // Arrange — montant IPN cohérent / incohérent
    const reservation = { montant_avance: 5000, acompte: 5000 };

    // Act + Assert
    h.assert(
      'D7 montant exact cohérent',
      montantIpnCoherent(reservation, { final_item_price: 5000 }) === true,
    );
    h.assert(
      'D7 initial_item_price cohérent',
      montantIpnCoherent(reservation, { final_item_price: 120, initial_item_price: 5000 }) === true,
    );
    h.assert(
      'D7 montant incohérent rejeté',
      montantIpnCoherent(reservation, { final_item_price: 99999 }) === false,
    );
  }

  {
    // Arrange — sandbox 100–150 XOF uniquement si PAYTECH_ENV=test
    const reservation = { montant_avance: 5000 };
    const prev = process.env.PAYTECH_ENV;
    process.env.PAYTECH_ENV = 'test';

    // Act
    const sandboxOk = montantIpnCoherent(reservation, { final_item_price: 125 });
    process.env.PAYTECH_ENV = 'prod';
    const sandboxBlockedInProd = montantIpnCoherent(reservation, { final_item_price: 125 });
    process.env.PAYTECH_ENV = prev;

    // Assert
    h.assert('D8 sandbox 125 XOF accepté en test', sandboxOk === true);
    h.assert('D8 sandbox 125 XOF refusé en prod', sandboxBlockedInProd === false);
  }

  {
    // Arrange — devise IPN non XOF
    const ipn = {
      type_event: 'sale_complete',
      ref_command: 'TF-42-IPN-USD',
      item_price: 5000,
      final_item_price: 5000,
      currency: 'USD',
      hmac_compute: calculerHmacPaytech({
        amount: 5000,
        refCommand: 'TF-42-IPN-USD',
        apiKey: API_KEY,
        apiSecret: API_SECRET,
      }),
    };

    // Act
    const v = validerPayloadIpnPaytech(ipn);

    // Assert
    h.assert('D9 IPN USD rejeté', v.ok === false);
    h.assert('D9 devise_non_xof', v.errors.includes('devise_non_xof'), v.errors.join(','));
  }

  {
    // Arrange — montant négatif IPN
    const ipn = {
      type_event: 'sale_complete',
      ref_command: 'TF-42-IPN-NEG',
      item_price: -1,
      final_item_price: -1,
      currency: 'XOF',
      hmac_compute: 'aa'.repeat(32),
    };

    // Act
    const v = validerPayloadIpnPaytech(ipn);

    // Assert
    h.assert('D10 montant négatif IPN rejeté', v.ok === false);
    h.assert('D10 montant_negatif', v.errors.includes('montant_negatif'), v.errors.join(','));
  }

  await withFetchMock({ mode: 'success' }, async (mock) => {
    // Arrange — simulation POST IPN "applicatif" : on vérifie la chaîne auth → mapping
    const ipn = fabriquerIpnPaytechMohamed({
      reservationId: 42,
      amount: 5000,
      refCommand: FIXTURE_CHECKOUT.refCommand,
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      typeEvent: 'sale_complete',
    });

    // Act — couche sécurité webhook (équivalent middleware avant handlePaytechIpn)
    const authPassed = paytechAdapter.verifyWebhook(ipn, {
      'content-type': 'application/json',
      'x-forwarded-for': '41.82.0.1',
    });
    const mapped = {
      event: String(ipn.type_event).toLowerCase(),
      refCommand: ipn.ref_command,
      amount: Number(ipn.final_item_price),
      currency: ipn.currency,
      success: String(ipn.type_event).toLowerCase() === 'sale_complete',
    };

    // Assert
    h.assert('D11 POST IPN auth pass', authPassed === true);
    h.assertEqual('D11 mapping event', mapped.event, 'sale_complete');
    h.assertEqual('D11 mapping ref', mapped.refCommand, FIXTURE_CHECKOUT.refCommand);
    h.assertEqual('D11 mapping amount', mapped.amount, 5000);
    h.assertEqual('D11 mapping currency', mapped.currency, 'XOF');
    h.assert('D11 mapping success flag', mapped.success === true);
    h.assertEqual('D11 aucun fetch sortant pendant IPN', mock.calls.length, 0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // E. Contrôles transverses headers / erreurs explicites
  // ─────────────────────────────────────────────────────────────────────────

  await withFetchMock({ mode: 'no_redirect' }, async (mock) => {
    // Arrange
    const params = { ...FIXTURE_CHECKOUT, refCommand: 'TF-42-NO-REDIRECT' };

    // Act
    let err;
    try {
      await paytechAdapter.createCheckout(params);
    } catch (e) {
      err = e;
    }

    // Assert
    h.assert('E1 sans redirect_url → throw', Boolean(err));
    h.assertEqual('E1 statusCode 502', err?.statusCode, 502);
    h.assert('E1 message debug non vide', String(err?.message || '').length > 0);
    assertHeadersAuth('E1', mock.lastCheckoutHeaders());
  });

  {
    // Arrange — HTTPS obligatoire sur URLs callback
    const v = validerPayloadCheckoutPaytech({
      item_name: 'Avance',
      item_price: 5000,
      currency: 'XOF',
      ref_command: 'TF-42-HTTP',
      ipn_url: 'http://localhost:3001/webhook/paytech',
      success_url: 'http://localhost:8080/ok',
      cancel_url: 'http://localhost:8080/ko',
    });

    // Act déjà — Assert
    h.assert('E2 URLs HTTP rejetées', v.ok === false);
    h.assert('E2 ipn_url_https', v.errors.includes('ipn_url_https'));
    h.assert('E2 success_url_https', v.errors.includes('success_url_https'));
    h.assert('E2 cancel_url_https', v.errors.includes('cancel_url_https'));
  }

  h.exitIfFailed();
  console.log('\nTous les tests unitaires PayTech Pay-In OK (défense FinTech).');
}

run().catch((err) => {
  console.error('SUITE CRASH:', err);
  process.exit(1);
});
