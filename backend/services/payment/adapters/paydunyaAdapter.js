/**
 * Adaptateur PayDunya — Sandbox / Dev / Tests uniquement.
 * Ne doit PAS être le provider de production déployé.
 */
const paydunyaService = require('../../../paydunyaService');
const { PROVIDERS, providerRole } = require('../../../lib/paymentGateway');

const name = PROVIDERS.PAYDUNYA;

function getMeta() {
  return {
    ...providerRole(name),
    currency: 'XOF',
    webhookSecurity: 'sha512_master_key',
  };
}

async function createCheckout(params) {
  const result = await paydunyaService.creerCheckout(params);
  return { ...result, provider: name };
}

async function confirmInvoice(token) {
  return paydunyaService.confirmerFacture(token);
}

function verifyWebhook(payload = {}) {
  const data = paydunyaService.extrairePayloadIpn(payload);
  return paydunyaService.verifierHashPaydunya(data.hash || payload.hash);
}

function extractIpnPayload(body) {
  return paydunyaService.extrairePayloadIpn(body);
}

async function refund(reference) {
  return paydunyaService.rembourser(reference);
}

async function payout(params) {
  const result = await paydunyaService.ordonnerPayout(params);
  return { ...result, provider: name };
}

function isPayoutEnabled() {
  return paydunyaService.payoutEnabled();
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
  /** Accès bas niveau (tests / diagnostics) */
  _impl: paydunyaService,
};
