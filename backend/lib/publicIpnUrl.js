const fs = require('fs');
const path = require('path');
const { activeGateway } = require('./paymentGateway');

const NGROK_API = process.env.NGROK_API_URL || 'http://127.0.0.1:4040/api/tunnels';
const ENV_PATH = path.join(__dirname, '..', '.env');

function stripSlash(url) {
  return String(url || '').replace(/\/$/, '');
}

function appDomain() {
  return stripSlash(process.env.APP_DOMAIN || 'http://localhost:8080');
}

function isPublicHttps(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname);
  } catch {
    return false;
  }
}

function cheminsGateway(gateway) {
  if (gateway === 'paydunya') {
    return {
      webhook: '/webhook/paydunya',
      success: '/paydunya/success',
      cancel: '/paydunya/cancel',
      envIpn: 'PAYDUNYA_CALLBACK_URL',
      envSuccess: 'PAYDUNYA_RETURN_URL',
      envCancel: 'PAYDUNYA_CANCEL_URL',
    };
  }
  return {
    webhook: '/webhook/paytech',
    success: '/paytech/success',
    cancel: '/paytech/cancel',
    envIpn: 'PAYTECH_IPN_URL',
    envSuccess: 'PAYTECH_SUCCESS_URL',
    envCancel: 'PAYTECH_CANCEL_URL',
  };
}

function autoDetectEnabled(gateway = activeGateway()) {
  if (String(process.env.PAYTECH_IPN_AUTO || 'true').toLowerCase() === 'false') return false;
  if (gateway === 'paydunya') return true;
  const env = String(process.env.PAYTECH_ENV || '').toLowerCase();
  return env !== 'prod';
}

async function lireBaseNgrok() {
  const response = await fetch(NGROK_API, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) return '';
  const data = await response.json();
  const tunnels = Array.isArray(data.tunnels) ? data.tunnels : [];
  const https = tunnels.find((t) => String(t.public_url || '').startsWith('https://'));
  const any = tunnels.find((t) => t.public_url);
  return stripSlash((https || any)?.public_url || '');
}

function persisterEnv(key, value) {
  if (!value || process.env[key] === value) return;
  process.env[key] = value;
  try {
    if (!fs.existsSync(ENV_PATH)) return;
    const raw = fs.readFileSync(ENV_PATH, 'utf8');
    const line = `${key}=${value}`;
    const next = raw.includes(`${key}=`)
      ? raw.replace(new RegExp(`^${key}=.*$`, 'm'), line)
      : `${raw.trimEnd()}\n${line}\n`;
    if (next !== raw) fs.writeFileSync(ENV_PATH, next, 'utf8');
  } catch {
    // Optionnel
  }
}

function publicBaseDepuisEnv() {
  const candidates = [
    process.env.PAYDUNYA_CALLBACK_URL,
    process.env.PAYTECH_IPN_URL,
  ];
  for (const raw of candidates) {
    const fromIpn = stripSlash(raw || '').replace(/\/webhook\/(paytech|paydunya)\/?$/, '');
    if (isPublicHttps(fromIpn)) return fromIpn;
  }
  return '';
}

function successQueryForKind(entityId, kind = 'reservation') {
  const id = Number(entityId || 0);
  if (kind === 'abonnement') return id > 0 ? `abonnement_id=${id}` : 'kind=abonnement';
  if (kind === 'achat') return id > 0 ? `terrain_id=${id}&kind=achat` : 'kind=achat';
  return id > 0 ? `id=${id}` : '';
}

/**
 * Les prestataires exigent des URLs HTTPS publiques (pas localhost).
 * En staging local : IPN + succès + annulation passent par le tunnel ngrok,
 * puis le backend redirige le navigateur vers APP_DOMAIN (frontend local).
 */
async function resoudreUrlsPaiement(reservationId, gateway = activeGateway(), options = {}) {
  const kind = options.kind || 'reservation';
  const resolvedGateway = gateway === 'paydunya' || gateway === 'paytech' ? gateway : activeGateway();
  const paths = cheminsGateway(resolvedGateway === 'paydunya' ? 'paydunya' : 'paytech');
  const domain = appDomain();
  let publicBase = '';

  if (autoDetectEnabled(resolvedGateway)) {
    try {
      publicBase = await lireBaseNgrok();
    } catch {
      publicBase = '';
    }
  }

  if (!publicBase) publicBase = publicBaseDepuisEnv();

  let ipnUrl;
  let successUrl;
  let cancelUrl;
  const successQs = successQueryForKind(reservationId, kind);

  if (publicBase && isPublicHttps(publicBase)) {
    ipnUrl = `${publicBase}${paths.webhook}`;
    successUrl = successQs
      ? `${publicBase}${paths.success}?${successQs}`
      : `${publicBase}${paths.success}`;
    cancelUrl = `${publicBase}${paths.cancel}`;
    persisterEnv(paths.envIpn, ipnUrl);
    persisterEnv(paths.envSuccess, `${publicBase}${paths.success}`);
    persisterEnv(paths.envCancel, cancelUrl);
  } else {
    ipnUrl = stripSlash(process.env[paths.envIpn] || '');
    const successBase = stripSlash(process.env[paths.envSuccess] || '');
    cancelUrl = stripSlash(process.env[paths.envCancel] || '');
    if (successBase && successQs) {
      successUrl = successBase.includes('?')
        ? `${successBase}&${successQs}`
        : `${successBase}?${successQs}`;
    } else {
      successUrl = successBase;
    }
  }

  if (!isPublicHttps(ipnUrl) || !isPublicHttps(successUrl) || !isPublicHttps(cancelUrl)) {
    const prestataire = resolvedGateway === 'paydunya' ? 'PayDunya' : 'PayTech';
    const error = new Error(
      `${prestataire} exige des URLs HTTPS publiques. Lance ngrok (ngrok http 3001) puis réessaie.`,
    );
    error.statusCode = 503;
    error.code = 'PAYTECH_PUBLIC_URL_REQUIRED';
    throw error;
  }

  return { ipnUrl, successUrl, cancelUrl, publicBase, frontendDomain: domain, gateway: resolvedGateway };
}

async function resoudreUrlsPaytech(reservationId) {
  return resoudreUrlsPaiement(reservationId, 'paytech');
}

async function resoudreIpnUrl() {
  const { ipnUrl } = await resoudreUrlsPaiement(0);
  return ipnUrl;
}

module.exports = {
  resoudreIpnUrl,
  resoudreUrlsPaiement,
  resoudreUrlsPaytech,
  lireBaseNgrok,
  isPublicHttps,
  appDomain,
};
