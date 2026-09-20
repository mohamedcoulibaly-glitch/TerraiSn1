const { queryOne, queryAll, saveDb } = require('../database');
const paytechService = require('../paytechService');
const logger = require('../logger');
const { chargerContrat, auMoinsUnCanalVerifie, numeroPayout } = require('./contratService');
const {
  creerDuApresPayin,
  marquerPayable,
  marquerVerses,
  marquerEchec,
  payoutReussiExiste,
  dusEnFenetreExpires,
} = require('./ledgerService');
const {
  detteOuverteTerrain,
  preparerCompensationDette,
  appliquerCompensationDette,
} = require('./detteCommissionService');

const MAX_TENTATIVES_AUTO = 3;

const MESSAGES_BLOCAGE = {
  du_introuvable: 'Dû introuvable',
  en_fenetre: 'Encore en fenêtre de remboursement',
  deja_rembourse: 'Réservation déjà remboursée',
  deja_verse: 'Déjà versé',
  montant_0: 'Montant à verser nul',
  aucun_canal_verifie: 'IBAN / numéro Wave-OM invalide ou non vérifié',
  pas_en_production: 'Paiement production non activé sur le contrat',
  payout_non_autorise: 'Payout prestataire non autorisé (flags env)',
  caisse_insuffisante: 'Solde caisse plateforme insuffisant',
  max_tentatives: 'Nombre max de tentatives atteint',
  mode_retrait: 'Ce dû est en mode retrait manuel',
  payout_en_cours: 'Un versement est déjà en cours pour cette réservation',
  paytech_echec: 'Échec chez le prestataire de paiement',
};

function messageBlocage(code, fallback) {
  return MESSAGES_BLOCAGE[code] || fallback || code || 'Échec payout';
}

function humaniserErreurPayout(error) {
  const raw = String(error?.message || error || 'Échec payout');
  const lower = raw.toLowerCase();
  if (error?.code === 'PAYOUT_DISABLED') return 'Payout non autorisé sur ce prestataire';
  if (error?.code === 'PAYOUT_INVALID') return 'Numéro bénéficiaire ou montant invalide';
  if (/iban|alias|numéro|numero|invalid|invalide/.test(lower)) return `IBAN / numéro invalide — ${raw}`.slice(0, 400);
  if (/insufficient|insuffisant|balance|solde/.test(lower)) return `Solde insuffisant — ${raw}`.slice(0, 400);
  if (/timeout|network|econn|fetch failed/.test(lower)) return `Prestataire injoignable — ${raw}`.slice(0, 400);
  return raw.slice(0, 500);
}

function payoutPaydunyaTestActif() {
  const provider = String(process.env.PAYMENT_PROVIDER || process.env.PAYMENT_GATEWAY || '').toLowerCase();
  const mode = String(process.env.PAYDUNYA_MODE || 'test').toLowerCase();
  const live = mode === 'live' || mode === 'prod' || mode === 'production';
  return (
    provider === 'paydunya'
    && !live
    && String(process.env.PAYDUNYA_PAYOUT_ENABLED || '').toLowerCase() === 'true'
  );
}

function payoutAutoAutorise() {
  if (paytechService.estModeMock()) return true;
  if (payoutPaydunyaTestActif()) return true;
  return Boolean(paytechService.payoutEnabled());
}

function caisseDisponible(db) {
  const recu = queryOne(
    db,
    `SELECT COALESCE(SUM(montant), 0) AS total FROM paiements
      WHERE statut = 'paye' AND methode IN ('paytech', 'paydunya')`,
  );
  const rembourse = queryOne(
    db,
    `SELECT COALESCE(SUM(montant), 0) AS total FROM paiements
      WHERE statut = 'rembourse'`,
  );
  const envoye = queryOne(
    db,
    `SELECT COALESCE(SUM(montant_net), 0) AS total FROM payouts WHERE statut = 'envoye'`,
  );
  const fraisAbs = queryOne(
    db,
    `SELECT COALESCE(SUM(frais_plateforme), 0) AS total FROM payouts WHERE statut = 'envoye'`,
  );
  return Math.max(
    0,
    Number(recu?.total || 0) - Number(rembourse?.total || 0) - Number(envoye?.total || 0) - Number(fraisAbs?.total || 0),
  );
}

