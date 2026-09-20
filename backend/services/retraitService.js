const { queryOne, queryAll, transaction, saveDb } = require('../database');
const notificationService = require('../notificationService');
const logger = require('../logger');
const { chargerContrat, auMoinsUnCanalVerifie, numeroPayout } = require('./contratService');
const {
  dusPayablesTerrain,
  marquerDemandeRetrait,
  restaurerPayables,
  payoutReussiExiste,
} = require('./ledgerService');
const {
  detteOuverteTerrain,
  preparerCompensationDette,
} = require('./detteCommissionService');
const {
  executerPayoutPourDu,
  payoutEnCoursExiste,
  synchroniserDemandeRetrait,
  humaniserErreurPayout,
} = require('./payoutEngine');

function numeroDevWhatsapp() {
  return process.env.WHATSAPP_DEV_NUMBER || process.env.WHATSAPP_EQUIPE_DEV || null;
}

function messageRetraitDev({ terrain, gerant, montant, montantBrut, dette, wave, om, whatsapp }) {
  return (
    `Retrait gérant demandé\n` +
    `Terrain : ${terrain || '—'}\n` +
    `Gérant : ${gerant || '—'}\n` +
    `Brut : ${Number(montantBrut || montant).toLocaleString('fr-FR')} FCFA\n` +
    (Number(dette) > 0 ? `Dette commission déduite : ${Number(dette).toLocaleString('fr-FR')} FCFA\n` : '') +
    `Net à verser : ${Number(montant).toLocaleString('fr-FR')} FCFA (avance − commission, 0 frais)\n` +
    `Wave : ${wave || '—'}\n` +
    `OM : ${om || '—'}\n` +
    `WhatsApp : ${whatsapp || '—'}`
  );
}

/**
 * Répartit la compensation dette FIFO sur une liste de dûs.
 * Chaque dû reçoit { montant_brut, montant_compense, montant_net, lignes }.
 */
function repartirCompensationSurDus(db, terrainId, dus) {
  let budgetDette = detteOuverteTerrain(db, terrainId).total;
  const plan = [];
  const dettes = queryAll(
    db,
    `SELECT id, montant_commission, periode
     FROM dettes_commissions
     WHERE terrain_id = ? AND statut = 'en_attente'
     ORDER BY created_at ASC, id ASC`,
    [Number(terrainId)],
  );
  let detteIdx = 0;
  let detteReste = dettes.length ? Number(dettes[0].montant_commission || 0) : 0;

  for (const du of dus) {
    const brut = Math.max(0, Math.round(Number(du.du_gerant || 0)));
    let aCompenser = Math.min(brut, budgetDette);
    const lignes = [];
    let pris = 0;
    while (aCompenser > 0 && detteIdx < dettes.length) {
      if (detteReste <= 0) {
        detteIdx += 1;
        detteReste = detteIdx < dettes.length ? Number(dettes[detteIdx].montant_commission || 0) : 0;
        continue;
      }
      const take = Math.min(detteReste, aCompenser);
      lignes.push({
        dette_id: dettes[detteIdx].id,
        montant: take,
        periode: dettes[detteIdx].periode,
        total_dette: Number(dettes[detteIdx].montant_commission || 0),
      });
      detteReste -= take;
      aCompenser -= take;
      pris += take;
      budgetDette -= take;
    }
    plan.push({
      du,
      montant_brut: brut,
      montant_compense: pris,
      montant_net: brut - pris,
      lignes,
    });
  }
  return plan;
}

