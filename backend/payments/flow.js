const { getDb, queryOne, transaction } = require('../database');
const paytechService = require('../paytechService');
const paydunyaService = require('../paydunyaService');
const paymentService = require('../services/payment');
const { METHODES_EN_LIGNE_SQL, methodePaiement } = require('../lib/paymentGateway');
const {
  kindFromReference,
  abonnementIdDepuisReference,
  terrainIdDepuisReferenceAchat,
  gerantIdDepuisReferenceDette,
  periodeDepuisReferenceDette,
  normalizeCanal,
} = require('../lib/paymentChannels');
const detteCommissionService = require('../services/detteCommissionService');
const notificationService = require('../notificationService');
const pushService = require('../pushService');
const logger = require('../logger');
const { calculerFenetreCheckIn } = require('../services/checkInFenetre');
const { signQrPayload } = require('../domain/qrSignature');
const { peutConfirmer } = require('../domain/reservationState');
const { gerantDeepLink } = require('../lib/gerantDeepLink');
const {
  libererCreneauxReservation,
  confirmerCreneauxReservation,
  rowsModified,
} = require('../reservationLockService');
const { calculerMontantAvance, calculerCommissionPrelevee } = require('../pricingService');
const { appliquerApresPayin, tenterAutoSiPayable } = require('../services/payoutEngine');
const { chargerContrat } = require('../services/contratService');
const {
  marquerAbonnementPaye,
  marquerAchatDefinitifPaye,
} = require('../revenueModelService');

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

/**
 * Passe un paiement pending → paye, ou crée la ligne si absente (IPN hors pending).
 */
function finaliserLignePaiement(db, {
  reservationId,
  refCommand,
  montantAvance,
  montantCommission,
  methodePay,
  canal,
}) {
  const pending = queryOne(
    db,
    `SELECT id FROM paiements
     WHERE reservation_id = ? AND statut = 'en_attente'
       AND (reference_paytech = ? OR reference_externe = ?)
     LIMIT 1`,
    [reservationId, refCommand, refCommand],
  );
  if (pending) {
    db.run(
      `UPDATE paiements SET
        statut = 'paye',
        methode = ?,
        montant = ?,
        montant_acompte = ?,
        montant_commission = ?,
        montant_reverse = 0,
        statut_reversement = 'en_attente',
        reference_externe = ?,
        reference_paytech = ?,
        canal_paiement = COALESCE(?, canal_paiement)
       WHERE id = ?`,
      [methodePay, montantAvance, montantAvance, montantCommission, refCommand, refCommand, canal || null, pending.id],
    );
    return;
  }
  db.run(
    `INSERT INTO paiements
      (reservation_id, montant, methode, statut, reference_externe, reference_paytech, montant_acompte, montant_commission, montant_reverse, statut_reversement, canal_paiement)
      VALUES (?, ?, ?, 'paye', ?, ?, ?, ?, 0, 'en_attente', ?)`,
    [reservationId, montantAvance, methodePay, refCommand, refCommand, montantAvance, montantCommission, canal || null],
  );
}