function payoutEnCoursExiste(db, reservationId) {
  return queryOne(
    db,
    `SELECT id FROM payouts
      WHERE reservation_id = ? AND statut IN ('en_cours', 'en_attente')
      LIMIT 1`,
    [Number(reservationId)],
  );
}

function raisonsBlocagePayout(db, du, contrat) {
  if (!du) return 'du_introuvable';
  if (du.statut === 'en_fenetre') return 'en_fenetre';
  if (du.statut === 'annule_rembourse') return 'deja_rembourse';
  if (du.statut === 'verse' || payoutReussiExiste(db, du.reservation_id)) return 'deja_verse';
  if (payoutEnCoursExiste(db, du.reservation_id)) return 'payout_en_cours';
  if (Number(du.du_gerant || 0) <= 0) return 'montant_0';
  if (!auMoinsUnCanalVerifie(contrat)) return 'aucun_canal_verifie';
  if (!numeroPayout(contrat)) return 'aucun_canal_verifie';
  if (du.payout_mode === 'auto' && Number(contrat.paiement_production) !== 1 && !payoutPaydunyaTestActif()) {
    return 'pas_en_production';
  }
  if (du.payout_mode === 'auto' && !payoutAutoAutorise()) return 'payout_non_autorise';
  const dette = detteOuverteTerrain(db, du.terrain_id);
  const netNecessaire = Math.max(0, Number(du.du_gerant) - Number(dette.total || 0));
  if (du.payout_mode === 'auto' && netNecessaire > 0 && caisseDisponible(db) < netNecessaire) {
    return 'caisse_insuffisante';
  }
  if (Number(du.tentatives || 0) >= MAX_TENTATIVES_AUTO) return 'max_tentatives';
  return null;
}

function finaliserPayoutSucces(db, payout, { now = Date.now(), ref = null } = {}) {
  const iso = new Date(now).toISOString();
  const fresh = queryOne(db, 'SELECT * FROM payouts WHERE id = ?', [payout.id]) || payout;
  if (fresh.statut === 'envoye') return { ok: true, deja: true, payout: fresh };

  let compensation = { lignes: [] };
  try {
    compensation = fresh.compensation_json ? JSON.parse(fresh.compensation_json) : { lignes: [] };
  } catch {
    compensation = { lignes: [] };
  }

  db.run(
    `UPDATE payouts SET statut = 'envoye', ref_paytech = COALESCE(?, ref_paytech), envoye_at = COALESCE(envoye_at, ?), motif_rejet = NULL
     WHERE id = ? AND statut IN ('en_cours', 'en_attente')`,
    [ref || null, iso, fresh.id],
  );

  if (compensation.lignes?.length) {
    appliquerCompensationDette(db, {
      terrainId: fresh.terrain_id,
      lignes: compensation.lignes,
      faitPar: fresh.traite_par || null,
      roleFaitPar: fresh.type === 'retrait_manuel' || fresh.type === 'retrait_api' ? 'super_admin' : 'systeme',
      payoutId: fresh.id,
      detail: `Reversement net ${fresh.montant_net} FCFA (brut ${fresh.montant_brut || fresh.montant_net})`,
    });
  }

  marquerVerses(db, [fresh.du_id], now);
  db.run(
    `UPDATE paiements SET statut_reversement = 'effectue', montant_reverse = ?
     WHERE reservation_id = ? AND statut = 'paye' AND methode IN ('paytech', 'paydunya', 'manuel')`,
    [Number(fresh.montant_brut || fresh.montant_net || 0), fresh.reservation_id],
  );

  const updated = queryOne(db, 'SELECT * FROM payouts WHERE id = ?', [fresh.id]);
  logger.info(
    'payoutEngine.js',
    `Payout #${fresh.id} traité — resa ${fresh.reservation_id} net=${fresh.montant_net} dette=${fresh.montant_dette_compensee || 0} ref=${ref || updated?.ref_paytech || '—'}`,
  );
  return { ok: true, payout: updated };
}

function finaliserPayoutEchec(db, payout, motif, { now = Date.now() } = {}) {
  const fresh = queryOne(db, 'SELECT * FROM payouts WHERE id = ?', [payout.id]) || payout;
  if (fresh.statut === 'envoye') return { ok: false, deja: true, payout: fresh };
  const message = humaniserErreurPayout(motif);
  db.run(
    `UPDATE payouts SET statut = 'echec', motif_rejet = ? WHERE id = ? AND statut IN ('en_cours', 'en_attente')`,
    [message.slice(0, 500), fresh.id],
  );
  const failed = marquerEchec(db, fresh.du_id, message, now);
  logger.warn('payoutEngine.js', `Payout #${fresh.id} échoué — ${message}`);
  return {
    ok: false,
    raison: 'paytech_echec',
    error: message,
    message_lisible: message,
    du: failed,
    payout: queryOne(db, 'SELECT * FROM payouts WHERE id = ?', [fresh.id]),
  };
}