async function demanderRetrait(db, { terrainId, gerantId, now = Date.now() }) {
  const contrat = chargerContrat(db, terrainId);
  if (!contrat) {
    const err = new Error('Contrat introuvable');
    err.statusCode = 404;
    throw err;
  }
  if (contrat.payout_mode !== 'retrait') {
    const err = new Error('Le bouton Retirer n’est disponible qu’en mode retrait');
    err.statusCode = 400;
    throw err;
  }
  const employe = queryOne(
    db,
    'SELECT id, terrain_id, is_active FROM employes WHERE id = ?',
    [Number(gerantId)],
  );
  if (!employe || Number(employe.is_active) !== 1 || Number(employe.terrain_id) !== Number(terrainId)) {
    const err = new Error('Ce portefeuille n’appartient pas à ce gérant');
    err.statusCode = 403;
    throw err;
  }

  if (!auMoinsUnCanalVerifie(contrat)) {
    const err = new Error('Aucun canal Wave/OM vérifié : le dû s’accumule mais le retrait ne peut pas aboutir');
    err.statusCode = 409;
    throw err;
  }
  const pending = queryOne(
    db,
    "SELECT id FROM demandes_retrait WHERE terrain_id = ? AND statut IN ('en_attente', 'en_cours') LIMIT 1",
    [Number(terrainId)],
  );
  if (pending) {
    const err = new Error('Une demande de retrait est déjà en cours');
    err.statusCode = 409;
    throw err;
  }

  const dus = dusPayablesTerrain(db, terrainId).filter(
    (du) => du.payout_mode === 'retrait'
      && !payoutReussiExiste(db, du.reservation_id)
      && !payoutEnCoursExiste(db, du.reservation_id),
  );
  const montantBrut = dus.reduce((sum, du) => sum + Number(du.du_gerant || 0), 0);
  if (montantBrut <= 0 || !dus.length) {
    const err = new Error('Aucun dû disponible au retrait');
    err.statusCode = 400;
    throw err;
  }

  const compensation = preparerCompensationDette(db, {
    terrainId,
    montantDisponible: montantBrut,
  });
  const montantNet = compensation.montant_net;
  // Même si net = 0 (toute la dette absorbe), on crée la demande pour solder la dette via validation admin

  const iso = new Date(now).toISOString();
  const demandeId = transaction(db, () => {
    db.run(
      `INSERT INTO demandes_retrait (
        terrain_id, gerant_id, montant, montant_brut, montant_dette_compensee,
        wave_numero, om_numero, whatsapp_number,
        statut, demande_par, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?, ?)`,
      [
        Number(terrainId), Number(gerantId), montantNet,
        compensation.montant_brut, compensation.montant_compense,
        contrat.wave_numero, contrat.om_numero, contrat.gerant_whatsapp,
        Number(gerantId), iso,
      ],
    );
    const id = queryOne(db, 'SELECT last_insert_rowid() AS id').id;
    marquerDemandeRetrait(db, dus.map((du) => du.id), id, now);
    return id;
  });

  const message = messageRetraitDev({
    terrain: contrat.terrain_nom,
    gerant: contrat.gerant_nom,
    montant: montantNet,
    montantBrut: compensation.montant_brut,
    dette: compensation.montant_compense,
    wave: contrat.wave_numero,
    om: contrat.om_numero,
    whatsapp: contrat.gerant_whatsapp,
  });
  const telDev = numeroDevWhatsapp();
  await notificationService.envoyerMessage(telDev, message, 'platform', {
    destinataire_type: 'dev',
    destinataire_id: 0,
    type: 'demande_retrait',
  }).catch((error) => {
    logger.error('retraitService.js', 'WhatsApp équipe dév', error);
  });

  logger.info(
    'retraitService.js',
    `Demande retrait #${demandeId} — brut=${compensation.montant_brut} dette=${compensation.montant_compense} net=${montantNet}`,
  );

  return {
    id: demandeId,
    montant: montantNet,
    montant_brut: compensation.montant_brut,
    montant_dette_compensee: compensation.montant_compense,
    wave_numero: contrat.wave_numero,
    om_numero: contrat.om_numero,
    whatsapp_number: contrat.gerant_whatsapp,
    message_dev: message,
    statut: 'en_attente',
    lignes: dus.length,
  };
}

/**
 * Versement dynamique via API prestataire (+ compensation dette).
 * modeManuel=true : marquage manuel avec ref (fallback hors API).
 */
