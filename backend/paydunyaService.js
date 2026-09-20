const crypto = require('crypto');
const { timingSafeEqualHex } = require('./lib/paymentGateway');
const { resoudreUrlsPaiement } = require('./lib/publicIpnUrl');

const SANDBOX_API = 'https://app.paydunya.com/sandbox-api/v1';
const PROD_API = 'https://app.paydunya.com/api/v1';
/** Doc officielle API PUSH / déboursement (indépendante du checkout v1). */
const DISBURSE_API = 'https://app.paydunya.com/api/v2';
const DISBURSE_SANDBOX_API = 'https://app.paydunya.com/sandbox-api/v2';

function estModeTest() {
  const mode = String(process.env.PAYDUNYA_MODE || 'test').toLowerCase();
  return mode !== 'live' && mode !== 'prod' && mode !== 'production';
}

function apiBase() {
  if (process.env.PAYDUNYA_API_BASE) return String(process.env.PAYDUNYA_API_BASE).replace(/\/$/, '');
  return estModeTest() ? SANDBOX_API : PROD_API;
}

function disburseApiBase() {
  if (process.env.PAYDUNYA_DISBURSE_API_BASE) {
    return String(process.env.PAYDUNYA_DISBURSE_API_BASE).replace(/\/$/, '');
  }
  // Les exemples officiels utilisent api/v2 même avec des clés test_*.
  // Sandbox-api/v2 reste dispo via PAYDUNYA_DISBURSE_API_BASE si besoin.
  return estModeTest() && String(process.env.PAYDUNYA_DISBURSE_USE_SANDBOX || '').toLowerCase() === 'true'
    ? DISBURSE_SANDBOX_API
    : DISBURSE_API;
}

function withdrawModeDepuisCanal(canal) {
  const c = String(canal || 'wave').toLowerCase();
  if (c === 'om' || c === 'orange' || c === 'orange_money') return 'orange-money-senegal';
  if (c === 'free' || c === 'free_money') return 'free-money-senegal';
  if (c === 'expresso' || c === 'emoney' || c === 'e-money') return 'expresso-senegal';
  if (c === 'paydunya') return 'paydunya';
  return 'wave-senegal';
}

function aliasTelephoneSn(numero) {
  return String(numero || '').replace(/\D/g, '').slice(-9);
}