function finaliserPayoutAnnule(db, payout, motif, { now = Date.now() } = {}) {
  const fresh = queryOne(db, 'SELECT * FROM payouts WHERE id = ?', [payout.id]) || payout;
  if (fresh.statut === 'envoye') return { ok: false, deja: true, payout: fresh };
  const message = humaniserErreurPayout(motif || 'Annulé');
  db.run(
    `UPDATE payouts SET statut = 'annule', motif_rejet = ? WHERE id = ? AND statut IN ('en_cours', 'en_attente')`,
    [message.slice(0, 500), fresh.id],
  );
  // Remet le dû en payable si besoin
  db.run(
    `UPDATE dus SET statut = 'payable', updated_at = ? WHERE id = ? AND statut IN ('demande_retrait', 'echec', 'payable')`,
    [new Date(now).toISOString(), fresh.du_id],
  );
  logger.warn('payoutEngine.js', `Payout #${fresh.id} annulé — ${message}`);
  return { ok: false, raison: 'annule', payout: queryOne(db, 'SELECT * FROM payouts WHERE id = ?', [fresh.id]) };
}

/**
 * Traite un callback async du prestataire (PayDunya disburse / PayTech payout).
 */
function appliquerStatutPayoutWebhook(db, {
  ref,
  disburseToken,
  disburseId,
  status,
  motif,
  now = Date.now(),
} = {}) {
  const st = String(status || '').toLowerCase();
  let payout = null;
  if (ref) {
    payout = queryOne(db, 'SELECT * FROM payouts WHERE ref_paytech = ? LIMIT 1', [String(ref)]);
  }
  if (!payout && disburseToken) {
    payout = queryOne(db, 'SELECT * FROM payouts WHERE disburse_token = ? LIMIT 1', [String(disburseToken)]);
  }
  if (!payout && disburseId) {
    payout = queryOne(
      db,
      `SELECT * FROM payouts WHERE ref_paytech = ? OR disburse_token = ? LIMIT 1`,
      [String(disburseId), String(disburseId)],
    );
  }
  if (!payout) {
    logger.warn('payoutEngine.js', `Webhook payout sans matching (ref=${ref} token=${disburseToken})`);
    return { ok: false, ignored: true, reason: 'payout_introuvable' };
  }
  if (payout.statut === 'envoye') return { ok: true, deja: true, payout };
  if (payout.statut === 'echec' || payout.statut === 'annule') {
    return { ok: false, deja: true, payout };
  }

  if (['success', 'completed', 'envoye', 'paid', 'successful'].includes(st)) {
    const result = finaliserPayoutSucces(db, payout, { now, ref: ref || payout.ref_paytech });
    // Si lié à une demande de retrait, synchroniser
    if (payout.demande_retrait_id) {
      synchroniserDemandeRetrait(db, payout.demande_retrait_id, now);
    }
    saveDb();
    return { ...result, event: 'success' };
  }
  if (['pending', 'processing', 'en_attente', 'queued'].includes(st)) {
    db.run(`UPDATE payouts SET statut = 'en_attente' WHERE id = ? AND statut = 'en_cours'`, [payout.id]);
    saveDb();
    return { ok: true, pending: true, payout: queryOne(db, 'SELECT * FROM payouts WHERE id = ?', [payout.id]) };
  }
  if (['failed', 'echec', 'error', 'rejected'].includes(st)) {
    const result = finaliserPayoutEchec(db, payout, motif || 'Rejeté par le prestataire', { now });
    if (payout.demande_retrait_id) synchroniserDemandeRetrait(db, payout.demande_retrait_id, now);
    saveDb();
    return { ...result, event: 'failed' };
  }
  if (['cancelled', 'canceled', 'annule'].includes(st)) {
    const result = finaliserPayoutAnnule(db, payout, motif || 'Annulé par le prestataire', { now });
    if (payout.demande_retrait_id) synchroniserDemandeRetrait(db, payout.demande_retrait_id, now);
    saveDb();
    return { ...result, event: 'cancelled' };
  }
  return { ok: false, ignored: true, reason: 'statut_inconnu', status: st, payout };
}

