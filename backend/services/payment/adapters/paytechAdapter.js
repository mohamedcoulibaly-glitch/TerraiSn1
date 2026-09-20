/**
 * Adaptateur PayTech — passerelle officielle de PRODUCTION.
 */
const crypto = require('crypto');
const { PROVIDERS, providerRole, timingSafeEqualHex } = require('../../../lib/paymentGateway');

const name = PROVIDERS.PAYTECH;
const MOCK_SECRET = 'terrainsn-paytech-local-mock';

function getMeta() {
  return {
    ...providerRole(name),
    currency: 'XOF',
    webhookSecurity: 'hmac_sha256',
  };
}

function assertConfigured() {
  if (!process.env.PAYTECH_API_KEY || !process.env.PAYTECH_API_SECRET) {
    const error = new Error("PayTech n'est pas configuré");
    error.statusCode = 503;
    throw error;
  }
}

function apiBase() {
  return String(process.env.PAYTECH_BASE_URL || 'https://paytech.sn/api').replace(/\/$/, '');
}

function paymentMode() {
  if (process.env.PAYMENT_MODE) return String(process.env.PAYMENT_MODE).toLowerCase();
  return String(process.env.PAYTECH_MOCK).toLowerCase() === 'true' ? 'simulation' : 'production';
}

function estModeMock() {
  return paymentMode() === 'simulation';
}

function secretSignature() {
  return estModeMock() ? MOCK_SECRET : process.env.PAYTECH_API_SECRET;
}

function verifierHash(refCommand, receivedHash) {
  const secret = secretSignature();
  if (!refCommand || !receivedHash || !secret) return false;
  const expected = crypto.createHash('sha256').update(`${refCommand}${secret}`).digest('hex');
  return timingSafeEqualHex(expected, receivedHash);
}

/**
 * Vérifie la signature IPN PayTech (HMAC-SHA256 ou couple de hashes SHA-256).
 */
function verifyWebhook(payload = {}, headers = {}) {
  if (estModeMock()) {
    const refCommand = payload.ref_command || payload.refCommand;
    const headerHash = headers['x-paytech-signature'] || headers['x-paytech-hash'] || headers.hash;
    if (verifierHash(refCommand, headerHash)) return true;
  }

  const apiKey = process.env.PAYTECH_API_KEY || '';
  const apiSecret = process.env.PAYTECH_API_SECRET || '';
  if (!apiKey || !apiSecret) return false;

  const hmacCompute = payload.hmac_compute;
  if (hmacCompute) {
    const refCommand = payload.ref_command || payload.refCommand;
    const amount = payload.final_item_price ?? payload.item_price ?? payload.item_price_xof;
    if (amount == null || !refCommand) return false;
    const variants = Array.from(
      new Set(
        [String(amount), Number.isFinite(Number(amount)) ? String(Math.round(Number(amount))) : ''].filter(
          Boolean,
        ),
      ),
    );
    return variants.some((value) => {
      const expectedHmac = crypto
        .createHmac('sha256', apiSecret)
        .update(`${value}|${refCommand}|${apiKey}`)
        .digest('hex');
      return timingSafeEqualHex(expectedHmac, hmacCompute);
    });
  }

  const expectedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
  const expectedSecret = crypto.createHash('sha256').update(apiSecret).digest('hex');
  return (
    timingSafeEqualHex(expectedKey, payload.api_key_sha256) &&
    timingSafeEqualHex(expectedSecret, payload.api_secret_sha256)
  );
}

function extractIpnPayload(body = {}) {
  return body && typeof body === 'object' ? body : {};
}