async function traiterConfirmationPaytech(db, reservationId, refCommand, options = {}) {
  let action = 'ignore';
  let ledgerInfo = null;
  const methodePay = options.methode || methodePaiement();
  const canal = normalizeCanal(options.canal);

  transaction(db, () => {
    const currentReservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (!currentReservation) return;

    const existingPaidPayment = queryOne(db, `SELECT id FROM paiements WHERE reservation_id = ? AND statut = 'paye' AND ${METHODES_EN_LIGNE_SQL} LIMIT 1`, [reservationId]);
    const existingByRef = refCommand
      ? queryOne(db, "SELECT id FROM paiements WHERE reference_paytech = ? AND statut = 'paye' LIMIT 1", [refCommand])
      : null;
    // Un dû orphelin ne doit PAS bloquer une confirmation manquante (IPN retardé).
    if (currentReservation.statut === 'confirme' || existingPaidPayment || existingByRef) {
      action = 'already_confirmed';
      return;
    }
    if (!peutConfirmer(currentReservation.statut)) {
      action = 'ignore';
      return;
    }

    const confirmeAt = new Date().toISOString();
    db.run(
      `UPDATE reservations SET statut = 'confirme', confirme_at = COALESCE(confirme_at, ?)
       WHERE id = ? AND statut IN ('en_attente', 'en_attente_paiement')`,
      [confirmeAt, reservationId],
    );
    if (rowsModified(db) !== 1) {
      action = 'already_confirmed';
      return;
    }

    const confirmedCount = confirmerCreneauxReservation(db, currentReservation);
    if (confirmedCount < 1) {
      libererCreneauxReservation(db, currentReservation, ['en_attente_paiement']);
      db.run("UPDATE reservations SET statut = 'en_attente', confirme_at = NULL WHERE id = ?", [reservationId]);
      action = 'refund';
      return;
    }

    const contrat = chargerContrat(db, currentReservation.terrain_id);
    const montantAvance = Number(currentReservation.montant_avance || currentReservation.acompte || calculerMontantAvance(contrat, currentReservation.prix_total || currentReservation.montant));
    const montantCommission = calculerCommissionPrelevee(contrat, montantAvance);
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
    const qrPayload = signQrPayload({
      reservation_id: reservationId,
      code,
      creneau_id: currentReservation.creneau_id,
      terrain_id: currentReservation.terrain_id,
      expire_at: Math.floor(fenetre.finFenetre / 1000),
    });

    db.run(
      `UPDATE reservations SET code_reservation = ?, qr_code_payload = ?, acompte = ?, montant_avance = ?,
        reste_a_payer = MAX(0, COALESCE(prix_total, montant, 0) - ?),
        montant_restant = MAX(0, COALESCE(prix_total, montant, 0) - ?),
        confirme_at = COALESCE(confirme_at, ?),
        operational_stage = 'reserved'
       WHERE id = ?`,
      [code, qrPayload, montantAvance, montantAvance, montantAvance, montantAvance, confirmeAt, reservationId],
    );

    finaliserLignePaiement(db, {
      reservationId,
      refCommand,
      montantAvance,
      montantCommission,
      methodePay,
      canal: canal || currentReservation.canal_paiement,
    });

    const reservationConfirmee = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
    ledgerInfo = appliquerApresPayin(db, { reservation: reservationConfirmee });
    action = 'confirm';
  });

  return { action, ledgerInfo };
}

function portsParDefaut(db) {
  const realtimeHub = require('../realtimeHub');
  return {
    async confirmationJoueur(reservationId) {
      await notificationService.envoyerConfirmation(reservationId);
    },
    async pushJoueur(reservationId) {
      await pushService.envoyerConfirmationPush(reservationId);
    },
    async pushGerant(reservation) {
      const terrain = queryOne(db, 'SELECT gerant_id FROM terrains WHERE id = ?', [reservation.terrain_id]);
      if (!terrain?.gerant_id) return;
      await pushService.notifyAccount({
        userId: terrain.gerant_id,
        accountType: 'employe',
        url: gerantDeepLink(),
        title: 'Réservation confirmée',
        body: `Code ${reservation.code_reservation || reservation.id}`,
        type: 'reservation_confirmee',
        tag: `resa-confirmee-${reservation.id}`,
      });
    },
    publish(terrainId, type, payload) {
      realtimeHub.notifyTerrain(terrainId, type, payload);
    },
  };
}