function synchroniserDemandeRetrait(db, demandeId, now = Date.now()) {
  const demande = queryOne(db, 'SELECT * FROM demandes_retrait WHERE id = ?', [Number(demandeId)]);
  if (!demande || !['en_attente', 'en_cours'].includes(demande.statut)) return demande;
  const payouts = queryAll(db, 'SELECT * FROM payouts WHERE demande_retrait_id = ?', [demande.id]);
  if (!payouts.length) return demande;
  const iso = new Date(now).toISOString();
  const allEnvoye = payouts.every((p) => p.statut === 'envoye');
  const anyPending = payouts.some((p) => p.statut === 'en_cours' || p.statut === 'en_attente');
  const allFailed = payouts.every((p) => p.statut === 'echec' || p.statut === 'annule');
  if (allEnvoye) {
    db.run(
      `UPDATE demandes_retrait SET statut = 'envoye', traite_at = COALESCE(traite_at, ?) WHERE id = ?`,
      [iso, demande.id],
    );
  } else if (anyPending) {
    db.run(`UPDATE demandes_retrait SET statut = 'en_cours' WHERE id = ? AND statut IN ('en_attente', 'en_cours')`, [
      demande.id,
    ]);
  } else if (allFailed) {
    const motif = payouts.map((p) => p.motif_rejet).filter(Boolean)[0] || 'Échec payout';
    db.run(
      `UPDATE demandes_retrait SET statut = 'echec', motif_rejet = ?, traite_at = ? WHERE id = ?`,
      [String(motif).slice(0, 500), iso, demande.id],
    );
    // Restaurer les dûs non versés
    db.run(
      `UPDATE dus SET statut = 'payable', demande_retrait_id = NULL, updated_at = ?
       WHERE demande_retrait_id = ? AND statut = 'demande_retrait'`,
      [iso, demande.id],
    );
  }
  return queryOne(db, 'SELECT * FROM demandes_retrait WHERE id = ?', [demande.id]);
}

