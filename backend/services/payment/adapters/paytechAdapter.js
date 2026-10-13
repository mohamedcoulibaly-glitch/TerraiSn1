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
    const error = new Error("Paiement en ligne non configuré");
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
    const typeEvent = String(payload.type_event || payload.type || '').toLowerCase();
    const isTransfer = typeEvent.startsWith('transfer_') || Boolean(payload.id_transfer);

    if (isTransfer) {
      const idTransfer = payload.id_transfer;
      const amount = payload.amount ?? payload.amount_xof;
      if (amount == null || !idTransfer) return false;
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
          .update(`${value}|${idTransfer}|${apiKey}`)
          .digest('hex');
        return timingSafeEqualHex(expectedHmac, hmacCompute);
      });
    }

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

/** 9 chiffres nationaux SN (ex. 778261225). */
function digitsPhoneSn(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 9) return digits.slice(-9);
  return digits;
}

/**
 * Préremplit Wave / Orange Money et auto-submit (doc PayTech : pn, nn, fn, tp, nac).
 * Sans cela le checkout affiche encore le choix de toutes les méthodes.
 */
function appendCheckoutAutofill(redirectUrl, { targetPayment, joueurNom, joueurTelephone }) {
  if (!redirectUrl || !targetPayment) return redirectUrl;
  try {
    const url = new URL(String(redirectUrl));
    const nn = digitsPhoneSn(joueurTelephone);
    if (nn.length === 9) {
      url.searchParams.set('pn', `+221${nn}`);
      url.searchParams.set('nn', nn);
    }
    const fn = String(joueurNom || '').trim();
    if (fn) url.searchParams.set('fn', fn);
    url.searchParams.set('tp', targetPayment);
    // nac=1 : soumission auto (Wave / OM) — voir SDK PayTech & doc InTech
    url.searchParams.set('nac', '1');
    return url.toString();
  } catch {
    return redirectUrl;
  }
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
  joueurNom,
  joueurTelephone,
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
  // Pour dette/abonnement/achat, reservation_id n'est pas pertinent (évite de polluer le custom)
  const custom = {
    ...(kind === 'reservation' && reservationId ? { reservation_id: reservationId } : {}),
    ...(customField && typeof customField === 'object' ? customField : {}),
    ...(canal ? { canal_paiement: canal } : {}),
    kind,
  };

  const defaultItem =
    kind === 'dette'
      ? `Dette commission — ${terrain?.nom || 'TerrainSN'}`
      : kind === 'abonnement'
        ? `Abonnement — ${terrain?.nom || 'Terrain'}`
        : kind === 'achat'
          ? `Achat définitif — ${terrain?.nom || 'Terrain'}`
          : `Avance réservation — ${terrain?.nom || 'Terrain'}`;
  const defaultCommand =
    kind === 'dette'
      ? `Solde dette TerrainSN #${reservationId || ''}`
      : `Réservation TerrainSN #${reservationId}`;

  const body = {
    item_name: itemName || defaultItem,
    item_price: Math.round(Number(montantAvance || 0)),
    currency: 'XOF',
    ref_command: refCommand,
    command_name: commandName || defaultCommand,
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
    const error = new Error(detail || 'Impossible de créer le paiement en ligne');
    error.statusCode = 502;
    throw error;
  }

  const rawRedirect = payload.redirect_url || payload.redirectUrl;
  const redirectUrl = appendCheckoutAutofill(rawRedirect, {
    targetPayment,
    joueurNom,
    joueurTelephone,
  });
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
    target_payment: targetPayment || null,
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
  if (!response.ok) throw new Error('Le remboursement a échoué');
  return { success: true, reference, provider: name };
}

function isPayoutEnabled() {
  return String(process.env.PAYTECH_PAYOUT_ENABLED || '').toLowerCase() === 'true';
}

/** Service PayTech Transfer (cash-out) selon le canal TerrainSN. */
function serviceTransferPaytech(canal) {
  const c = String(canal || '').toLowerCase();
  if (c === 'om' || c === 'orange_money' || c === 'orange') return 'Orange Money Senegal';
  return 'Wave Senegal';
}

/** Numéro local SN pour l’API Transfer (ex. 772457199). */
function numeroTransferPaytech(numero) {
  let digits = String(numero || '').replace(/\D/g, '');
  if (digits.startsWith('221') && digits.length >= 12) digits = digits.slice(3);
  if (digits.startsWith('0') && digits.length === 10) digits = digits.slice(1);
  return digits;
}

/**
 * Solde wallet PayTech (compte marchand) — plafonne les payouts Wave/OM.
 * @returns {Promise<{ balance: number, transferable: number, hold: number, fee: number, raw: object }>}
 */
