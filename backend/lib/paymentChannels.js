/**
 * Canaux mobile money exposés au joueur / admin.
 * PayTech : target_payment ("Wave" | "Orange Money").
 * PayDunya sandbox : pas de ciblage natif — le canal est tracé en custom_data.
 */

const CANAUX = Object.freeze({
  WAVE: 'wave',
  ORANGE_MONEY: 'orange_money',
});

const PAYTECH_TARGET = Object.freeze({
  [CANAUX.WAVE]: 'Wave',
  [CANAUX.ORANGE_MONEY]: 'Orange Money',
});

function normalizeCanal(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (value === 'wave') return CANAUX.WAVE;
  if (value === 'orange_money' || value === 'om' || value === 'orange') return CANAUX.ORANGE_MONEY;
  return null;
}

function targetPaymentPaytech(canal) {
  const normalized = normalizeCanal(canal);
  return normalized ? PAYTECH_TARGET[normalized] : undefined;
}

function labelCanal(canal) {
  const normalized = normalizeCanal(canal);
  if (normalized === CANAUX.WAVE) return 'Wave';
  if (normalized === CANAUX.ORANGE_MONEY) return 'Orange Money';
  return null;
}

/** Préfixes de référence pour router l'IPN vers le bon domaine métier. */
const REF_PREFIX = Object.freeze({
  RESERVATION: 'TF-',
  ABONNEMENT: 'ABO-',
  ACHAT: 'ACHAT-',
});

function kindFromReference(refCommand) {
  const ref = String(refCommand || '');
  if (ref.startsWith(REF_PREFIX.ABONNEMENT)) return 'abonnement';
  if (ref.startsWith(REF_PREFIX.ACHAT)) return 'achat';
  if (ref.startsWith(REF_PREFIX.RESERVATION)) return 'reservation';
  return 'reservation';
}

function abonnementIdDepuisReference(refCommand) {
  const match = String(refCommand || '').match(/^ABO-(\d+)-/);
  return match ? Number(match[1]) : 0;
}

function terrainIdDepuisReferenceAchat(refCommand) {
  const match = String(refCommand || '').match(/^ACHAT-(\d+)-/);
  return match ? Number(match[1]) : 0;
}

module.exports = {
  CANAUX,
  PAYTECH_TARGET,
  REF_PREFIX,
  normalizeCanal,
  targetPaymentPaytech,
  labelCanal,
  kindFromReference,
  abonnementIdDepuisReference,
  terrainIdDepuisReferenceAchat,
};