async function executerPayoutAuto(db, du, contrat, { now = Date.now(), force = false, traitePar = null } = {}) {
  const fresh = queryOne(db, 'SELECT * FROM dus WHERE id = ?', [du.id]) || du;
  const blocage = raisonsBlocagePayout(db, fresh, contrat);
  if (blocage && !(force && blocage === 'payout_non_autorise')) {
    return {
      ok: false,
      raison: blocage,
      message_lisible: messageBlocage(blocage),
      du: fresh,
    };
  }
  if (fresh.payout_mode !== 'auto') {
    return { ok: false, raison: 'mode_retrait', message_lisible: messageBlocage('mode_retrait'), du: fresh };
  }
  if (payoutReussiExiste(db, fresh.reservation_id) || payoutEnCoursExiste(db, fresh.reservation_id)) {
    return { ok: false, raison: 'deja_verse', message_lisible: messageBlocage('deja_verse'), du: fresh };
  }

  const dest = numeroPayout(contrat);
  if (!dest) {
    return { ok: false, raison: 'aucun_canal_verifie', message_lisible: messageBlocage('aucun_canal_verifie'), du: fresh };
  }

  const compensation = preparerCompensationDette(db, {
    terrainId: fresh.terrain_id,
    montantDisponible: fresh.du_gerant,
  });
  const montantNet = Number(compensation.montant_net || 0);
  const iso = new Date(now).toISOString();

  db.run(
    `INSERT INTO payouts (
      du_id, reservation_id, terrain_id, type, montant_net, montant_brut, montant_dette_compensee,
      frais_gerant, frais_plateforme, canal, numero, statut, tentatives, compensation_json,
      traite_par, created_at
    ) VALUES (?, ?, ?, 'auto', ?, ?, ?, ?, ?, ?, ?, 'en_cours', ?, ?, ?, ?)`,
    [
      fresh.id,
      fresh.reservation_id,
      fresh.terrain_id,
      montantNet,
      compensation.montant_brut,
      compensation.montant_compense,
      fresh.frais_gerant,
      fresh.frais_plateforme,
      dest.canal,
      dest.numero,
      Number(fresh.tentatives || 0) + 1,
      JSON.stringify({ lignes: compensation.lignes }),
      traitePar || null,
      iso,
    ],
  );
  const payoutId = queryOne(db, 'SELECT last_insert_rowid() AS id').id;
  const payoutRow = queryOne(db, 'SELECT * FROM payouts WHERE id = ?', [payoutId]);

  logger.info(
    'payoutEngine.js',
    `Payout auto #${payoutId} initié — brut=${compensation.montant_brut} dette=${compensation.montant_compense} net=${montantNet} → ${dest.canal}:${dest.numero}`,
  );

  // Compensation totale : rien à envoyer au gérant, on solde quand même
  if (montantNet <= 0) {
    const done = finaliserPayoutSucces(db, payoutRow, { now, ref: `DETTE-${payoutId}` });
    saveDb();
    return {
      ok: true,
      payout_id: payoutId,
      compensation_seule: true,
      du: queryOne(db, 'SELECT * FROM dus WHERE id = ?', [fresh.id]),
      dest,
      montant: 0,
      montant_dette_compensee: compensation.montant_compense,
      message_lisible: 'Dû entièrement compensé par la dette commission',
      ...done,
    };
  }

  try {
    const result = await paytechService.ordonnerPayout({
      numero: dest.numero,
      montant: montantNet,
      canal: dest.canal,
      reservationId: fresh.reservation_id,
      motif: 'reversement_gerant',
    });
    const ref = result.ref_paytech || result.reference || `PO-${payoutId}`;
    db.run(
      `UPDATE payouts SET ref_paytech = ?, disburse_token = ?, provider = ?
       WHERE id = ?`,
      [
        ref,
        result.disburse_token || null,
        result.provider || null,
        payoutId,
      ],
    );

    if (result.pending) {
      db.run(`UPDATE payouts SET statut = 'en_attente' WHERE id = ?`, [payoutId]);
      saveDb();
      logger.info('payoutEngine.js', `Payout #${payoutId} en attente callback prestataire`);
      return {
        ok: true,
        pending: true,
        payout_id: payoutId,
        du: fresh,
        dest,
        montant: montantNet,
        montant_dette_compensee: compensation.montant_compense,
        message_lisible: 'Versement initié — en attente de confirmation prestataire',
        payout: queryOne(db, 'SELECT * FROM payouts WHERE id = ?', [payoutId]),
      };
    }

    const done = finaliserPayoutSucces(db, { ...payoutRow, ref_paytech: ref }, { now, ref });
    saveDb();
    return {
      ok: true,
      payout_id: payoutId,
      du: queryOne(db, 'SELECT * FROM dus WHERE id = ?', [fresh.id]),
      dest,
      montant: montantNet,
      montant_dette_compensee: compensation.montant_compense,
      message_lisible: 'Versement traité avec succès',
      ...done,
    };
  } catch (error) {
    logger.error('payoutEngine.js', 'Payout auto', error);
    const fail = finaliserPayoutEchec(db, payoutRow, error, { now });
    saveDb();
    return { ...fail, dest, montant_dette_compensee: compensation.montant_compense };
  }
}

/**
 * Exécute un payout API pour un dû en mode retrait (appelé depuis retraitService).
 */