async function getAccountInfo() {
  assertConfigured();
  const url = `${apiBase()}/transfer/get-account-info`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      API_KEY: process.env.PAYTECH_API_KEY,
      API_SECRET: process.env.PAYTECH_API_SECRET,
    },
  });
  const payload = await response.json().catch(() => ({}));
  const info = payload.accountInfo || payload;
  const transferable = Number(
    info.transferable_amount ?? info.transferableDispo ?? info.totalTransferable ?? 0,
  );
  const balance = Number(info.balance ?? info.solde ?? 0);
  return {
    balance,
    transferable: Number.isFinite(transferable) ? transferable : 0,
    hold: Number(info.balance_hold_amount ?? info.hold_amount ?? 0),
    fee: Number(info.hold_fee ?? info.fee ?? 0),
    raw: payload,
  };
}

function messageErreurPayoutPaytech(payload = {}, amount = 0) {
  const raw = String(payload.message || payload.error || '').trim();
  const maxMatch = raw.match(/maximum\s*dispo\s*:\s*([\d.,]+)/i);
  if (maxMatch || /montant non autoris/i.test(raw)) {
    const max = maxMatch ? maxMatch[1].replace(',', '.') : '?';
    return (
      `Solde PayTech insuffisant pour verser ${amount} FCFA (max dispo : ${max} FCFA). `
      + `Alimente le wallet PayTech ou verse un dû plus petit. `
      + `L’envoi Wave / Orange Money est correct — c’est uniquement le plafond du compte marchand.`
    );
  }
  return raw || 'Le payout PayTech a échoué';
}

async function payout({ numero, montant, canal, reservationId, motif = 'reversement_gerant' }) {
  const amount = Math.round(Number(montant || 0));
  const destination = numeroTransferPaytech(numero);
  if (!destination || amount <= 0) {
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

  try {
    const wallet = await getAccountInfo();
    if (Number.isFinite(wallet.transferable) && amount > Math.floor(wallet.transferable)) {
      const error = new Error(
        `Solde PayTech insuffisant pour verser ${amount} FCFA `
          + `(max dispo : ${wallet.transferable} FCFA). `
          + `Alimente le wallet PayTech avant de payer Wave / Orange Money.`,
      );
      error.code = 'PAYTECH_WALLET_INSUFFICIENT';
      error.transferable = wallet.transferable;
      error.amount = amount;
      throw error;
    }
  } catch (err) {
    if (err.code === 'PAYTECH_WALLET_INSUFFICIENT') throw err;
    // Si get-account-info échoue, on laisse l’API transfer répondre.
  }

  const { resoudreUrlsPaiement } = require('../../../lib/publicIpnUrl');
  let callbackUrl = String(process.env.PAYTECH_IPN_URL || '').trim();
  if (!callbackUrl) {
    try {
      const urls = await resoudreUrlsPaiement(reservationId || 0, 'paytech');
      callbackUrl = urls.ipnUrl;
    } catch {
      callbackUrl = '';
    }
  }

  const service = serviceTransferPaytech(canal);
  const externalId = `PO-${reservationId || 'x'}-${Date.now()}`;
  const url = process.env.PAYTECH_PAYOUT_URL || `${apiBase()}/transfer/transferFund`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      API_KEY: process.env.PAYTECH_API_KEY,
      API_SECRET: process.env.PAYTECH_API_SECRET,
    },
    body: JSON.stringify({
      amount,
      destination_number: destination,
      service,
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      external_id: externalId,
      motif,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const transfer = payload.transfer || {};
  const ok = response.ok && (payload.success === 1 || payload.success === true);
  if (!ok) {
    const error = new Error(messageErreurPayoutPaytech(payload, amount));
    error.code = /insuffisant|maximum dispo|non autoris/i.test(error.message)
      ? 'PAYTECH_WALLET_INSUFFICIENT'
      : 'PAYTECH_PAYOUT_FAILED';
    error.raw = payload;
    error.service = service;
    error.destination = destination;
    throw error;
  }

  const idTransfer = transfer.id_transfer || payload.id_transfer || null;
  const tokenTransfer = transfer.token_transfer || payload.token_transfer || null;
  const state = String(transfer.state || payload.state || 'pending').toLowerCase();
  const pending = !['success', 'completed', 'successful'].includes(state);

  return {
    success: true,
    pending,
    // ref_paytech = id PayTech (webhook transfer_*) ; reference = PO-* (external_id)
    ref_paytech: idTransfer || externalId,
    reference: externalId,
    disburse_token: tokenTransfer || idTransfer || null,
    canal,
    numero: destination,
    montant: amount,
    provider: name,
    raw: payload,
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
  appendCheckoutAutofill,
  digitsPhoneSn,
  confirmInvoice,
  verifyWebhook,
  extractIpnPayload,
  refund,
  payout,
  isPayoutEnabled,
  getAccountInfo,
  serviceTransferPaytech,
  numeroTransferPaytech,
  buildIpnHmac,
  verifierHash,
  timingSafeEqualHex,
};
