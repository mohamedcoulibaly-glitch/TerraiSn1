const crypto = require('crypto');
const { getDb, queryOne, runSql } = require('./database');
const { targetProvider, methodePaiement } = require('./lib/paymentGateway');
const { normalizeCanal } = require('./lib/paymentChannels');
const paymentService = require('./services/payment');

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

function calculerMontantAvance(prixChoisi, pourcentageAvance) {
  const montant = Number(prixChoisi || 0);
  if (!Number.isFinite(montant) || montant <= 0) return 0;
  const pct = Number(pourcentageAvance);
  const taux = Number.isFinite(pct) && pct > 0 ? pct : POURCENTAGE_AVANCE_DEFAUT;
  return Math.min(montant, Math.round((montant * taux) / 100));
}

/** Montant réellement envoyé à PayTech : avance > 0, sinon acompte legacy. */
function montantLienPaiement(reservation = {}) {
  const avance = Number(reservation.montant_avance);
  if (Number.isFinite(avance) && avance > 0) return avance;
  const acompte = Number(reservation.acompte ?? reservation.montant_acompte);
  if (Number.isFinite(acompte) && acompte > 0) return acompte;
  return 0;
}

/**
 * Enregistre un paiement en_attente dès la création du lien (cycle de vie traçable).
 * Remplace l'éventuel pending précédent pour la même réservation.
 */
function enregistrerPaiementPending(db, { reservationId, montant, reference, canal, provider }) {
  const methode =
    provider === 'paydunya' || provider === 'paytech' || provider === 'simulation'
      ? provider
      : methodePaiement();
  const canalNorm = normalizeCanal(canal);
  // Annule les pending précédents (relance lien) pour garder une seule ligne active.
  runSql(
    db,
    `UPDATE paiements SET statut = 'annule'
     WHERE reservation_id = ? AND statut = 'en_attente'`,
    [reservationId],
  );
  runSql(
    db,
    `INSERT INTO paiements
      (reservation_id, montant, methode, statut, reference_externe, reference_paytech, montant_acompte, canal_paiement)
     VALUES (?, ?, ?, 'en_attente', ?, ?, ?, ?)`,
    [reservationId, montant, methode, reference, reference, montant, canalNorm],
  );
  if (canalNorm) {
    runSql(db, 'UPDATE reservations SET canal_paiement = ? WHERE id = ?', [canalNorm, reservationId]);
  }
}

/**
 * Crée un paiement réservation joueur via le vrai prestataire
 * (PayTech / PayDunya) — plus de page /simulation/paiement côté joueur.
 */
async function creerPaiement({
  reservationId,
  terrainId,
  prixChoisi,
  montantAvance: montantAvanceOverride,
  montantRestant: montantRestantOverride,
  joueurNom,
  joueurTelephone,
  preferredChannel,
}) {
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
  const avanceCalculee = calculerMontantAvance(prix, terrain.pourcentage_avance);
  const montantAvance = Number(montantAvanceOverride) > 0
    ? Math.round(Number(montantAvanceOverride))
    : avanceCalculee;
  const montantRestant = Number.isFinite(Number(montantRestantOverride))
    ? Math.max(0, Math.round(Number(montantRestantOverride)))
    : Math.max(0, prix - montantAvance);
  const canal = normalizeCanal(preferredChannel);

  if (!(montantAvance > 0)) {
    const error = new Error('Montant d’avance invalide pour le paiement en ligne');
    error.statusCode = 400;
    throw error;
  }

  runSql(
    db,
    `UPDATE reservations SET
      montant_avance = ?,
      montant_restant = ?,
      acompte = ?,
      reste_a_payer = ?,
      canal_paiement = COALESCE(?, canal_paiement)
     WHERE id = ?`,
    [montantAvance, montantRestant, montantAvance, montantRestant, canal, reservationId]
  );

  const refCommand = `TF-${reservationId}-${Date.now()}`;

  let result;
  if (estModeMock() || paymentMode() === 'simulation') {
    const { joueurDomain } = require('./lib/appDomains');
    const domain = joueurDomain();
    const params = new URLSearchParams({
      kind: 'reservation',
      ref: refCommand,
      reservation_id: String(reservationId),
      montant: String(montantAvance),
      ...(canal ? { canal } : {}),
    });
    result = {
      success: true,
      redirectUrl: `${domain}/simulation/paiement?${params}`,
      redirect_url: `${domain}/simulation/paiement?${params}`,
      reference: refCommand,
      montantAvance,
      montantRestant,
      prix,
      provider: 'simulation',
      canal_paiement: canal,
      kind: 'reservation',
    };
  } else {
    result = await paymentService.createCheckout({
      reservationId,
      terrain,
      montantAvance,
      montantRestant,
      prix,
      refCommand,
      joueurNom,
      joueurTelephone,
      preferredChannel: canal,
      kind: 'reservation',
    });
    result.canal_paiement = canal;
    result.montantAvance = montantAvance;
    result.montantRestant = montantRestant;
  }

  enregistrerPaiementPending(db, {
    reservationId,
    montant: montantAvance,
    reference: result.reference || refCommand,
    canal,
    provider: result.provider || targetProvider(),
  });

  return result;
}