async function executerRetraitDynamique(db, demandeId, {
  traitePar,
  refManuelle,
  modeManuel = false,
  now = Date.now(),
} = {}) {
  const demande = queryOne(db, 'SELECT * FROM demandes_retrait WHERE id = ?', [Number(demandeId)]);
  if (!demande) {
    const err = new Error('Demande introuvable');
    err.statusCode = 404;
    throw err;
  }
  if (!['en_attente', 'en_cours', 'echec'].includes(demande.statut)) {
    const err = new Error('Cette demande n’est plus traitable');
    err.statusCode = 409;
    throw err;
  }

  const contrat = chargerContrat(db, demande.terrain_id);
  if (!contrat) {
    const err = new Error('Contrat introuvable');
    err.statusCode = 404;
    throw err;
  }
  if (!modeManuel && !auMoinsUnCanalVerifie(contrat) && !numeroPayout(contrat)) {
    const err = new Error('Aucun canal Wave/OM vérifié');
    err.statusCode = 409;
    throw err;
  }

  const dus = queryAll(db, 'SELECT * FROM dus WHERE demande_retrait_id = ?', [demande.id])
    .filter((du) => !payoutReussiExiste(db, du.reservation_id) && !payoutEnCoursExiste(db, du.reservation_id));

  if (!dus.length) {
    const err = new Error('Aucun dû à verser pour cette demande');
    err.statusCode = 400;
    throw err;
  }

  const iso = new Date(now).toISOString();
  db.run(
    `UPDATE demandes_retrait SET statut = 'en_cours', traite_par = ?, ref_manuelle = COALESCE(?, ref_manuelle)
     WHERE id = ?`,
    [traitePar || null, refManuelle ? String(refManuelle).slice(0, 120) : null, demande.id],
  );

  const plan = repartirCompensationSurDus(db, demande.terrain_id, dus);
  const resultats = [];

  for (const item of plan) {
    const result = await executerPayoutPourDu(db, item.du, contrat, {
      now,
      type: modeManuel ? 'retrait_manuel' : 'retrait_api',
      demandeRetraitId: demande.id,
      traitePar,
      refManuelle,
      modeManuel,
      compensationOverride: {
        montant_brut: item.montant_brut,
        montant_compense: item.montant_compense,
        montant_net: item.montant_net,
        lignes: item.lignes,
      },
    });
    resultats.push({
      du_id: item.du.id,
      reservation_id: item.du.reservation_id,
      ...result,
      message_lisible: result.message_lisible || (result.ok ? 'OK' : humaniserErreurPayout(result.error || result.raison)),
    });
  }

  saveDb();
  const demandeFinale = synchroniserDemandeRetrait(db, demande.id, now) || queryOne(
    db,
    'SELECT * FROM demandes_retrait WHERE id = ?',
    [demande.id],
  );
  // Si tous OK immédiats mais sync n'a pas basculé (edge), forcer
  if (resultats.every((r) => r.ok && !r.pending) && demandeFinale?.statut === 'en_cours') {
    db.run(
      `UPDATE demandes_retrait SET statut = 'envoye', traite_at = ? WHERE id = ?`,
      [iso, demande.id],
    );
    saveDb();
  }

  const updated = queryOne(db, 'SELECT * FROM demandes_retrait WHERE id = ?', [demande.id]);
  const totalNet = resultats.reduce((s, r) => s + Number(r.montant || 0), 0);
  const totalDette = resultats.reduce((s, r) => s + Number(r.montant_dette_compensee || 0), 0);
  const pending = resultats.some((r) => r.pending);
  const allOk = resultats.every((r) => r.ok);

  logger.info(
    'retraitService.js',
    `Retrait #${demande.id} exécuté mode=${modeManuel ? 'manuel' : 'api'} ok=${allOk} pending=${pending} net=${totalNet} dette=${totalDette}`,
  );

  return {
    ...updated,
    resultats,
    pending,
    ok: allOk,
    montant_verse: totalNet,
    montant_dette_compensee: totalDette,
    message_lisible: pending
      ? 'Versements initiés — en attente de confirmation prestataire'
      : allOk
        ? (totalNet > 0
          ? `Versement traité : ${totalNet.toLocaleString('fr-FR')} FCFA`
          : 'Dette commission soldée (rien à verser au gérant)')
        : (resultats.find((r) => !r.ok)?.message_lisible || 'Échec du versement'),
  };
}

/**
 * Marquage manuel synchrone (ref hors API) — utiliséé par les tests CDC et fallback admin.
 */
