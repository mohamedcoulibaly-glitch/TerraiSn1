const { queryOne, runSql, transaction, rowsModified } = require('../database');
const paytechService = require('../paytechService');
const notificationService = require('../notificationService');
const logger = require('../logger');
const { libererCreneauxReservation } = require('../reservationLockService');

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
      type_annulation: 'sans_remboursement',
      titre: 'Annulation sans remboursement',
      delai_heures: delaiHeures,
      raison: 'pas_confirmee',
      message:
        "Aucune avance n'a encore été payée. Le créneau sera libéré immédiatement. Une notification WhatsApp sera envoyée.",
    };
  }
  if (delaiHeures <= 0) {
    return {
      eligible: false,
      type_annulation: 'sans_remboursement',
      titre: 'Annulation sans remboursement',
      delai_heures: 0,
      raison: 'politique_sans_remboursement',
      message:
        "Ce terrain n'autorise pas de remboursement. L'annulation libère le créneau sans rembourser l'avance. Une notification WhatsApp sera envoyée.",
    };
  }
  const confirmedAt = confirmationMs(reservation, confirmeAt);
  const limite = confirmedAt + delaiHeures * 60 * 60 * 1000;
  const eligible = confirmedAt > 0 && now <= limite;
  if (eligible) {
    return {
      eligible: true,
      type_annulation: 'avec_remboursement',
      titre: 'Annulation avec remboursement',
      delai_heures: delaiHeures,
      confirme_at: confirmedAt ? new Date(confirmedAt).toISOString() : null,
      limite_at: confirmedAt ? new Date(limite).toISOString() : null,
      raison: 'dans_delai',
      message: `Annulation dans le délai de ${delaiHeures} h après confirmation : l'avance sera remboursée. Une notification WhatsApp confirmera l'annulation.`,
    };
  }
  return {
    eligible: false,
    type_annulation: 'sans_remboursement',
    titre: 'Annulation sans remboursement (délai dépassé)',
    delai_heures: delaiHeures,
    confirme_at: confirmedAt ? new Date(confirmedAt).toISOString() : null,
    limite_at: confirmedAt ? new Date(limite).toISOString() : null,
    raison: 'hors_delai',
    message: `Le délai de remboursement (${delaiHeures} h après confirmation) est dépassé. L'annulation libère le créneau sans remboursement. Une notification WhatsApp sera envoyée.`,
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
  const terrain = (await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [reservation.terrain_id])) || {};
  const payment = await queryOne(
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

  await transaction(db, async () => {
    let upd;
    if (traitePar) {
      upd = await runSql(
        db,
        "UPDATE reservations SET statut = 'annule', traite_par = ? WHERE id = ? AND statut IN ('en_attente', 'confirme', 'acceptee')",
        [traitePar, reservation.id],
      );
    } else {
      upd = await runSql(
        db,
        "UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut IN ('en_attente', 'confirme', 'acceptee')",
        [reservation.id],
      );
    }
    const changed = Number(upd?.changes || 0) || rowsModified(db);
    if (changed !== 1) {
      const error = new Error('Réservation ne peut pas être annulée');
      error.statusCode = 400;
      throw error;
    }
    // Libère toujours le créneau (y compris pendant la fenêtre de validation).
    await libererCreneauxReservation(db, reservation, ['en_attente_paiement', 'reserve'], {
      force: true,
    });
  });

  let rembourse = false;
  if (shouldRefund) {
    try {
      await paytechService.rembourser(ref);
      await runSql(
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
    .envoyerAnnulation(reservation.id, {
      rembourse,
      politique,
      traiteParGerant: Boolean(traitePar),
    })
    .catch((error) => logger.error('annulationService.js', 'Notification annulation', error));

  return { rembourse, politique };
}

module.exports = {
  DEFAULT_DELAI_HEURES,
  normaliserDelaiHeures,
  evaluerRemboursement,
  executerAnnulation,
};