/** Compat : accepte l'objet réservation historique. */
async function creerLienPaiement(reservation, options = {}) {
  const prixChoisi = Number(
    reservation.prix_total || reservation.montant || 0
  );
  const avanceExistante = Number(reservation.montant_avance || reservation.acompte || 0);
  const resteExistant = Number(reservation.montant_restant ?? reservation.reste_a_payer);
  return creerPaiement({
    reservationId: reservation.id,
    terrainId: reservation.terrain_id,
    prixChoisi,
    montantAvance: avanceExistante > 0 ? avanceExistante : undefined,
    montantRestant: Number.isFinite(resteExistant) ? resteExistant : undefined,
    joueurNom: reservation.joueur_nom,
    joueurTelephone: reservation.joueur_telephone,
    preferredChannel: options.preferredChannel || reservation.canal_paiement || options.methode,
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
  // Délègue à l'adaptateur PayTech (HMAC-SHA256 / SHA256 clés) — cible prod.
  return paymentService.paytechAdapter.verifyWebhook(payload, headers);
}

async function rembourser(reference, options = {}) {
  if (estModeMock()) {
    console.log(`[PAYTECH MOCK] Remboursement simulé : ${reference}`);
    return { success: true, mock: true, reference };
  }
  const raw = String(options.provider || options.methode || '').toLowerCase();
  const provider = raw === 'paydunya' || raw === 'paytech' ? raw : undefined;
  return paymentService.getAdapter(provider).refund(reference);
}

function payoutEnabled() {
  if (estModeMock()) return true;
  return paymentService.getAdapter().isPayoutEnabled();
}

/**
 * Sortie d'argent vers le Wave / OM du gérant (compte TerrainSN uniquement).
 * Mock : succès simulé. Prod PayTech : PAYTECH_PAYOUT_ENABLED=true.
 * Sandbox PayDunya : PAYDUNYA_PAYOUT_ENABLED=true.
 */
async function ordonnerPayout({ numero, montant, canal, reservationId, motif = 'reversement_gerant' }) {
  const amount = Math.round(Number(montant || 0));
  if (!numero || amount <= 0) {
    const error = new Error('Payout invalide : numéro ou montant manquant');
    error.code = 'PAYOUT_INVALID';
    throw error;
  }
  if (estModeMock()) {
    const ref = `PO-MOCK-${reservationId || 'x'}-${Date.now()}`;
    console.log(`[PAYTECH MOCK] Payout ${amount} FCFA via ${canal || 'wave'} vers ${numero} (${motif}) ref=${ref}`);
    return { success: true, mock: true, ref_paytech: ref, reference: ref, canal, numero, montant: amount };
  }
  return paymentService.getAdapter().payout({
    numero,
    montant: amount,
    canal,
    reservationId,
    motif,
  });
}

/**
 * Lien de paiement pour solde de dette commission gérant (hors réservation joueur).
 * Référence : DETTE-{gerantId}-{periode}-{timestamp}
 */
async function creerLienPaiementDette({
  gerantId,
  terrainId,
  periode,
  montant,
  gerantNom,
  gerantTelephone,
  preferredChannel,
}) {
  const amount = Math.round(Number(montant || 0));
  if (!(amount > 0)) {
    const error = new Error('Montant de dette invalide');
    error.statusCode = 400;
    throw error;
  }
  const canal = normalizeCanal(preferredChannel);
  const { proDomain } = require('./lib/appDomains');
  const domain = proDomain();
  const periodeSafe = String(periode || '').replace(/[^\d-]/g, '').slice(0, 7);
  const refCommand = `DETTE-${Number(gerantId)}-${periodeSafe}-${Date.now()}`;

  let result;
  if (estModeMock() || paymentMode() === 'simulation') {
    const params = new URLSearchParams({
      kind: 'dette',
      ref: refCommand,
      gerant_id: String(gerantId),
      periode: periodeSafe,
      montant: String(amount),
      ...(terrainId ? { terrain_id: String(terrainId) } : {}),
      ...(canal ? { canal } : {}),
    });
    result = {
      success: true,
      redirectUrl: `${domain}/simulation/paiement?${params}`,
      redirect_url: `${domain}/simulation/paiement?${params}`,
      reference: refCommand,
      montant: amount,
      provider: 'simulation',
      canal_paiement: canal,
      kind: 'dette',
    };
  } else {
    result = await paymentService.createCheckout({
      // entityId pour les query success (gerant_id) — pas une réservation
      reservationId: Number(gerantId),
      terrain: { id: terrainId, nom: `Dette commission ${periodeSafe}` },
      montantAvance: amount,
      montantRestant: 0,
      prix: amount,
      refCommand,
      joueurNom: gerantNom || 'Gerant',
      joueurTelephone: gerantTelephone || '',
      preferredChannel: canal,
      kind: 'dette',
      itemName: `Dette commission — ${periodeSafe}`,
      commandName: `Solde dette TerrainSN gérant #${gerantId} (${periodeSafe})`,
      customField: {
        kind: 'dette',
        gerant_id: Number(gerantId),
        periode: periodeSafe,
        terrain_id: terrainId ? Number(terrainId) : null,
        montant: amount,
      },
    });
    result.canal_paiement = canal;
    result.kind = 'dette';
    result.montant = amount;
  }

  return result;
}

module.exports = {
  creerPaiement,
  creerLienPaiement,
  creerLienPaiementDette,
  calculerMontantAvance,
  montantLienPaiement,
  verifierHash,
  verifierIpnPaytech,
  decoderCustomField,
  signerReference,
  rembourser,
  ordonnerPayout,
  payoutEnabled,
  estModeMock,
  paymentMode,
  /** Exposition pour healthcheck / bascule provider */
  getPaymentAdapter: () => paymentService.getAdapter(),
  describePayment: () => paymentService.describe(),
  targetProvider,
  methodePaiement,
};