async function createCheckout({
  reservationId,
  terrain,
  montantAvance,
  montantRestant,
  prix,
  refCommand,
  ipnUrl,
  successUrl,
  cancelUrl,
  preferredChannel,
  itemName,
  commandName,
  customField,
  kind = 'reservation',
}) {
  assertConfigured();
  const { resoudreUrlsPaiement } = require('../../../lib/publicIpnUrl');
  const { targetPaymentPaytech, normalizeCanal } = require('../../../lib/paymentChannels');
  let urls = { ipnUrl, successUrl, cancelUrl };
  if (!urls.ipnUrl || !urls.successUrl || !urls.cancelUrl) {
    urls = await resoudreUrlsPaiement(reservationId, 'paytech', { kind });
  }

  const canal = normalizeCanal(preferredChannel);
  const targetPayment = targetPaymentPaytech(canal);
  const custom = {
    reservation_id: reservationId || undefined,
    ...(customField && typeof customField === 'object' ? customField : {}),
    ...(canal ? { canal_paiement: canal } : {}),
    kind,
  };

  const body = {
    item_name: itemName || `Avance réservation — ${terrain?.nom || 'Terrain'}`,
    item_price: Math.round(Number(montantAvance || 0)),
    currency: 'XOF',
    ref_command: refCommand,
    command_name: commandName || `Réservation TerrainSN #${reservationId}`,
    env: process.env.PAYTECH_ENV || (process.env.NODE_ENV === 'production' ? 'prod' : 'test'),
    ipn_url: urls.ipnUrl,
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
    custom_field: JSON.stringify(custom),
  };
  if (targetPayment) body.target_payment = targetPayment;

  const payUrl = process.env.PAYTECH_API_URL || `${apiBase()}/payment/request-payment`;
  const response = await fetch(payUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      API_KEY: process.env.PAYTECH_API_KEY,
      API_SECRET: process.env.PAYTECH_API_SECRET,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (!payload.redirect_url && !payload.redirectUrl)) {
    const detail = payload.message || payload.error || JSON.stringify(payload).slice(0, 200);
    const error = new Error(detail || 'Impossible de créer le paiement PayTech');
    error.statusCode = 502;
    throw error;
  }

  const redirectUrl = payload.redirect_url || payload.redirectUrl;
  return {
    success: true,
    redirectUrl,
    redirect_url: redirectUrl,
    reference: payload.ref_command || refCommand,
    token: payload.token || null,
    ref_command: refCommand,
    montantAvance,
    montantRestant,
    prix,
    provider: name,
  };
}

/** PayTech ne propose pas de confirm-invoice API : la vérité est l'IPN. */
async function confirmInvoice() {
  return { status: 'completed', provider: name, via: 'ipn' };
}

async function refund(reference) {
  assertConfigured();
  const url = process.env.PAYTECH_REFUND_URL || `${apiBase()}/payment/refund-payment`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      API_KEY: process.env.PAYTECH_API_KEY,
      API_SECRET: process.env.PAYTECH_API_SECRET,
    },
    body: JSON.stringify({ ref_command: reference }),
  });
  if (!response.ok) throw new Error('Le remboursement PayTech a échoué');
  return { success: true, reference, provider: name };
}

function isPayoutEnabled() {
  return String(process.env.PAYTECH_PAYOUT_ENABLED || '').toLowerCase() === 'true';
}

async function payout({ numero, montant, canal, reservationId, motif = 'reversement_gerant' }) {
  const amount = Math.round(Number(montant || 0));
  if (!numero || amount <= 0) {
    const error = new Error('Payout invalide : numéro ou montant manquant');
    error.code = 'PAYOUT_INVALID';
    throw error;
  }
  if (!isPayoutEnabled()) {
    const error = new Error('Payout PayTech non autorisé (PAYTECH_PAYOUT_ENABLED)');
    error.code = 'PAYOUT_DISABLED';
    throw error;
  }
  assertConfigured();
  const url = process.env.PAYTECH_PAYOUT_URL || `${apiBase()}/payment/payout`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      API_KEY: process.env.PAYTECH_API_KEY,
      API_SECRET: process.env.PAYTECH_API_SECRET,
    },
    body: JSON.stringify({
      amount,
      currency: 'XOF',
      recipient: numero,
      channel: canal === 'om' ? 'orange_money' : 'wave',
      ref_command: `PO-${reservationId || Date.now()}`,
      motif,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || 'Le payout PayTech a échoué');
  }
  return {
    success: true,
    ref_paytech: payload.ref_command || payload.reference || `PO-${reservationId}`,
    reference: payload.ref_command || payload.reference,
    canal,
    numero,
    montant: amount,
    provider: name,
  };
}

function buildIpnHmac({ amount, refCommand, apiKey, apiSecret }) {
  const key = apiKey || process.env.PAYTECH_API_KEY || '';
  const secret = apiSecret || process.env.PAYTECH_API_SECRET || '';
  return crypto.createHmac('sha256', secret).update(`${amount}|${refCommand}|${key}`).digest('hex');
}

module.exports = {
  name,
  getMeta,
  createCheckout,
  confirmInvoice,
  verifyWebhook,
  extractIpnPayload,
  refund,
  payout,
  isPayoutEnabled,
  buildIpnHmac,
  verifierHash,
  timingSafeEqualHex,
};
