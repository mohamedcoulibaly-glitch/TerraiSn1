const crypto = require('crypto');
const { getDb, queryOne, runSql, transaction } = require('../database');
const paytechService = require('../paytechService');
const notificationService = require('../notificationService');
const pushService = require('../pushService');
const logger = require('../logger');
const { calculerFenetreCheckIn } = require('../services/checkInFenetre');
const { serializeQrPayload } = require('../services/qrPayload');
const {
  libererCreneauxReservation,
  confirmerCreneauxReservation,
  rowsModified,
} = require('../reservationLockService');
const { calculerMontantAvance, calculerCommissionPrelevee } = require('../pricingService');
const { crediterPortefeuilleGerant } = require('../services/portefeuilleService');

function genererCodeReservation(db) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = `TF-${Math.floor(100000 + Math.random() * 900000)}`;
    if (!queryOne(db, 'SELECT id FROM reservations WHERE code_reservation = ?', [code])) return code;
  }
  throw new Error('Impossible de générer un code de réservation unique');
}

function reservationIdDepuisReference(refCommand) {
  const match = String(refCommand || '').match(/^TF-(\d+)-/);
  return match ? Number(match[1]) : 0;
}

async function traiterConfirmationPaytech(db, reservationId, refCommand) {
  let action = 'ignore';
  let reversementInfo = null;

  transaction(db, () => {
    const currentReservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (!currentReservation) return;

    const existingPaidPayment = queryOne(db, "SELECT id FROM paiements WHERE reservation_id = ? AND statut = 'paye' AND methode = 'paytech' LIMIT 1", [reservationId]);
    const existingByRef = refCommand
      ? queryOne(db, 'SELECT id FROM paiements WHERE reference_paytech = ? LIMIT 1', [refCommand])
      : null;
    const existingReversement = queryOne(db, 'SELECT id FROM reversements WHERE reservation_id = ? LIMIT 1', [reservationId]);
    if (currentReservation.statut === 'confirme' || existingPaidPayment || existingByRef || existingReversement) {
      action = 'already_confirmed';
      return;
    }

    db.run(
      "UPDATE reservations SET statut = 'confirme' WHERE id = ? AND statut = 'en_attente'",
      [reservationId],
    );
    if (rowsModified(db) !== 1) {
      action = 'already_confirmed';
      return;
    }

    const confirmedCount = confirmerCreneauxReservation(db, currentReservation);
    if (confirmedCount < 1) {
      libererCreneauxReservation(db, currentReservation, ['en_attente_paiement']);
      db.run("UPDATE reservations SET statut = 'en_attente' WHERE id = ?", [reservationId]);
      action = 'refund';
      return;
    }

    const terrain = queryOne(db, `SELECT t.id AS terrain_id, t.acompte, t.montant_acompte, t.commission,
        t.pourcentage_avance, t.modele_revenus, t.commission_pourcentage,
        e.id AS gerant_id, e.telephone AS gerant_tel, e.whatsapp_number AS gerant_whatsapp, e.nom AS gerant_nom
        FROM terrains t
        LEFT JOIN employes e ON e.terrain_id = t.id AND e.is_active = 1
        WHERE t.id = ?
        ORDER BY e.id ASC
        LIMIT 1`, [currentReservation.terrain_id]);
    const montantAvance = Number(currentReservation.montant_avance || currentReservation.acompte || calculerMontantAvance(terrain, currentReservation.prix_total || currentReservation.montant));
    const montantCommission = calculerCommissionPrelevee(terrain, montantAvance);
    const montantReverse = Math.max(0, montantAvance - montantCommission);
    const code = genererCodeReservation(db);
    const retardRow = currentReservation.creneau_id
      ? queryOne(db, 'SELECT fenetre_retard FROM creneaux WHERE id = ?', [currentReservation.creneau_id])
      : null;
    const fenetre = calculerFenetreCheckIn({
      date: currentReservation.date,
      heure_debut: currentReservation.heure_debut,
      heure_fin: currentReservation.heure_fin,
      fenetre_retard: retardRow?.fenetre_retard,
    });
    const qrPayload = serializeQrPayload({
      reservation_id: reservationId,
      code,
      creneau_id: currentReservation.creneau_id,
      terrain_id: currentReservation.terrain_id,
      expire_at: Math.floor(fenetre.finFenetre / 1000),
    });

    db.run(
      `UPDATE reservations SET code_reservation = ?, qr_code_payload = ?, acompte = ?, montant_avance = ?,
        reste_a_payer = MAX(0, COALESCE(prix_total, montant, 0) - ?),
        montant_restant = MAX(0, COALESCE(prix_total, montant, 0) - ?)
       WHERE id = ?`,
      [code, qrPayload, montantAvance, montantAvance, montantAvance, montantAvance, reservationId],
    );

    db.run(`INSERT INTO paiements
        (reservation_id, montant, methode, statut, reference_externe, reference_paytech, montant_acompte, montant_commission, montant_reverse, statut_reversement)
        VALUES (?, ?, 'paytech', 'paye', ?, ?, ?, ?, ?, ?)`,
      [reservationId, montantAvance, refCommand, refCommand, montantAvance, montantCommission, montantReverse, terrain?.gerant_id ? 'effectue' : 'en_attente']);

    if (terrain?.gerant_id) {
      const wallet = crediterPortefeuilleGerant(db, {
        gerantId: terrain.gerant_id,
        terrainId: terrain.terrain_id,
        reservationId,
        montantEncaisse: montantAvance,
        montantCommission,
      });
      reversementInfo = {
        telephone: terrain.gerant_whatsapp || terrain.gerant_tel,
        nom: terrain.gerant_nom,
        gerant_id: terrain.gerant_id,
        montant_avance: montantAvance,
        montant_commission: montantCommission,
        montant_reverse: montantReverse,
        reservationId,
        solde_disponible: wallet.solde_disponible,
      };
    }
    action = 'confirm';
  });

  return { action, reversementInfo };
}

