const { queryOne, runSql, transaction } = require('../database');
const paytechService = require('../paytechService');
const notificationService = require('../notificationService');
const logger = require('../logger');
const { libererCreneauxReservation, rowsModified } = require('../reservationLockService');

const DEFAULT_DELAI_HEURES = 24;

function normaliserDelaiHeures(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DELAI_HEURES;
  return Math.round(n);
}

function parseDateMs(value) {
  if (!value) return 0;
  const raw = String(value).trim();
  const date = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function confirmationMs(reservation, fallbackAt) {
  return (
    parseDateMs(reservation?.confirme_at) ||
    parseDateMs(fallbackAt) ||
    parseDateMs(reservation?.created_at)
  );
}

function evaluerRemboursement({ terrain, reservation, confirmeAt = null, now = Date.now() }) {
  const delaiHeures = normaliserDelaiHeures(terrain?.delai_remboursement_heures);
  const confirmee = ['confirme', 'acceptee'].includes(String(reservation?.statut || ''));
  if (!confirmee) {
    return {
      eligible: false,
      delai_heures: delaiHeures,
      raison: 'pas_confirmee',
      message: 'Pas de paiement confirmé à rembourser.',
    };
  }
  if (delaiHeures <= 0) {
    return {
      eligible: false,
      delai_heures: 0,
      raison: 'politique_sans_remboursement',
      message: "Ce terrain n'offre pas de remboursement en cas d'annulation.",
    };
  }
  const confirmedAt = confirmationMs(reservation, confirmeAt);
  const limite = confirmedAt + delaiHeures * 60 * 60 * 1000;
  const eligible = confirmedAt > 0 && now <= limite;
  return {
    eligible,
    delai_heures: delaiHeures,
    confirme_at: confirmedAt ? new Date(confirmedAt).toISOString() : null,
    limite_at: confirmedAt ? new Date(limite).toISOString() : null,
    raison: eligible ? 'dans_delai' : 'hors_delai',
    message: eligible
      ? `Le joueur sera remboursé (annulation dans les ${delaiHeures} h après confirmation) et recevra une notification WhatsApp.`
      : `Le délai de remboursement de ce terrain est dépassé (${delaiHeures} h après confirmation). L'annulation libère le créneau sans remboursement. Le joueur sera prévenu sur WhatsApp.`,
  };
}

function referencePaiementPaytech(reservation, payment) {
  return (
    payment?.reference_paytech ||
    reservation?.reference_paytech ||
    payment?.reference_externe ||
    null
  );
}

async function executerAnnulation(db, reservation, { traitePar = null } = {}) {
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [reservation.terrain_id]) || {};
  const payment = queryOne(
    db,
    `SELECT * FROM paiements
      WHERE reservation_id = ? AND statut = 'paye'
      ORDER BY id DESC LIMIT 1`,
    [reservation.id],
  );
  const politique = evaluerRemboursement({
    terrain,
    reservation,
    confirmeAt: reservation.confirme_at || payment?.created_at,
  });
  const ref = referencePaiementPaytech(reservation, payment);
  const methode = String(payment?.methode || '').toLowerCase();
  const shouldRefund = Boolean(politique.eligible && payment && ref && methode === 'paytech');

  transaction(db, () => {
    if (traitePar) {
      db.run(
        "UPDATE reservations SET statut = 'annule', traite_par = ? WHERE id = ? AND statut IN ('en_attente', 'confirme', 'acceptee')",
        [traitePar, reservation.id],
      );
    } else {
      db.run(
        "UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut IN ('en_attente', 'confirme', 'acceptee')",
        [reservation.id],
      );
    }
    if (rowsModified(db) !== 1) {
      const error = new Error('Réservation ne peut pas être annulée');
      error.statusCode = 400;
      throw error;
    }
    if (reservation.statut === 'en_attente') {
      libererCreneauxReservation(db, reservation, ['en_attente_paiement']);
    } else {
      libererCreneauxReservation(db, reservation, ['reserve', 'en_attente_paiement']);
    }
  });

  let rembourse = false;
  if (shouldRefund) {
    try {
      await paytechService.rembourser(ref);
      runSql(
        db,
        `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe, reference_paytech)
         VALUES (?, ?, 'paytech', 'rembourse', ?, ?)`,
        [
          reservation.id,
          Number(reservation.montant_avance || reservation.acompte || payment.montant || 0),
          ref,
          `${ref}-REFUND`,
        ],
      );
      rembourse = true;
    } catch (error) {
      logger.error('annulationService.js', 'Remboursement PayTech', error);
    }
  }

  await notificationService
    .envoyerAnnulation(reservation.id, { rembourse })
    .catch((error) => logger.error('annulationService.js', 'Notification annulation', error));

  return { rembourse, politique };
}

module.exports = {
  DEFAULT_DELAI_HEURES,
  normaliserDelaiHeures,
  evaluerRemboursement,
  executerAnnulation,
};
