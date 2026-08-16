const crypto = require('crypto');
const { getDb, queryOne, runSql } = require('./database');

const PAYTECH_URL = process.env.PAYTECH_API_URL || 'https://paytech.sn/api/payment/request-payment';
const MOCK_SECRET = 'terrainsn-paytech-local-mock';
const POURCENTAGE_AVANCE_DEFAUT = 8;

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

function calculerMontantAvance(prixChoisi, pourcentageAvance) {
  const montant = Number(prixChoisi || 0);
  if (!Number.isFinite(montant) || montant <= 0) return 0;
  const pct = Number(pourcentageAvance);
  const taux = Number.isFinite(pct) && pct > 0 ? pct : POURCENTAGE_AVANCE_DEFAUT;
  return Math.min(montant, Math.round((montant * taux) / 100));
}

/**
 * Crée un paiement PayTech (ou simulation) avec avance recalculée
 * depuis terrains.pourcentage_avance × prixChoisi.
 */
async function creerPaiement({ reservationId, terrainId, prixChoisi }) {
  const db = await getDb();
  const terrain = queryOne(
    db,
    'SELECT id, nom, pourcentage_avance FROM terrains WHERE id = ?',
    [terrainId]
  );
  if (!terrain) {
    const error = new Error('Terrain introuvable pour le paiement');
    error.statusCode = 404;
    throw error;
  }

  const prix = Number(prixChoisi || 0);
  const montantAvance = calculerMontantAvance(prix, terrain.pourcentage_avance);
  const montantRestant = Math.max(0, prix - montantAvance);

  // Synchroniser les colonnes réservation (sans renommer montant_acompte / acompte legacy)
  runSql(
    db,
    `UPDATE reservations SET
      montant_avance = ?,
      montant_restant = ?,
      acompte = ?,
      reste_a_payer = ?
     WHERE id = ?`,
    [montantAvance, montantRestant, montantAvance, montantRestant, reservationId]
  );

  const domain = (process.env.APP_DOMAIN || 'http://localhost:8080').replace(/\/$/, '');
  const refCommand = `TF-${reservationId}-${Date.now()}`;

  if (estModeMock() || paymentMode() === 'simulation') {
    const params = new URLSearchParams({
      id: String(reservationId),
      ref: refCommand,
      terrain: terrain.nom || '',
      montant: String(montantAvance),
      total: String(prix),
      reste: String(montantRestant),
    });
    return {
      success: true,
      redirectUrl: `${domain}/simulation/paiement?${params}`,
      redirect_url: `${domain}/simulation/paiement?${params}`,
      reference: refCommand,
      montantAvance,
      montantRestant,
    };
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
      item_name: `Avance réservation — ${terrain.nom}`,
      item_price: montantAvance,
      currency: 'XOF',
      ref_command: refCommand,
      command_name: `Réservation TerrainSN #${reservationId}`,
      env: process.env.NODE_ENV === 'production' ? 'prod' : (process.env.PAYTECH_ENV || 'test'),
      ipn_url: `${domain}/webhook/paytech`,
      success_url: `${domain}/reservation/succes?id=${reservationId}`,
      cancel_url: `${domain}/reservation/annule`,
      custom_field: JSON.stringify({ reservation_id: reservationId }),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (!payload.redirect_url && !payload.redirectUrl)) {
    throw new Error(payload.message || 'Impossible de créer le paiement PayTech');
  }

  const redirectUrl = payload.redirect_url || payload.redirectUrl;
  return {
    success: true,
    redirectUrl,
    redirect_url: redirectUrl,
    reference: payload.ref_command || refCommand,
    montantAvance,
    montantRestant,
  };
}

/** Compat : accepte l'objet réservation historique. */
async function creerLienPaiement(reservation) {
  const prixChoisi = Number(
    reservation.prix_total || reservation.montant || 0
  );
  return creerPaiement({
    reservationId: reservation.id,
    terrainId: reservation.terrain_id,
    prixChoisi,
  });
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

function verifierHash(refCommand, receivedHash) {
  const secret = secretSignature();
  if (!refCommand || !receivedHash || !secret) return false;
  const expected = crypto.createHash('sha256').update(`${refCommand}${secret}`).digest('hex');
  return timingSafeEqualHex(expected, receivedHash);
}

function signerReference(refCommand) {
  return crypto.createHash('sha256').update(`${refCommand}${secretSignature()}`).digest('hex');
}

function decoderCustomField(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  const text = String(raw);
  try {
    return JSON.parse(text);
  } catch {
    try {
      const decoded = Buffer.from(text, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch {
      return {};
    }
  }
}

function verifierIpnPaytech(payload = {}, headers = {}) {
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
    const amount = payload.final_item_price ?? payload.item_price ?? payload.item_price_xof;
    const refCommand = payload.ref_command || payload.refCommand;
    if (amount == null || !refCommand) return false;
    const message = `${amount}|${refCommand}|${apiKey}`;
    const expectedHmac = crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
    return timingSafeEqualHex(expectedHmac, hmacCompute);
  }

  const expectedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
  const expectedSecret = crypto.createHash('sha256').update(apiSecret).digest('hex');
  return (
    timingSafeEqualHex(expectedKey, payload.api_key_sha256)
    && timingSafeEqualHex(expectedSecret, payload.api_secret_sha256)
  );
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
    headers: {
      'Content-Type': 'application/json',
      API_KEY: process.env.PAYTECH_API_KEY,
      API_SECRET: process.env.PAYTECH_API_SECRET,
    },
    body: JSON.stringify({ ref_command: reference }),
  });
  if (!response.ok) throw new Error('Le remboursement PayTech a échoué');
}

module.exports = {
  creerPaiement,
  creerLienPaiement,
  calculerMontantAvance,
  verifierHash,
  verifierIpnPaytech,
  decoderCustomField,
  signerReference,
  rembourser,
  estModeMock,
  paymentMode,
};
