/**
 * PaymentService — façade commune PayDunya (sandbox) / PayTech (prod).
 *
 * Bascule :
 *   PAYMENT_PROVIDER=paydunya   → sandbox / tests
 *   PAYMENT_PROVIDER=paytech    → production
 *
 * Alias historique : PAYMENT_GATEWAY
 */
const {
  PROVIDERS,
  activeGateway,
  targetProvider,
  providerRole,
  estSimulation,
  methodePaiement,
} = require('../../lib/paymentGateway');
const paydunyaAdapter = require('./adapters/paydunyaAdapter');
const paytechAdapter = require('./adapters/paytechAdapter');

const ADAPTERS = Object.freeze({
  [PROVIDERS.PAYDUNYA]: paydunyaAdapter,
  [PROVIDERS.PAYTECH]: paytechAdapter,
});

/**
 * Adaptateur correspondant au provider cible (ignore page simulation).
 * @param {'paydunya'|'paytech'} [force]
 */
function getAdapter(force) {
  const key = force || targetProvider();
  const adapter = ADAPTERS[key];
  if (!adapter) {
    const error = new Error(`Provider de paiement inconnu : ${key}`);
    error.statusCode = 500;
    throw error;
  }
  return adapter;
}

/**
 * Resolves which adapter to use for live API calls.
 * En mode simulation locale, pas d'adaptateur réseau (null).
 */
function getLiveAdapter() {
  const gateway = activeGateway();
  if (gateway === PROVIDERS.SIMULATION) return null;
  return getAdapter(gateway);
}

function describe() {
  const target = targetProvider();
  const active = activeGateway();
  const simulationLocale = estSimulation();
  const hasPaytechKeys = Boolean(
    String(process.env.PAYTECH_API_KEY || '').trim()
    && String(process.env.PAYTECH_API_SECRET || '').trim(),
  );
  const hasPaydunyaKeys = Boolean(
    String(process.env.PAYDUNYA_MASTER_KEY || '').trim()
    && String(process.env.PAYDUNYA_PRIVATE_KEY || '').trim()
    && String(process.env.PAYDUNYA_TOKEN || '').trim(),
  );
  const appDomain = String(
    process.env.APP_DOMAIN || process.env.RENDER_EXTERNAL_URL || '',
  ).trim();
  const publicHttps = /^https:\/\//i.test(appDomain)
    && !/localhost|127\.0\.0\.1/i.test(appDomain);
  const keysOk = target === PROVIDERS.PAYTECH ? hasPaytechKeys : hasPaydunyaKeys;
  return {
    activeGateway: active,
    targetProvider: target,
    methode: methodePaiement(),
    simulationLocale,
    role: providerRole(target),
    hasApiKeys: keysOk,
    appDomain: appDomain || null,
    publicHttps,
    readyForProd: !simulationLocale && keysOk && publicHttps && active !== PROVIDERS.SIMULATION,
    switchHint: 'PAYMENT_PROVIDER=paytech pour la production ; PAYMENT_PROVIDER=paydunya pour la sandbox',
  };
}

async function createCheckout(params, options = {}) {
  const primary = options.provider || targetProvider();
  const adapter = getAdapter(primary);
  try {
    return await adapter.createCheckout(params);
  } catch (err) {
    const allowFallback =
      options.fallback !== false &&
      String(process.env.PAYDUNYA_FALLBACK_PAYTECH || 'true').toLowerCase() !== 'false' &&
      primary === PROVIDERS.PAYDUNYA &&
      (err.code === 'PAYDUNYA_SATURATED' ||
        /Too many connections|\[1040\]/i.test(String(err.causeDetail || err.message || '')));
    if (!allowFallback) throw err;
    if (!process.env.PAYTECH_API_KEY || !process.env.PAYTECH_API_SECRET) throw err;

    try {
      console.warn(
        '[PAYMENT] PayDunya saturé (Too many connections) — bascule automatique vers PayTech.',
      );
      const result = await getAdapter(PROVIDERS.PAYTECH).createCheckout(params);
      return { ...result, provider: PROVIDERS.PAYTECH, fallbackFrom: PROVIDERS.PAYDUNYA };
    } catch (fallbackErr) {
      console.error('[PAYMENT] Fallback PayTech échoué:', fallbackErr.message);
      err.fallbackError = fallbackErr.message;
      throw err;
    }
  }
}

async function refund(reference, options = {}) {
  const adapter = options.provider ? getAdapter(options.provider) : getAdapter();
  return adapter.refund(reference);
}

async function payout(params, options = {}) {
  const adapter = options.provider ? getAdapter(options.provider) : getAdapter();
  return adapter.payout(params);
}

function isPayoutEnabled(options = {}) {
  const adapter = options.provider ? getAdapter(options.provider) : getAdapter();
  return adapter.isPayoutEnabled();
}

function verifyWebhook(payload, headers, options = {}) {
  const adapter = options.provider ? getAdapter(options.provider) : getAdapter();
  return adapter.verifyWebhook(payload, headers);
}

module.exports = {
  PROVIDERS,
  ADAPTERS,
  getAdapter,
  getLiveAdapter,
  describe,
  createCheckout,
  refund,
  payout,
  isPayoutEnabled,
  verifyWebhook,
  paydunyaAdapter,
  paytechAdapter,
};