async function executerPayoutPourDu(db, du, contrat, {
  now = Date.now(),
  type = 'retrait_api',
  demandeRetraitId = null,
  traitePar = null,
  refManuelle = null,
  modeManuel = false,
  compensationOverride = null,
} = {}) {
  const fresh = queryOne(db, 'SELECT * FROM dus WHERE id = ?', [du.id]) || du;
  if (payoutReussiExiste(db, fresh.reservation_id) || payoutEnCoursExiste(db, fresh.reservation_id)) {
    return { ok: false, raison: 'deja_verse', message_lisible: messageBlocage('deja_verse'), du: fresh };
  }
  const dest = numeroPayout(contrat) || {
    canal: fresh.canal_reversement || 'wave',
    numero: fresh.wave_numero || fresh.om_numero || contrat?.wave_numero || contrat?.om_numero,
  };
  if (!dest?.numero) {
    return { ok: false, raison: 'aucun_canal_verifie', message_lisible: messageBlocage('aucun_canal_verifie'), du: fresh };
  }

  const compensation = compensationOverride || preparerCompensationDette(db, {
    terrainId: fresh.terrain_id,
    montantDisponible: fresh.du_gerant,
  });

  const montantNet = Number(compensation.montant_net || 0);
  const iso = new Date(now).toISOString();

  db.run(
    `INSERT INTO payouts (
      du_id, reservation_id, terrain_id, type, montant_net, montant_brut, montant_dette_compensee,
      frais_gerant, frais_plateforme, canal, numero, statut, tentatives, compensation_json,
      ref_manuelle, demande_retrait_id, demande_par, traite_par, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'en_cours', 1, ?, ?, ?, ?, ?, ?)`,
    [
      fresh.id,
      fresh.reservation_id,
      fresh.terrain_id,
      type,
      montantNet,
      compensation.montant_brut,
      compensation.montant_compense,
      dest.canal,
      dest.numero,
      JSON.stringify({ lignes: compensation.lignes }),
      refManuelle ? String(refManuelle).slice(0, 120) : null,
      demandeRetraitId,
      fresh.gerant_id || null,
      traitePar || null,
      iso,
    ],
  );
  const payoutId = queryOne(db, 'SELECT last_insert_rowid() AS id').id;
  const payoutRow = queryOne(db, 'SELECT * FROM payouts WHERE id = ?', [payoutId]);

  logger.info(
    'payoutEngine.js',
    `Payout ${type} #${payoutId} — brut=${compensation.montant_brut} dette=${compensation.montant_compense} net=${montantNet}`,
  );

  if (montantNet <= 0) {
    const done = finaliserPayoutSucces(db, payoutRow, { now, ref: refManuelle || `DETTE-${payoutId}` });
    return {
      ok: true,
      compensation_seule: true,
      payout_id: payoutId,
      montant: 0,
      montant_dette_compensee: compensation.montant_compense,
      ...done,
    };
  }

  if (modeManuel) {
    const done = finaliserPayoutSucces(db, payoutRow, {
      now,
      ref: refManuelle || `MANUEL-${payoutId}`,
    });
    db.run(`UPDATE payouts SET ref_manuelle = COALESCE(ref_manuelle, ?) WHERE id = ?`, [
      String(refManuelle || `MANUEL-${payoutId}`).slice(0, 120),
      payoutId,
    ]);
    return {
      ok: true,
      manuel: true,
      payout_id: payoutId,
      montant: montantNet,
      montant_dette_compensee: compensation.montant_compense,
      ...done,
    };
  }

  try {
    const result = await paytechService.ordonnerPayout({
      numero: dest.numero,
      montant: montantNet,
      canal: dest.canal,
      reservationId: fresh.reservation_id,
      motif: 'retrait_gerant',
    });
    const ref = result.ref_paytech || result.reference || `PO-${payoutId}`;
    db.run(
      `UPDATE payouts SET ref_paytech = ?, disburse_token = ?, provider = ? WHERE id = ?`,
      [ref, result.disburse_token || null, result.provider || null, payoutId],
    );

    if (result.pending) {
      db.run(`UPDATE payouts SET statut = 'en_attente' WHERE id = ?`, [payoutId]);
      return {
        ok: true,
        pending: true,
        payout_id: payoutId,
        montant: montantNet,
        montant_dette_compensee: compensation.montant_compense,
        message_lisible: 'Versement initié — en attente de confirmation',
        payout: queryOne(db, 'SELECT * FROM payouts WHERE id = ?', [payoutId]),
      };
    }

    const done = finaliserPayoutSucces(db, { ...payoutRow, ref_paytech: ref }, { now, ref });
    return {
      ok: true,
      payout_id: payoutId,
      montant: montantNet,
      montant_dette_compensee: compensation.montant_compense,
      message_lisible: 'Versement traité',
      ...done,
    };
  } catch (error) {
    logger.error('payoutEngine.js', 'Payout retrait', error);
    return finaliserPayoutEchec(db, payoutRow, error, { now });
  }
}

function appliquerApresPayin(db, { reservation, now = Date.now() }) {
  const contrat = chargerContrat(db, reservation.terrain_id);
  if (!contrat) {
    const err = new Error('Contrat terrain introuvable');
    err.statusCode = 500;
    throw err;
  }
  const du = creerDuApresPayin(db, {
    reservation: { ...reservation, confirme_at: reservation.confirme_at || new Date(now).toISOString() },
    contrat,
    now,
  });
  return { contrat, du, payable: du?.statut === 'payable' };
}

async function tenterAutoSiPayable(db, { du, contrat, now = Date.now() }) {
  if (!du || du.statut !== 'payable' || du.payout_mode !== 'auto') {
    return { attempted: false, du };
  }
  const result = await executerPayoutAuto(db, du, contrat, { now });
  return { attempted: true, ...result };
}

