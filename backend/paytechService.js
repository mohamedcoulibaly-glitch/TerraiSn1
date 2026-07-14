const crypto = require('crypto');

const PAYTECH_URL = process.env.PAYTECH_API_URL || 'https://paytech.sn/api/payment/request-payment';
const MOCK_SECRET = 'terrainsn-paytech-local-mock';

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

function assertConfigured() {
  if (!process.env.PAYTECH_API_KEY || !process.env.PAYTECH_API_SECRET) {
    const error = new Error('PayTech n\'est pas configuré');
    error.statusCode = 503;
    throw error;
  }
}

async function creerLienPaiement(reservation) {
  const domain = (process.env.APP_DOMAIN || 'http://localhost:8080').replace(/\/$/, '');
  const refCommand = `TF-${reservation.id}-${Date.now()}`;
  if (estModeMock()) {
    const params = new URLSearchParams({
      id: String(reservation.id),
      ref: refCommand,
      terrain: reservation.terrain_nom || '',
      montant: String(reservation.acompte),
      total: String(reservation.prix_total || reservation.montant),
      reste: String(reservation.reste_a_payer || 0),
    });
    return { redirectUrl: `${domain}/simulation/paiement?${params}`, reference: refCommand };
  }
  assertConfigured();
  const response = await fetch(PAYTECH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      API_KEY: process.env.PAYTECH_API_KEY,
      API_SECRET: process.env.PAYTECH_API_SECRET,
    },
    body: JSON.stringify({
      item_name: `Réservation ${reservation.terrain_nom}`,
      item_price: Number(reservation.acompte),
      currency: 'XOF',
      ref_command: refCommand,
      command_name: `Réservation TerrainSN #${reservation.id}`,
      env: process.env.PAYTECH_ENV || 'prod',
      ipn_url: `${domain}/webhook/paytech`,
      success_url: `${domain}/reservation/succes?id=${reservation.id}`,
      cancel_url: `${domain}/reservation/annule?terrain_id=${reservation.terrain_id}`,
      custom_field: JSON.stringify({ reservation_id: reservation.id }),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (!payload.redirect_url && !payload.redirectUrl)) {
    throw new Error(payload.message || 'Impossible de créer le paiement PayTech');
  }
  return { redirectUrl: payload.redirect_url || payload.redirectUrl, reference: payload.ref_command || refCommand };
}

function verifierHash(refCommand, receivedHash) {
  const secret = secretSignature();
  if (!refCommand || !receivedHash || !secret) return false;
  const expected = crypto.createHash('sha256').update(`${refCommand}${secret}`).digest('hex');
  const received = String(receivedHash).trim().toLowerCase();
  return expected.length === received.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

function signerReference(refCommand) {
  return crypto.createHash('sha256').update(`${refCommand}${secretSignature()}`).digest('hex');
}

async function rembourser(reference) {
  if (estModeMock()) {
    console.log(`[PAYTECH MOCK] Remboursement simulé : ${reference}`);
    return;
  }
  assertConfigured();
  const url = process.env.PAYTECH_REFUND_URL || 'https://paytech.sn/api/payment/refund-payment';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', API_KEY: process.env.PAYTECH_API_KEY, API_SECRET: process.env.PAYTECH_API_SECRET },
    body: JSON.stringify({ ref_command: reference }),
  });
  if (!response.ok) throw new Error('Le remboursement PayTech a échoué');
}

module.exports = { creerLienPaiement, verifierHash, signerReference, rembourser, estModeMock, paymentMode };
