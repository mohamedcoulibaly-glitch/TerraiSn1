/**
 * Validateurs purs des payloads / webhooks PayTech (prod).
 */
const crypto = require('crypto');

const REQUIRED_IPN_FIELDS = [
  'ref_command',
  'type_event',
];

/**
 * Structure minimale d'un IPN PayTech sale_complete.
 */
function validerPayloadIpnPaytech(payload = {}) {
  const errors = [];
  for (const field of REQUIRED_IPN_FIELDS) {
    if (payload[field] == null || payload[field] === '') errors.push(`${field}_manquant`);
  }
  const amount = payload.final_item_price ?? payload.item_price;
  if (amount == null || !Number.isFinite(Number(amount))) errors.push('montant_manquant');
  if (Number(amount) < 0) errors.push('montant_negatif');

  const hasHmac = Boolean(payload.hmac_compute);
  const hasKeyPair = Boolean(payload.api_key_sha256 && payload.api_secret_sha256);
  if (!hasHmac && !hasKeyPair) errors.push('signature_absente');

  const currency = payload.currency || payload.currency_code || 'XOF';
  if (String(currency).toUpperCase() !== 'XOF') errors.push('devise_non_xof');

  return { ok: errors.length === 0, errors, amount: Number(amount), currency };
}

/**
 * Payload request-payment (checkout) attendu côté client PayTech.
 */
function validerPayloadCheckoutPaytech(body = {}) {
  const errors = [];
  if (!body.item_name) errors.push('item_name_manquant');
  const price = Number(body.item_price);
  if (
    body.item_price == null
    || body.item_price === ''
    || !Number.isFinite(price)
    || price < 100
  ) {
    errors.push('item_price_invalide');
  }
  if (String(body.currency || '').toUpperCase() !== 'XOF') errors.push('currency_xof_requise');
  if (!body.ref_command) errors.push('ref_command_manquant');
  if (!body.ipn_url || !String(body.ipn_url).startsWith('https://')) errors.push('ipn_url_https');
  if (!body.success_url || !String(body.success_url).startsWith('https://')) errors.push('success_url_https');
  if (!body.cancel_url || !String(body.cancel_url).startsWith('https://')) errors.push('cancel_url_https');
  return { ok: errors.length === 0, errors };
}

function calculerHmacPaytech({ amount, refCommand, apiKey, apiSecret }) {
  return crypto
    .createHmac('sha256', String(apiSecret || ''))
    .update(`${amount}|${refCommand}|${apiKey}`)
    .digest('hex');
}

/**
 * Fabrique un IPN réaliste Mohamed (tests).
 */
function fabriquerIpnPaytechMohamed({
  reservationId = 42,
  amount = 5000,
  refCommand,
  apiKey = process.env.PAYTECH_API_KEY || 'pk_test_mohamed',
  apiSecret = process.env.PAYTECH_API_SECRET || 'sk_test_mohamed',
  typeEvent = 'sale_complete',
} = {}) {
  const ref = refCommand || `TF-${reservationId}-MOH-PAYIN`;
  const hmac = calculerHmacPaytech({ amount, refCommand: ref, apiKey, apiSecret });
  return {
    type_event: typeEvent,
    ref_command: ref,
    item_price: amount,
    final_item_price: amount,
    currency: 'XOF',
    hmac_compute: hmac,
    custom_field: JSON.stringify({ reservation_id: reservationId }),
    client_phone: '778261225',
  };
}

module.exports = {
  REQUIRED_IPN_FIELDS,
  validerPayloadIpnPaytech,
  validerPayloadCheckoutPaytech,
  calculerHmacPaytech,
  fabriquerIpnPaytechMohamed,
};