async function confirmerPaiementEtNotifier(reservationId, refCommand, options = {}) {
  const db = await getDb();
  const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  if (!reservation) {
    logger.event('payin_ignore', { reservationId, reason: 'missing' });
    return { action: 'missing' };
  }

  const ports = options.ports || portsParDefaut(db);
  const { action, ledgerInfo } = await traiterConfirmationPaytech(db, reservationId, refCommand, options);
  try {
    const paymentEvents = require('../services/paymentEvents');
    paymentEvents.push(action === 'confirm' ? 'payin_confirm' : `payin_${action}`, {
      reservationId,
      refCommand,
      action,
    });
  } catch {
    /* ignore */
  }
  if (action === 'confirm') {
    logger.event('payin_confirm', { reservationId, refCommand });
    const fraiche = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
    await ports.confirmationJoueur(reservationId).catch(async (error) => {
      logger.error('payments/flow.js', 'Notification confirmation', error);
      try {
        const retryQueue = require('../services/notificationRetryQueue');
        await retryQueue.enfiler({
          telephone: fraiche?.joueur_telephone || reservation.joueur_telephone || '221000000000',
          message: `confirmation:${reservationId}`,
          type: 'confirmation',
          destinataire_type: 'joueur',
          destinataire_id: fraiche?.joueur_id || reservation.joueur_id || 0,
          erreur: error.message || String(error),
          idempotency_key: `confirmation:${reservationId}`,
        });
      } catch (queueError) {
        logger.error('payments/flow.js', 'File retry confirmation', queueError);
      }
    });
    await ports.pushJoueur(reservationId).catch((error) => {
      logger.error('payments/flow.js', 'Push confirmation', error);
    });
    if (typeof ports.publish === 'function') {
      ports.publish(reservation.terrain_id, 'reservation_confirmee', {
        reservation_id: reservationId,
        code: fraiche?.code_reservation || null,
        statut: 'confirme',
      });
    }
    if (typeof ports.pushGerant === 'function') {
      await ports.pushGerant(fraiche || reservation).catch((error) => {
        logger.error('payments/flow.js', 'Push gérant', error);
      });
    }
    if (ledgerInfo?.du && ledgerInfo?.contrat) {
      await notificationService.envoyerDuAccumuleGerant({
        contrat: ledgerInfo.contrat,
        du: ledgerInfo.du,
        reservationId,
      }).catch((error) => {
        logger.error('payments/flow.js', 'Notification dû gérant', error);
      });
      const auto = await tenterAutoSiPayable(db, {
        du: ledgerInfo.du,
        contrat: ledgerInfo.contrat,
      }).catch((error) => {
        logger.error('payments/flow.js', 'Payout auto après payin', error);
        return null;
      });
      if (auto?.ok) {
        await notificationService.envoyerPayoutAutoOk({
          contrat: ledgerInfo.contrat,
          du: auto.du,
          dest: auto.dest,
        }).catch((error) => logger.error('payments/flow.js', 'Notif payout auto OK', error));
      } else if (auto?.attempted && auto?.raison === 'paytech_echec') {
        await notificationService.envoyerEchecPayout({
          contrat: ledgerInfo.contrat,
          du: auto.du,
          raison: auto.error,
        }).catch((error) => logger.error('payments/flow.js', 'Notif payout auto échec', error));
      } else if (!ledgerInfo.contrat.canal_verifie && Number(ledgerInfo.du.du_gerant) > 0) {
        await notificationService.envoyerAlerteNumeroManquant(ledgerInfo.contrat).catch((error) => {
          logger.error('payments/flow.js', 'Alerte numéro manquant', error);
        });
      }
    }
  } else if (action === 'already_confirmed') {
    logger.event('payin_ignore', { reservationId, reason: 'already_confirmed' });
  } else if (action === 'ignore') {
    logger.event('payin_ignore', { reservationId, reason: 'ignore' });
  } else if (action === 'refund') {
    await paytechService.rembourser(refCommand);
    transaction(db, () => {
      const row = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
      db.run("UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut IN ('en_attente', 'en_attente_paiement', 'confirme')", [reservationId]);
      if (row) libererCreneauxReservation(db, row, ['en_attente_paiement', 'reserve']);
      const pending = queryOne(
        db,
        `SELECT id FROM paiements WHERE reservation_id = ? AND statut = 'en_attente' AND (reference_paytech = ? OR reference_externe = ?) LIMIT 1`,
        [reservationId, refCommand, refCommand],
      );
      if (pending) {
        db.run("UPDATE paiements SET statut = 'rembourse', reference_paytech = ? WHERE id = ?", [`${refCommand}-REFUND`, pending.id]);
      } else {
        db.run(`INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe, reference_paytech)
          VALUES (?, ?, ?, 'rembourse', ?, ?)`, [reservationId, reservation.acompte, options.methode || methodePaiement(), refCommand, `${refCommand}-REFUND`]);
      }
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
  if (!peutConfirmer(reservation.statut)) return { action: 'ignore' };

  transaction(db, () => {
    db.run(
      "UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut IN ('en_attente', 'en_attente_paiement')",
      [reservationId],
    );
    if (rowsModified(db) === 1) {
      libererCreneauxReservation(db, reservation, ['en_attente_paiement']);
      const pending = queryOne(
        db,
        `SELECT id FROM paiements WHERE reservation_id = ? AND statut = 'en_attente'
         ORDER BY id DESC LIMIT 1`,
        [reservationId],
      );
      if (pending) {
        db.run(
          "UPDATE paiements SET statut = 'annule', reference_externe = COALESCE(reference_externe, ?), reference_paytech = ? WHERE id = ?",
          [refCommand, `${refCommand}-CANCEL`, pending.id],
        );
      } else {
        db.run(
          `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe, reference_paytech)
           VALUES (?, ?, ?, 'annule', ?, ?)`,
          [reservationId, reservation.montant_avance || reservation.acompte || 0, methodePaiement(), refCommand, `${refCommand}-CANCEL`],
        );
      }
    }
  });
  return { action: 'canceled' };
}

async function confirmerAbonnementDepuisIpn(refCommand, options = {}) {
  const abonnementId = abonnementIdDepuisReference(refCommand)
    || Number(options.abonnementId || 0);
  if (!abonnementId) return { action: 'missing', kind: 'abonnement' };

  const db = await getDb();
  const abonnement = queryOne(db, 'SELECT * FROM abonnements WHERE id = ?', [abonnementId]);
  if (!abonnement) return { action: 'missing', kind: 'abonnement' };
  if (abonnement.statut === 'paye') return { action: 'already_confirmed', kind: 'abonnement' };

  transaction(db, () => {
    marquerAbonnementPaye(db, abonnementId);
    db.run(
      'UPDATE abonnements SET reference_paytech = COALESCE(reference_paytech, ?), canal_paiement = COALESCE(?, canal_paiement) WHERE id = ?',
      [refCommand, normalizeCanal(options.canal), abonnementId],
    );
  });
  return { action: 'confirm', kind: 'abonnement', abonnementId };
}

async function confirmerAchatDepuisIpn(refCommand, options = {}) {
  const terrainId = terrainIdDepuisReferenceAchat(refCommand)
    || Number(options.terrainId || 0);
  if (!terrainId) return { action: 'missing', kind: 'achat' };

  const db = await getDb();
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return { action: 'missing', kind: 'achat' };
  if (Number(terrain.achat_definitif_paye) === 1) {
    return { action: 'already_confirmed', kind: 'achat' };
  }

  transaction(db, () => {
    marquerAchatDefinitifPaye(db, terrainId, options.montant ?? terrain.achat_definitif_montant);
    db.run(
      'UPDATE terrains SET achat_reference_paytech = COALESCE(achat_reference_paytech, ?) WHERE id = ?',
      [refCommand, terrainId],
    );
  });
  return { action: 'confirm', kind: 'achat', terrainId };
}

async function confirmerDetteDepuisIpn(refCommand, options = {}) {
  const gerantId = gerantIdDepuisReferenceDette(refCommand)
    || Number(options.gerantId || 0);
  const periode = periodeDepuisReferenceDette(refCommand)
    || options.periode
    || detteCommissionService.periodeCivile();
  if (!gerantId) return { action: 'missing', kind: 'dette' };

  const db = await getDb();
  const pending = detteCommissionService.paiementDetteParReference(db, refCommand);
  if (pending?.statut === 'paye') {
    return { action: 'already_confirmed', kind: 'dette', gerantId, periode };
  }

  let result;
  transaction(db, () => {
    result = detteCommissionService.confirmerPaiementDetteEnLigne(db, {
      gerantId,
      periode,
      reference: refCommand,
      montantPaye: options.montant,
      faitPar: gerantId,
    });
  });
  return { kind: 'dette', gerantId, periode, ...result };
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

  return {
    reservationId: Number(reservation?.id || reservationId || 0),
    reservation,
    refCommand,
    custom,
    canal: normalizeCanal(custom.canal_paiement || payload.canal_paiement),
  };
}

function montantSandboxPaytech(recu) {
  const n = Math.round(Number(recu));
  return n >= 100 && n <= 150;
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
  if (Math.round(attendu) === Math.round(recu)) return true;

  const initial = Number(payload.initial_item_price ?? payload.initial_item_price_xof);
  if (Number.isFinite(initial) && Math.round(attendu) === Math.round(initial)) return true;

  // PayTech sandbox : débit réel 100–150 XOF, indépendant du montant du lien.
  // Uniquement si notre backend est lui-même en env test (ne jamais faire confiance à payload.env).
  const localEnv = String(process.env.PAYTECH_ENV || '').toLowerCase();
  if (localEnv === 'test' && montantSandboxPaytech(recu)) return true;

  return false;
}

async function handlePaytechIpn(payload, headers) {
  const payoutTry = await handlePayoutWebhookPaytech(payload || {}, headers || {});
  if (payoutTry) return payoutTry;

  if (!paymentService.verifyWebhook(payload, headers, { provider: 'paytech' })) {
    const error = new Error('Signature PayTech invalide');
    error.statusCode = 400;
    throw error;
  }

  // Ne jamais présumer un paiement réussi : un IPN sans type_event (ouverture du checkout)
  // confirmait la réservation dès le clic sur Payer.
  const typeEvent = String(payload.type_event || payload.typeEvent || '').toLowerCase();
  if (!typeEvent) {
    return { received: true, ignored: true, reason: 'type_event_manquant' };
  }
  const db = await getDb();
  const { reservationId, reservation, refCommand, custom, canal } = resoudreReservationDepuisIpn(db, payload);
  if (!refCommand) {
    return { received: true, ignored: true, reason: 'reference_introuvable' };
  }

  const kind = custom.kind || kindFromReference(refCommand);

  if (kind === 'abonnement' || kind === 'achat' || kind === 'dette') {
    if (typeEvent === 'sale_canceled') {
      return { received: true, event: typeEvent, kind, action: 'canceled' };
    }
    if (typeEvent !== 'sale_complete') {
      return { received: true, ignored: true, event: typeEvent, kind };
    }
    if (kind === 'abonnement') {
      const result = await confirmerAbonnementDepuisIpn(refCommand, {
        abonnementId: custom.abonnement_id,
        canal,
      });
      return { received: true, event: typeEvent, ...result };
    }
    if (kind === 'dette') {
      const result = await confirmerDetteDepuisIpn(refCommand, {
        gerantId: custom.gerant_id,
        periode: custom.periode,
        montant: custom.montant ?? payload.final_item_price ?? payload.item_price,
      });
      return { received: true, event: typeEvent, ...result };
    }
    const result = await confirmerAchatDepuisIpn(refCommand, {
      terrainId: custom.terrain_id,
      montant: custom.montant,
      canal,
    });
    return { received: true, event: typeEvent, ...result };
  }

  if (!reservationId) {
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
    try {
      const { enregistrerTentative } = require('../services/ipnReconciliation');
      const dbAlert = await getDb();
      enregistrerTentative(dbAlert, {
        reservationId,
        refCommand: refCommand || `TF-${reservationId}`,
        status: 'failed',
        lastError: 'montant_incoherent',
      });
      const bugAlert = require('../services/bugAlertService');
      await bugAlert.notify({
        kind: 'ipn',
        title: 'IPN PayTech montant incoherent',
        error: new Error(`resa ${reservationId} ref ${refCommand}`),
        meta: {
          reservation_id: reservationId,
          ref: refCommand,
          attendu: reservation.montant_avance || reservation.acompte,
          recu: payload.final_item_price ?? payload.item_price,
        },
      });
    } catch (alertErr) {
      logger.warn('payments/flow.js', 'Alerte montant incoherent echouee', alertErr);
    }
    return { received: true, ignored: true, reason: 'montant_incoherent' };
  }

  await confirmerPaiementEtNotifier(reservationId, refCommand, { canal });
  return { received: true, event: typeEvent };
}

function reservationIdDepuisPaydunya(payload = {}) {
  const custom = payload.custom_data || {};
  const fromCustom = Number(custom.reservation_id || 0);
  if (fromCustom) return fromCustom;
  return reservationIdDepuisReference(custom.ref_command);
}

async function handlePaydunyaIpn(body = {}) {
  // Callback déboursement (payout) — distinct du checkout facture
  if (estCallbackPayoutPaydunya(body)) {
    return handlePayoutWebhookPaydunya(body);
  }

  if (!paymentService.verifyWebhook(body, {}, { provider: 'paydunya' })) {
    const error = new Error('Signature PayDunya invalide');
    error.statusCode = 400;
    throw error;
  }

  const data = paydunyaService.extrairePayloadIpn(body);
  const token = data.invoice?.token || data.token;
  if (!token) {
    return { received: true, ignored: true, reason: 'token_introuvable' };
  }

  const confirme = await paydunyaService.confirmerFacture(token);
  const status = String(confirme.status || '').toLowerCase();
  const custom = confirme.custom_data || data.custom_data || {};
  const refCommand = custom.ref_command || token;
  const kind = custom.kind || kindFromReference(refCommand);

  if (kind === 'abonnement' || kind === 'achat' || kind === 'dette') {
    if (status === 'cancelled' || status === 'canceled' || status === 'failed') {
      return { received: true, event: status, provider: 'paydunya', kind, action: 'canceled' };
    }
    if (status !== 'completed') {
      return { received: true, ignored: true, event: status, provider: 'paydunya', kind };
    }
    if (kind === 'abonnement') {
      const result = await confirmerAbonnementDepuisIpn(refCommand, {
        abonnementId: custom.abonnement_id,
        canal: custom.canal_paiement,
      });
      return { received: true, event: 'completed', provider: 'paydunya', ...result };
    }
    if (kind === 'dette') {
      const result = await confirmerDetteDepuisIpn(refCommand, {
        gerantId: custom.gerant_id,
        periode: custom.periode,
        montant: custom.montant,
      });
      return { received: true, event: 'completed', provider: 'paydunya', ...result };
    }
    const result = await confirmerAchatDepuisIpn(refCommand, {
      terrainId: custom.terrain_id,
      montant: custom.montant,
      canal: custom.canal_paiement,
    });
    return { received: true, event: 'completed', provider: 'paydunya', ...result };
  }

  const db = await getDb();
  let reservationId = reservationIdDepuisPaydunya(confirme) || reservationIdDepuisPaydunya(data);
  if (!reservationId) {
    const byToken = queryOne(db, 'SELECT id FROM reservations WHERE reference_paytech = ? LIMIT 1', [token]);
    reservationId = Number(byToken?.id || 0);
  }
  if (!reservationId) {
    return { received: true, ignored: true, reason: 'reservation_introuvable' };
  }

  if (status === 'cancelled' || status === 'canceled' || status === 'failed') {
    await annulerReservationApresAnnulationPaytech(reservationId, refCommand);
    return { received: true, event: status, provider: 'paydunya' };
  }

  if (status !== 'completed') {
    return { received: true, ignored: true, event: status, provider: 'paydunya' };
  }

  const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  const attendu = Number(reservation?.montant_avance || reservation?.acompte || 0);
  const recu = Number(confirme.invoice?.total_amount ?? data.invoice?.total_amount ?? NaN);
  if (reservation && Number.isFinite(attendu) && Number.isFinite(recu) && Math.round(attendu) !== Math.round(recu)) {
    logger.error('payments/flow.js', 'IPN PayDunya montant incoherent', {
      reservationId,
      attendu,
      recu,
      token,
    });
    return { received: true, ignored: true, reason: 'montant_incoherent' };
  }

  await confirmerPaiementEtNotifier(reservationId, refCommand, {
    methode: 'paydunya',
    canal: custom.canal_paiement,
  });
  return { received: true, event: 'completed', provider: 'paydunya' };
}

function estCallbackPayoutPaydunya(body = {}) {
  const raw = body?.data && typeof body.data === 'object' ? { ...body, ...body.data } : body;
  if (raw.disburse_token || raw.disburse_id || raw.disburse_invoice || raw.disburse_tx_id) return true;
  if (raw.withdraw_mode && (raw.status || raw.response_code)) return true;
  const ref = String(raw.ref_command || raw.reference || raw.disburse_id || '');
  if (/^PO-/i.test(ref) && !raw.invoice) return true;
  return false;
}

async function handlePayoutWebhookPaydunya(body = {}) {
  const { appliquerStatutPayoutWebhook } = require('../services/payoutEngine');
  const raw = body?.data && typeof body.data === 'object' ? { ...body, ...body.data } : body;
  const status = String(raw.status || raw.disburse_status || '').toLowerCase();
  const db = await getDb();
  const result = appliquerStatutPayoutWebhook(db, {
    ref: raw.transaction_id || raw.provider_ref || raw.disburse_tx_id || raw.disburse_id || raw.ref_command,
    disburseToken: raw.disburse_token || raw.disburse_invoice,
    disburseId: raw.disburse_id,
    status: status || (String(raw.response_code) === '00' ? 'success' : 'failed'),
    motif: raw.response_text || raw.description || raw.message,
  });
  logger.info('payments/flow.js', `Webhook payout PayDunya status=${status} ok=${result.ok} pending=${result.pending || false}`);
  return { received: true, provider: 'paydunya', kind: 'payout', ...result };
}

async function handlePayoutWebhookPaytech(body = {}, headers = {}) {
  const { appliquerStatutPayoutWebhook } = require('../services/payoutEngine');
  const type = String(body.type_event || body.type || body.event || '').toLowerCase();
  const externalId = body.external_id || body.externalId;
  const idTransfer = body.id_transfer || body.idTransfer;
  const ref = body.ref_command || body.reference || body.ref_paytech || externalId || idTransfer;
  const isPayout =
    /^PO-/i.test(String(ref || ''))
    || /^PO-/i.test(String(externalId || ''))
    || /payout|disburse|transfer/.test(type)
    || Boolean(idTransfer);
  if (!isPayout) return null;

  if (!paymentService.verifyWebhook(body, headers, { provider: 'paytech' })) {
    // En mock local, on accepte quand même les callbacks PO-* pour les tests
    if (!paytechService.estModeMock()) {
      const error = new Error('Signature PayTech payout invalide');
      error.statusCode = 400;
      throw error;
    }
  }

  const db = await getDb();
  let status = 'pending';
  if (/success|completed|sale_complete|paid|transfer_success/.test(type) || body.success === true) {
    status = 'success';
  }
  if (/fail|error|reject|transfer_failed/.test(type) || body.success === false) status = 'failed';
  if (/cancel/.test(type)) status = 'cancelled';
  const state = String(body.state || '').toLowerCase();
  if (['success', 'completed', 'successful'].includes(state)) status = 'success';
  if (['failed', 'rejected', 'error'].includes(state)) status = 'failed';

  const result = appliquerStatutPayoutWebhook(db, {
    // matching : id_transfer (ref_paytech) OU external_id PO-* OU token_transfer
    ref: idTransfer || ref,
    disburseToken: body.token_transfer || body.tokenTransfer,
    disburseId: externalId,
    status,
    motif: body.message || body.motif || body.reason || body.service_name,
  });
  logger.info('payments/flow.js', `Webhook payout PayTech type=${type} status=${status}`);
  return { received: true, provider: 'paytech', kind: 'payout', ...result };
}

async function handlePaydunyaReturn({ token, reservationId } = {}) {
  const invoiceToken = String(token || '').trim();
  if (!invoiceToken) return { ignored: true, reason: 'token_manquant' };
  const confirme = await paydunyaService.confirmerFacture(invoiceToken);
  const status = String(confirme.status || '').toLowerCase();
  const custom = confirme.custom_data || {};
  const refCommand = custom.ref_command || invoiceToken;
  const kind = custom.kind || kindFromReference(refCommand);

  if (kind === 'abonnement') {
    if (status === 'completed') {
      await confirmerAbonnementDepuisIpn(refCommand, { abonnementId: custom.abonnement_id });
    }
    return { status, kind, abonnementId: Number(custom.abonnement_id || 0), provider: 'paydunya' };
  }
  if (kind === 'achat') {
    if (status === 'completed') {
      await confirmerAchatDepuisIpn(refCommand, { terrainId: custom.terrain_id, montant: custom.montant });
    }
    return { status, kind, terrainId: Number(custom.terrain_id || 0), provider: 'paydunya' };
  }

  const id = Number(custom.reservation_id || reservationId || 0);
  if (status === 'completed' && id) {
    await confirmerPaiementEtNotifier(id, refCommand, { methode: 'paydunya', canal: custom.canal_paiement });
  } else if ((status === 'cancelled' || status === 'canceled' || status === 'failed') && id) {
    await annulerReservationApresAnnulationPaytech(id, refCommand);
  }
  return { status, reservationId: id, provider: 'paydunya' };
}

module.exports = {
  genererCodeReservation,
  reservationIdDepuisReference,
  traiterConfirmationPaytech,
  confirmerPaiementEtNotifier,
  annulerReservationApresAnnulationPaytech,
  confirmerAbonnementDepuisIpn,
  confirmerAchatDepuisIpn,
  confirmerDetteDepuisIpn,
  resoudreReservationDepuisIpn,
  montantIpnCoherent,
  handlePaytechIpn,
  handlePaydunyaIpn,
  handlePaydunyaReturn,
  handlePayoutWebhookPaydunya,
  handlePayoutWebhookPaytech,
  estCallbackPayoutPaydunya,
};