async function confirmerPaiementEtNotifier(reservationId, refCommand) {
  const db = await getDb();
  const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  if (!reservation) return { action: 'missing' };

  const { action, reversementInfo } = await traiterConfirmationPaytech(db, reservationId, refCommand);
  if (action === 'confirm') {
    await notificationService.envoyerConfirmation(reservationId).catch((error) => {
      logger.error('payments/flow.js', 'Notification confirmation', error);
    });
    await pushService.envoyerConfirmationPush(reservationId).catch((error) => {
      logger.error('payments/flow.js', 'Push confirmation', error);
    });
    if (reversementInfo) {
      await notificationService.envoyerReversement(reversementInfo).catch((error) => {
        logger.error('payments/flow.js', 'Notification reversement', error);
      });
    }
  } else if (action === 'refund') {
    await paytechService.rembourser(refCommand);
    transaction(db, () => {
      const row = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
      db.run("UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut IN ('en_attente', 'confirme')", [reservationId]);
      if (row) libererCreneauxReservation(db, row, ['en_attente_paiement', 'reserve']);
      db.run(`INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe, reference_paytech)
        VALUES (?, ?, 'paytech', 'rembourse', ?, ?)`, [reservationId, reservation.acompte, refCommand, `${refCommand}-REFUND`]);
    });
    await notificationService.envoyerRemboursement(reservationId).catch((error) => {
      logger.error('payments/flow.js', 'Notification remboursement', error);
    });
  }
  return { action };
}

async function annulerReservationApresAnnulationPaytech(reservationId, refCommand) {
  const db = await getDb();
  const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  if (!reservation) return { action: 'missing' };
  if (reservation.statut !== 'en_attente') return { action: 'ignore' };

  transaction(db, () => {
    db.run("UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut = 'en_attente'", [reservationId]);
    if (rowsModified(db) === 1) {
      libererCreneauxReservation(db, reservation, ['en_attente_paiement']);
      db.run(
        `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe, reference_paytech)
         VALUES (?, ?, 'paytech', 'annule', ?, ?)`,
        [reservationId, reservation.montant_avance || reservation.acompte || 0, refCommand, `${refCommand}-CANCEL`],
      );
    }
  });
  return { action: 'canceled' };
}

function resoudreReservationDepuisIpn(db, payload) {
  const custom = paytechService.decoderCustomField(payload.custom_field);
  const refCommand = payload.ref_command || payload.refCommand;
  let reservationId = Number(custom.reservation_id || payload.reservation_id || reservationIdDepuisReference(refCommand));

  if (!reservationId && refCommand) {
    const byRef = queryOne(db, 'SELECT id FROM reservations WHERE reference_paytech = ? LIMIT 1', [refCommand]);
    reservationId = Number(byRef?.id || 0);
  }

  const reservation = reservationId
    ? queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId])
    : null;

  return { reservationId: Number(reservation?.id || reservationId || 0), reservation, refCommand, custom };
}

function montantIpnCoherent(reservation, payload) {
  if (!reservation) return false;
  const attendu = Number(reservation.montant_avance || reservation.acompte || 0);
  const recu = Number(
    payload.final_item_price
      ?? payload.item_price_xof
      ?? payload.item_price
      ?? NaN,
  );
  if (!Number.isFinite(attendu) || !Number.isFinite(recu)) return false;
  return Math.round(attendu) === Math.round(recu);
}

async function handlePaytechIpn(payload, headers) {
  if (!paytechService.verifierIpnPaytech(payload, headers)) {
    const error = new Error('Signature PayTech invalide');
    error.statusCode = 400;
    throw error;
  }

  const typeEvent = String(payload.type_event || payload.typeEvent || 'sale_complete').toLowerCase();
  const db = await getDb();
  const { reservationId, reservation, refCommand } = resoudreReservationDepuisIpn(db, payload);
  if (!reservationId || !refCommand) {
    return { received: true, ignored: true, reason: 'reservation_introuvable' };
  }

  if (typeEvent === 'sale_canceled') {
    await annulerReservationApresAnnulationPaytech(reservationId, refCommand);
    return { received: true, event: typeEvent };
  }

  if (typeEvent !== 'sale_complete') {
    return { received: true, ignored: true, event: typeEvent };
  }

  if (reservation && !montantIpnCoherent(reservation, payload)) {
    logger.error('payments/flow.js', 'IPN PayTech montant incoherent', {
      reservationId,
      attendu: reservation.montant_avance || reservation.acompte,
      recu: payload.final_item_price ?? payload.item_price,
      refCommand,
    });
    return { received: true, ignored: true, reason: 'montant_incoherent' };
  }

  await confirmerPaiementEtNotifier(reservationId, refCommand);
  return { received: true, event: typeEvent };
}

module.exports = {
  genererCodeReservation,
  reservationIdDepuisReference,
  traiterConfirmationPaytech,
  confirmerPaiementEtNotifier,
  annulerReservationApresAnnulationPaytech,
  resoudreReservationDepuisIpn,
  montantIpnCoherent,
  handlePaytechIpn,
};