async function traiterFenetresExpirees(db, now = Date.now()) {
  const notificationService = require('../notificationService');
  const expires = dusEnFenetreExpires(db, now);
  const results = [];
  for (const du of expires) {
    const contrat = chargerContrat(db, du.terrain_id);
    const payable = marquerPayable(db, du, contrat, now);
    saveDb();
    if (payable?.payout_mode === 'auto') {
      await notificationService.envoyerPayoutAutoEnCours({ contrat, du: payable }).catch((error) => {
        logger.error('payoutEngine.js', 'Notif payout en cours', error);
      });
    }
    const auto = await tenterAutoSiPayable(db, { du: payable, contrat, now });
    if (auto?.ok && !auto.pending) {
      await notificationService.envoyerPayoutAutoOk({
        contrat,
        du: auto.du,
        dest: auto.dest,
      }).catch((error) => logger.error('payoutEngine.js', 'Notif payout auto OK', error));
    }
    results.push({ reservation_id: du.reservation_id, du: auto.du || payable, auto });
  }
  return results;
}

async function relancerPayoutAuto(db, duId, { now = Date.now(), force = true, traitePar = null } = {}) {
  const du = queryOne(db, 'SELECT * FROM dus WHERE id = ?', [Number(duId)]);
  if (!du) {
    const err = new Error('Dû introuvable');
    err.statusCode = 404;
    throw err;
  }
  const contrat = chargerContrat(db, du.terrain_id);
  if (du.statut === 'en_fenetre') {
    const err = new Error(messageBlocage('en_fenetre'));
    err.statusCode = 409;
    throw err;
  }
  if (du.statut === 'verse') {
    const err = new Error(messageBlocage('deja_verse'));
    err.statusCode = 409;
    throw err;
  }
  if (du.payout_mode !== 'auto') {
    const err = new Error(messageBlocage('mode_retrait'));
    err.statusCode = 400;
    throw err;
  }
  if (payoutEnCoursExiste(db, du.reservation_id)) {
    const err = new Error(messageBlocage('payout_en_cours'));
    err.statusCode = 409;
    throw err;
  }
  if (du.statut === 'echec' || du.statut === 'payable') {
    db.run("UPDATE dus SET statut = 'payable' WHERE id = ? AND statut = 'echec'", [du.id]);
  }
  const refreshed = queryOne(db, 'SELECT * FROM dus WHERE id = ?', [du.id]);
  return executerPayoutAuto(db, refreshed, contrat, { now, force, traitePar });
}

function labelStatutPayout(statut) {
  if (statut === 'envoye') return 'Traité';
  if (statut === 'en_attente' || statut === 'en_cours') return 'En attente';
  if (statut === 'echec') return 'Échoué';
  if (statut === 'annule') return 'Annulé';
  return statut || '—';
}

function historiquePayouts(db, { terrainId = null, limit = 100 } = {}) {
  const params = [];
  let sql = `SELECT p.*, t.nom AS terrain_nom, e.nom AS gerant_nom
    FROM payouts p
    JOIN terrains t ON t.id = p.terrain_id
    LEFT JOIN employes e ON e.id = (
      SELECT gerant_id FROM dus WHERE id = p.du_id LIMIT 1
    )`;
  if (terrainId) {
    sql += ' WHERE p.terrain_id = ?';
    params.push(Number(terrainId));
  }
  sql += ' ORDER BY p.created_at DESC LIMIT ?';
  params.push(Number(limit));
  return queryAll(db, sql, params).map((p) => ({
    ...p,
    statut_label: labelStatutPayout(p.statut),
    motif_lisible: p.motif_rejet || null,
  }));
}

module.exports = {
  MAX_TENTATIVES_AUTO,
  payoutAutoAutorise,
  payoutPaydunyaTestActif,
  caisseDisponible,
  raisonsBlocagePayout,
  messageBlocage,
  humaniserErreurPayout,
  appliquerApresPayin,
  tenterAutoSiPayable,
  executerPayoutAuto,
  executerPayoutPourDu,
  traiterFenetresExpirees,
  relancerPayoutAuto,
  historiquePayouts,
  appliquerStatutPayoutWebhook,
  finaliserPayoutSucces,
  finaliserPayoutEchec,
  synchroniserDemandeRetrait,
  labelStatutPayout,
  payoutEnCoursExiste,
};
