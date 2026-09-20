/**
 * Sélection du prestataire de paiement.
 *
 * Convention TerrainSN :
 * - PayDunya  → Sandbox / Dev / Tests uniquement
 * - PayTech   → Production officielle
 *
 * Variables (synonymes) :
 * - PAYMENT_PROVIDER=paydunya|paytech  (recommandé)
 * - PAYMENT_GATEWAY=paydunya|paytech   (alias historique)
 *
 * PAYMENT_MODE=simulation → page locale (aucun appel prestataire au checkout).
 */
const crypto = require('crypto');

/** Prestataires de paiement en ligne (payin). */
const METHODES_EN_LIGNE_SQL = "methode IN ('paytech', 'paydunya')";

const PROVIDERS = Object.freeze({
  PAYDUNYA: 'paydunya',
  PAYTECH: 'paytech',
  SIMULATION: 'simulation',
});

function estSimulation() {
  if (process.env.PAYMENT_MODE) {
    return String(process.env.PAYMENT_MODE).toLowerCase() === 'simulation';
  }
  return String(process.env.PAYTECH_MOCK || '').toLowerCase() === 'true';
}

/**
 * Lit PAYMENT_PROVIDER en priorité, sinon PAYMENT_GATEWAY.
 * @returns {'paydunya'|'paytech'|''}
 */
function providerExplicite() {
  const raw = String(
    process.env.PAYMENT_PROVIDER || process.env.PAYMENT_GATEWAY || '',
  ).toLowerCase().trim();
  if (raw === PROVIDERS.PAYDUNYA || raw === PROVIDERS.PAYTECH) return raw;
  // Alias courants
  if (raw === 'sandbox' || raw === 'test' || raw === 'dev') return PROVIDERS.PAYDUNYA;
  if (raw === 'prod' || raw === 'production' || raw === 'live') return PROVIDERS.PAYTECH;
  return '';
}

/**
 * Prestataire actif pour les appels API (checkout, payout, refund, IPN routing).
 * sandbox / tests → PayDunya
 * production réelle → PayTech
 * PAYMENT_MODE=simulation → page locale (aucun prestataire)
 */
function activeGateway() {
  if (estSimulation()) return PROVIDERS.SIMULATION;
  const explicit = providerExplicite();
  if (explicit) return explicit;
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    return PROVIDERS.PAYTECH;
  }
  return PROVIDERS.PAYDUNYA;
}

/**
 * Prestataire « réel » cible (ignore la page simulation locale).
 * Utile pour savoir si le code est câblé PayTech ou PayDunya
 * même quand PAYMENT_MODE=simulation pour les fixtures BDD.
 */
function targetProvider() {
  const explicit = providerExplicite();
  if (explicit) return explicit;
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    return PROVIDERS.PAYTECH;
  }
  return PROVIDERS.PAYDUNYA;
}

function estPaydunya() {
  return activeGateway() === PROVIDERS.PAYDUNYA;
}

function estPaytech() {
  return activeGateway() === PROVIDERS.PAYTECH;
}

function methodePaiement() {
  const target = targetProvider();
  return target === PROVIDERS.PAYDUNYA ? PROVIDERS.PAYDUNYA : PROVIDERS.PAYTECH;
}

/**
 * Rôle architectural du provider (doc + healthcheck).
 */
function providerRole(name = targetProvider()) {
  if (name === PROVIDERS.PAYDUNYA) {
    return {
      provider: PROVIDERS.PAYDUNYA,
      role: 'sandbox',
      usage: 'simulation_dev_test',
      production: false,
    };
  }
  if (name === PROVIDERS.PAYTECH) {
    return {
      provider: PROVIDERS.PAYTECH,
      role: 'production',
      usage: 'deploy_officiel',
      production: true,
    };
  }
  return {
    provider: PROVIDERS.SIMULATION,
    role: 'local',
    usage: 'page_simulation',
    production: false,
  };
}

function timingSafeEqualHex(a, b) {
  const left = String(a || '').trim().toLowerCase();
  const right = String(b || '').trim().toLowerCase();
  if (!left || !right || left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
  } catch {
    return false;
  }
}

module.exports = {
  METHODES_EN_LIGNE_SQL,
  PROVIDERS,
  estSimulation,
  providerExplicite,
  activeGateway,
  targetProvider,
  estPaydunya,
  estPaytech,
  methodePaiement,
  providerRole,
  timingSafeEqualHex,
};