function marquerRetraitEnvoye(db, demandeId, { traitePar, refManuelle, now = Date.now() } = {}) {
  // Exécution sync via boucle interne : on ne peut pas await ici.
  // Les callers async doivent préférer executerRetraitDynamique({ modeManuel: true }).
  const { finaliserPayoutSucces } = require('./payoutEngine');
  const demande = queryOne(db, 'SELECT * FROM demandes_retrait WHERE id = ?', [Number(demandeId)]);
  if (!demande) {
    const err = new Error('Demande introuvable');
    err.statusCode = 404;
    throw err;
  }
  if (!['en_attente', 'en_cours', 'echec'].includes(demande.statut)) {
    const err = new Error('Cette demande n’est plus en attente');
    err.statusCode = 409;
    throw err;
  }
  const iso = new Date(now).toISOString();
  const dus = queryAll(db, 'SELECT * FROM dus WHERE demande_retrait_id = ?', [demande.id]);
  const plan = repartirCompensationSurDus(db, demande.terrain_id, dus.filter((d) => !payoutReussiExiste(db, d.reservation_id)));
  for (const item of plan) {
    const du = item.du;
    if (payoutReussiExiste(db, du.reservation_id)) continue;
    db.run(
      `INSERT INTO payouts (
        du_id, reservation_id, terrain_id, type, montant_net, montant_brut, montant_dette_compensee,
        frais_gerant, frais_plateforme, canal, numero, statut, tentatives, compensation_json,
        ref_manuelle, demande_retrait_id, demande_par, traite_par, envoye_at, created_at
      ) VALUES (?, ?, ?, 'retrait_manuel', ?, ?, ?, 0, 0, ?, ?, 'en_cours', 1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        du.id, du.reservation_id, du.terrain_id,
        item.montant_net, item.montant_brut, item.montant_compense,
        du.canal_reversement || 'wave',
        du.wave_numero || du.om_numero || demande.wave_numero,
        JSON.stringify({ lignes: item.lignes }),
        String(refManuelle || '').slice(0, 120),
        demande.id, demande.demande_par, traitePar, iso, iso,
      ],
    );
    const payoutId = queryOne(db, 'SELECT last_insert_rowid() AS id').id;
    const payoutRow = queryOne(db, 'SELECT * FROM payouts WHERE id = ?', [payoutId]);
    finaliserPayoutSucces(db, payoutRow, { now, ref: refManuelle || `MANUEL-${payoutId}` });
  }
  db.run(
    `UPDATE demandes_retrait SET statut = 'envoye', traite_par = ?, ref_manuelle = ?, traite_at = ?
     WHERE id = ?`,
    [traitePar || null, String(refManuelle || '').slice(0, 120), iso, demande.id],
  );
  return queryOne(db, 'SELECT * FROM demandes_retrait WHERE id = ?', [demande.id]);
}

function rejeterRetrait(db, demandeId, { traitePar, motif, now = Date.now() }) {
  const demande = queryOne(db, 'SELECT * FROM demandes_retrait WHERE id = ?', [Number(demandeId)]);
  if (!demande) {
    const err = new Error('Demande introuvable');
    err.statusCode = 404;
    throw err;
  }
  if (!['en_attente', 'en_cours', 'echec'].includes(demande.statut)) {
    const err = new Error('Cette demande n’est plus en attente');
    err.statusCode = 409;
    throw err;
  }
  const iso = new Date(now).toISOString();
  // Annuler payouts en cours/attente liés
  db.run(
    `UPDATE payouts SET statut = 'annule', motif_rejet = ?
     WHERE demande_retrait_id = ? AND statut IN ('en_cours', 'en_attente')`,
    [String(motif || 'Demande rejetée').slice(0, 500), demande.id],
  );
  restaurerPayables(db, demande.id, now);
  db.run(
    `UPDATE demandes_retrait SET statut = 'rejete', traite_par = ?, motif_rejet = ?, traite_at = ?
     WHERE id = ?`,
    [traitePar || null, String(motif || '').slice(0, 500), iso, demande.id],
  );
  logger.info('retraitService.js', `Retrait #${demande.id} rejeté — ${motif || ''}`);
  return queryOne(db, 'SELECT * FROM demandes_retrait WHERE id = ?', [demande.id]);
}

function fileRetraits(db, statut = 'en_attente') {
  const where = statut ? 'WHERE d.statut = ?' : '';
  const params = statut ? [statut] : [];
  return queryAll(
    db,
    `SELECT d.*, t.nom AS terrain_nom, e.nom AS gerant_nom, e.whatsapp_number AS gerant_whatsapp
     FROM demandes_retrait d
     JOIN terrains t ON t.id = d.terrain_id
     LEFT JOIN employes e ON e.id = d.gerant_id
     ${where}
     ORDER BY d.created_at ASC`,
    params,
  ).map((d) => ({
    ...d,
    montant_brut: Number(d.montant_brut != null ? d.montant_brut : d.montant || 0),
    montant_dette_compensee: Number(d.montant_dette_compensee || 0),
  }));
}

module.exports = {
  demanderRetrait,
  executerRetraitDynamique,
  marquerRetraitEnvoye,
  rejeterRetrait,
  fileRetraits,
  messageRetraitDev,
  numeroDevWhatsapp,
  repartirCompensationSurDus,
};