async function resoudreCallbackPayout() {
  const explicite = String(
    process.env.PAYDUNYA_PAYOUT_CALLBACK_URL
      || process.env.PAYDUNYA_CALLBACK_URL
      || '',
  ).trim();
  if (explicite && /^https?:\/\//i.test(explicite)) return explicite;
  try {
    const { resoudreIpnUrl } = require('./lib/publicIpnUrl');
    const ipn = await resoudreIpnUrl();
    if (ipn && /^https?:\/\//i.test(ipn)) return ipn;
  } catch {
    /* ignore */
  }
  const domain = String(process.env.APP_DOMAIN || '').replace(/\/$/, '');
  if (domain && /^https?:\/\//i.test(domain)) return `${domain}/webhook/paydunya`;
  const error = new Error(
    'Callback payout PayDunya manquant (PAYDUNYA_PAYOUT_CALLBACK_URL ou PAYDUNYA_CALLBACK_URL HTTPS requis)',
  );
  error.code = 'PAYDUNYA_PAYOUT_CALLBACK_MISSING';
  error.statusCode = 503;
  throw error;
}

function headersPaydunya() {
  const master = process.env.PAYDUNYA_MASTER_KEY || '';
  const privateKey = process.env.PAYDUNYA_PRIVATE_KEY || '';
  const token = process.env.PAYDUNYA_TOKEN || '';
  return {
    'Content-Type': 'application/json',
    'PAYDUNYA-MASTER-KEY': master,
    'PAYDUNYA-PRIVATE-KEY': privateKey,
    'PAYDUNYA-TOKEN': token,
  };
}

function assertConfigured() {
  if (!process.env.PAYDUNYA_MASTER_KEY || !process.env.PAYDUNYA_PRIVATE_KEY || !process.env.PAYDUNYA_TOKEN) {
    const error = new Error("PayDunya n'est pas configuré");
    error.statusCode = 503;
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Erreurs MySQL / réseau côté sandbox PayDunya — souvent transitoires. */
function estErreurTransitoire(detail, httpStatus) {
  const text = String(detail || '');
  if (/SQLSTATE\[(?:HY000|08004)\]\s*\[1040\]|Too many connections/i.test(text)) return true;
  if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|fetch failed/i.test(text)) return true;
  if (httpStatus === 502 || httpStatus === 503 || httpStatus === 429) return true;
  return false;
}

function messageErreurCheckout(detail) {
  const text = String(detail || '');
  if (/SQLSTATE\[(?:HY000|08004)\]\s*\[1040\]|Too many connections/i.test(text)) {
    return 'Le service de paiement PayDunya est temporairement saturé. Réessayez dans quelques instants.';
  }
  return text || 'Impossible de créer le paiement PayDunya';
}

function retryMax() {
  const n = Number(process.env.PAYDUNYA_RETRY_MAX);
  return Number.isFinite(n) && n >= 0 ? Math.min(8, Math.floor(n)) : 3;
}

function retryBaseMs() {
  const n = Number(process.env.PAYDUNYA_RETRY_BASE_MS);
  return Number.isFinite(n) && n >= 100 ? n : 800;
}

function hashMasterKey() {
  return crypto.createHash('sha512').update(String(process.env.PAYDUNYA_MASTER_KEY || '')).digest('hex');
}

function verifierHashPaydunya(hash) {
  const expected = hashMasterKey();
  return timingSafeEqualHex(expected, hash);
}

function extrairePayloadIpn(body = {}) {
  let data = body.data != null ? body.data : body;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    try {
      data = JSON.parse(trimmed);
    } catch {
      data = body;
    }
  }
  if (!data || typeof data !== 'object') return {};
  return data;
}

async function confirmerFacture(token) {
  assertConfigured();
  const invoiceToken = String(token || '').trim();
  if (!invoiceToken) {
    const error = new Error('Token PayDunya manquant');
    error.statusCode = 400;
    throw error;
  }
  const response = await fetch(`${apiBase()}/checkout-invoice/confirm/${encodeURIComponent(invoiceToken)}`, {
    method: 'GET',
    headers: headersPaydunya(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || String(payload.response_code) !== '00') {
    const detail = payload.response_text || payload.description || JSON.stringify(payload).slice(0, 200);
    const error = new Error(detail || 'Impossible de confirmer la facture PayDunya');
    error.statusCode = 502;
    throw error;
  }
  if (!verifierHashPaydunya(payload.hash)) {
    const error = new Error('Signature PayDunya invalide');
    error.statusCode = 400;
    throw error;
  }
  return payload;
}

async function creerCheckout({
  reservationId,
  terrain,
  montantAvance,
  montantRestant,
  prix,
  refCommand,
  joueurNom,
  joueurTelephone,
  preferredChannel,
  kind = 'reservation',
  itemName,
  commandName,
  customField,
}) {
  assertConfigured();
  const montant = Math.round(Number(montantAvance || 0));
  if (!Number.isFinite(montant) || montant < 200) {
    const error = new Error('PayDunya sandbox exige un montant d’au moins 200 FCFA');
    error.statusCode = 400;
    throw error;
  }
  const { ipnUrl, successUrl, cancelUrl } = await resoudreUrlsPaiement(reservationId, 'paydunya', { kind });
  const storeName = process.env.PAYDUNYA_STORE_NAME || 'TerrainSN1';
  const nomTerrain = terrain?.nom || 'Terrain';
  const customer = {};
  if (joueurNom) customer.name = String(joueurNom);
  if (joueurTelephone) customer.phone = String(joueurTelephone).replace(/\D/g, '').slice(-9);

  const label =
    itemName ||
    (kind === 'abonnement'
      ? `Abonnement — ${nomTerrain}`
      : kind === 'achat'
        ? `Achat définitif — ${nomTerrain}`
        : `Avance réservation — ${nomTerrain}`);

  const body = {
    invoice: {
      items: {
        item_0: {
          name: label,
          quantity: 1,
          unit_price: String(montant),
          total_price: String(montant),
          description: commandName || `TerrainSN #${reservationId}`,
        },
      },
      total_amount: montant,
      description: label,
    },
    store: { name: storeName },
    custom_data: {
      reservation_id: kind === 'reservation' ? String(reservationId) : undefined,
      ref_command: refCommand,
      kind,
      ...(preferredChannel ? { canal_paiement: preferredChannel } : {}),
      ...(customField && typeof customField === 'object' ? customField : {}),
    },
    actions: {
      callback_url: ipnUrl,
      return_url: successUrl,
      cancel_url: cancelUrl,
    },
  };
  if (customer.name || customer.phone) body.invoice.customer = customer;

  const maxAttempts = retryMax() + 1;
  let lastDetail = '';
  let lastStatus = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    let payload = {};
    try {
      response = await fetch(`${apiBase()}/checkout-invoice/create`, {
        method: 'POST',
        headers: headersPaydunya(),
        body: JSON.stringify(body),
      });
      payload = await response.json().catch(() => ({}));
    } catch (networkErr) {
      lastDetail = networkErr.message || String(networkErr);
      lastStatus = 0;
      if (attempt < maxAttempts && estErreurTransitoire(lastDetail, 0)) {
        const wait = retryBaseMs() * 2 ** (attempt - 1);
        console.warn(`[PAYDUNYA] checkout réseau échoué (essai ${attempt}/${maxAttempts}), retry dans ${wait}ms:`, lastDetail);
        await sleep(wait);
        continue;
      }
      const error = new Error(messageErreurCheckout(lastDetail));
      error.statusCode = 502;
      error.code = 'PAYDUNYA_NETWORK';
      error.causeDetail = lastDetail;
      throw error;
    }

    const checkoutUrl = payload.response_text || payload.url;
    const ok =
      response.ok &&
      String(payload.response_code) === '00' &&
      checkoutUrl &&
      payload.token &&
      !/SQLSTATE|Too many connections/i.test(String(checkoutUrl));

    if (ok) {
      return {
        success: true,
        redirectUrl: checkoutUrl,
        redirect_url: checkoutUrl,
        reference: payload.token,
        token: payload.token,
        ref_command: refCommand,
        montantAvance,
        montantRestant,
        prix,
        provider: 'paydunya',
      };
    }

    lastDetail = payload.response_text || payload.description || JSON.stringify(payload).slice(0, 200);
    lastStatus = response.status;
    const retryable = estErreurTransitoire(lastDetail, lastStatus);
    if (retryable && attempt < maxAttempts) {
      const wait = retryBaseMs() * 2 ** (attempt - 1);
      console.warn(
        `[PAYDUNYA] checkout saturé/transitoire (essai ${attempt}/${maxAttempts}), retry dans ${wait}ms:`,
        lastDetail,
      );
      await sleep(wait);
      continue;
    }

    console.error('[PAYDUNYA] checkout-invoice/create échoué', lastStatus, lastDetail, {
      ipnUrl,
      successUrl,
      cancelUrl,
      attempts: attempt,
    });
    break;
  }

  const error = new Error(messageErreurCheckout(lastDetail));
  error.statusCode = 502;
  error.code = /Too many connections|\[1040\]/i.test(String(lastDetail))
    ? 'PAYDUNYA_SATURATED'
    : 'PAYDUNYA_CHECKOUT_FAILED';
  error.causeDetail = lastDetail;
  throw error;
}

async function rembourser(reference) {
  const error = new Error(
    `Remboursement PayDunya non automatisé (réf. ${reference}). Traitez-le depuis le dashboard PayDunya.`,
  );
  error.code = 'PAYDUNYA_REFUND_MANUAL';
  error.statusCode = 501;
  throw error;
}

function payoutEnabled() {
  return String(process.env.PAYDUNYA_PAYOUT_ENABLED || '').toLowerCase() === 'true';
}

/**
 * Déboursement PayDunya (API PUSH v2) :
 * 1) POST /disburse/get-invoice → disburse_token
 * 2) POST /disburse/submit-invoice → success | pending | failed
 * Prérequis compte : activer « Payment And Redistribution » / déboursement dans le dashboard.
 */
async function ordonnerPayout({
  numero,
  montant,
  canal,
  reservationId,
  motif = 'reversement_gerant',
  callbackUrl,
} = {}) {
  const amount = Math.round(Number(montant || 0));
  if (!numero || amount <= 0) {
    const error = new Error('Payout invalide : numéro ou montant manquant');
    error.code = 'PAYOUT_INVALID';
    throw error;
  }
  if (!payoutEnabled()) {
    const error = new Error('Payout PayDunya non autorisé (PAYDUNYA_PAYOUT_ENABLED)');
    error.code = 'PAYOUT_DISABLED';
    throw error;
  }
  assertConfigured();

  const alias = aliasTelephoneSn(numero);
  if (!alias || alias.length < 9) {
    const error = new Error('Numéro bénéficiaire PayDunya invalide');
    error.code = 'PAYOUT_INVALID';
    throw error;
  }

  const withdrawMode = withdrawModeDepuisCanal(canal);
  const callback_url = callbackUrl || (await resoudreCallbackPayout());
  const disburseId = `PO-${reservationId || 'x'}-${Date.now()}`;
  const base = disburseApiBase();

  const initResponse = await fetch(`${base}/disburse/get-invoice`, {
    method: 'POST',
    headers: headersPaydunya(),
    body: JSON.stringify({
      account_alias: alias,
      amount,
      withdraw_mode: withdrawMode,
      callback_url,
    }),
  });
  const initRaw = await initResponse.text();
  let initPayload = {};
  try {
    initPayload = initRaw ? JSON.parse(initRaw) : {};
  } catch {
    initPayload = { response_text: initRaw.slice(0, 300) };
  }
  const disburseToken = initPayload.disburse_token || initPayload.token;
  if (!initResponse.ok || String(initPayload.response_code) !== '00' || !disburseToken) {
    let detail =
      initPayload.response_text || initPayload.description || initRaw.slice(0, 300)
      || 'Initiation déboursement PayDunya échouée';
    if (String(initPayload.response_code) === '1001' || /LIVE Private Key/i.test(String(detail))) {
      detail = `${detail} — Le déboursement PayDunya exige des clés LIVE (pas test_*) et l’option PER/déboursement activée sur le dashboard.`;
    }
    const error = new Error(detail);
    error.code = String(initPayload.response_code || 'PAYDUNYA_DISBURSE_INIT');
    error.statusCode = 502;
    error.causeDetail = initPayload;
    throw error;
  }

  const submitResponse = await fetch(`${base}/disburse/submit-invoice`, {
    method: 'POST',
    headers: headersPaydunya(),
    body: JSON.stringify({
      disburse_invoice: disburseToken,
      disburse_id: disburseId,
    }),
  });
  const submitRaw = await submitResponse.text();
  let submitPayload = {};
  try {
    submitPayload = submitRaw ? JSON.parse(submitRaw) : {};
  } catch {
    submitPayload = { response_text: submitRaw.slice(0, 300) };
  }
  const status = String(submitPayload.status || '').toLowerCase();
  const codeOk = String(submitPayload.response_code) === '00';
  const accepted = codeOk && (status === 'success' || status === 'pending' || !status);

  if (!submitResponse.ok || !accepted || status === 'failed') {
    const detail =
      submitPayload.response_text
      || submitPayload.description
      || 'Soumission déboursement PayDunya échouée';
    const error = new Error(detail);
    error.code = String(submitPayload.response_code || 'PAYDUNYA_DISBURSE_SUBMIT');
    error.statusCode = 502;
    error.causeDetail = submitPayload;
    throw error;
  }

  const ref =
    submitPayload.transaction_id
    || submitPayload.provider_ref
    || submitPayload.disburse_tx_id
    || disburseToken
    || disburseId;

  return {
    success: true,
    pending: status === 'pending',
    ref_paytech: ref,
    reference: ref,
    disburse_token: disburseToken,
    disburse_id: disburseId,
    withdraw_mode: withdrawMode,
    canal,
    numero,
    montant: amount,
    motif,
    provider: 'paydunya',
    raw: submitPayload,
  };
}

module.exports = {
  estModeTest,
  apiBase,
  disburseApiBase,
  assertConfigured,
  verifierHashPaydunya,
  extrairePayloadIpn,
  confirmerFacture,
  creerCheckout,
  rembourser,
  payoutEnabled,
  ordonnerPayout,
  withdrawModeDepuisCanal,
  aliasTelephoneSn,
  hashMasterKey,
  estErreurTransitoire,
  messageErreurCheckout,
};
