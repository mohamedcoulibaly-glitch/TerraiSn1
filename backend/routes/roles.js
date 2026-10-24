const express = require('express');
const { getDb, queryAll, queryOne, runSql, transaction, saveDb } = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const {
  ownerRevenueRowsSql,
  periodStart,
  summarizeOwnerRevenue,
  resolveOwnerPeriodBounds,
  buildVariation,
  buildPeriodGraphique,
  isRevenueStatus,
  isPlayedStatus,
  avanceOf,
  localDateYmd,
} = require('../ownerRevenueService');
const { logActivite, listAuditProprietaire } = require('../services/auditService');
const { grilleTarifs, sauvegarderGrille, calculerDevis } = require('../pricingService');
const { normalizeHourString } = require('../reservationLockService');
const whatsappClient = require('../whatsappClient');
const { normalizeTelephoneStore } = require('../notificationService');
const { chargerContrat, contratLectureGerant, contratLectureProprio } = require('../services/contratService');
const { portefeuilleTerrain } = require('../services/ledgerService');
const {
  diagnostiquerBlocageTerrain,
  messageBlocage,
  historiquePayouts,
} = require('../services/payoutEngine');
const { demanderRetrait } = require('../services/retraitService');
const { normaliserNumeroSn } = require('../services/calculsPaiement');
const detteService = require('../services/detteCommissionService');
const { agregatsNetTerrains, deltaPctVsPrecedent } = require('../services/financeNetService');

const router = express.Router();

/** Feed activité gérants — branché sur activite_gerant (+ gardes / sessions actives). */
router.get('/proprietaire/audit', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const payload = await listAuditProprietaire(req.user.id, {
      terrain_id: req.query.terrain_id,
      type: String(req.query.type || 'tout'),
      periode: String(req.query.periode || 'aujourd_hui'),
      limit: req.query.limit,
    });
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

router.get('/proprietaire/revenus', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  const db = await getDb();
  const from = periodStart(req.query.periode);
  const rows = queryAll(db, ownerRevenueRowsSql(), [from, req.user.id]);
  const totals = summarizeOwnerRevenue(rows);
  res.json({
    periode: req.query.periode || 'mois',
    depuis: from,
    beneficiaire: 'gerant',
    avances_encaissees: Number(totals.avances_encaissees || 0),
    commissions_prelevees: Number(totals.commissions_prelevees || 0),
    verse_au_gerant: Number(totals.verse_au_gerant || 0),
    encore_du: Number(totals.encore_du || 0),
    montants_reverses: Number(totals.montants_reverses || 0),
    reservations: Number(totals.reservations || 0),
    terrains: rows.map((terrain) => ({
      id: terrain.id,
      nom: terrain.nom,
      payout_mode: terrain.payout_mode || 'retrait',
      pourcentage_avance: Number(terrain.pourcentage_avance || 0),
      commission_pourcentage: Number(terrain.commission_pourcentage || 0),
      reservations: Number(terrain.reservations || 0),
      avances_encaissees: Number(terrain.avances_encaissees || 0),
      commissions_prelevees: Number(terrain.commissions_prelevees || 0),
      verse_au_gerant: Number(terrain.verse_au_gerant || 0),
      encore_du: Number(terrain.encore_du || 0),
      montants_reverses: Number(terrain.montants_reverses || 0),
    })),
  });
});

/** Finances détaillées pour la page Mes revenus (historique + KPIs). */
router.get('/proprietaire/finances', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const bounds = resolveOwnerPeriodBounds(req.query.periode || 'mois');
    const { periode, from, to, prevFrom, prevTo, variationLabel } = bounds;
    const today = localDateYmd();
    const terrainFilter = req.query.terrain_id ? Number(req.query.terrain_id) : null;

    const terrains = queryAll(
      db,
      'SELECT id, nom FROM terrains WHERE proprietaire_id = ? ORDER BY nom ASC',
      [req.user.id],
    );
    const terrainIds = terrains.map((t) => Number(t.id));
    if (terrainFilter && !terrainIds.includes(terrainFilter)) {
      return res.status(403).json({ error: 'Terrain non autorisé' });
    }
    const ids = terrainFilter ? [terrainFilter] : terrainIds;
    if (!ids.length) {
      return res.json({
        periode,
        from,
        to,
        total_encaisse: 0,
        avances_recues: 0,
        matchs_joues: 0,
        a_venir: 0,
        historique: [],
        graphique: [],
        par_terrain: [],
        variation: null,
        net_recu: 0,
        montant_net: 0,
        soldes_encaissees: 0,
        montant_touche: 0,
        solde_a_retirer: 0,
        total_commission: 0,
        total_avances: 0,
        frais_payout_gerant: 0,
        valeur_totale_matchs: 0,
        commission_pct: 0,
        mention_blocages: 'Les abonnements et tournois ne sont pas encore pris en compte dans ce total.',
      });
    }

    const placeholders = ids.map(() => '?').join(',');
    const loadReservations = (dateFrom, dateTo) =>
      queryAll(
        db,
        `SELECT r.id, r.date, r.heure_debut, r.heure_fin, r.joueur_nom, r.joueur_telephone, r.statut,
                r.montant_avance, r.acompte, r.montant_restant, r.reste_a_payer, r.montant, r.prix_total,
                r.format_terrain, r.code_reservation, r.mode_paiement, r.canal_paiement,
                r.confirme_manuellement_par, r.confirme_manuellement_at,
                t.nom AS terrain_nom, t.id AS terrain_id
         FROM reservations r
         JOIN terrains t ON t.id = r.terrain_id
         WHERE r.terrain_id IN (${placeholders})
           AND r.date >= ? AND r.date <= ?
           AND r.statut IN ('confirme', 'acceptee', 'match_joue', 'joue', 'en_attente')
         ORDER BY r.date DESC, r.heure_debut DESC
         LIMIT 2000`,
        [...ids, dateFrom, dateTo],
      );

    const reservations = loadReservations(from, to);
    const previousRows = loadReservations(prevFrom, prevTo);

    const historique = reservations.map((r) => ({
      id: r.id,
      date: r.date,
      heure_debut: r.heure_debut,
      heure_fin: r.heure_fin,
      joueur_nom: r.joueur_nom || '—',
      joueur_telephone: r.joueur_telephone || null,
      montant_avance: avanceOf(r),
      montant_total: Number(r.prix_total ?? r.montant ?? 0),
      montant_restant: Number(r.montant_restant ?? r.reste_a_payer ?? 0),
      format_terrain: r.format_terrain || 'entier',
      code_reservation: r.code_reservation || null,
      mode_paiement: r.mode_paiement || null,
      canal_paiement: r.canal_paiement || null,
      terrain_id: r.terrain_id,
      terrain_nom: r.terrain_nom,
      statut: r.statut,
      source: r.statut,
    }));

    const sumAvances = (rows) =>
      rows.filter((r) => isRevenueStatus(r.statut)).reduce((s, r) => s + avanceOf(r), 0);

    const totalEncaisse = sumAvances(reservations);
    const prevEncaisse = sumAvances(previousRows);
    const aVenir = reservations.filter(
      (r) => ['confirme', 'acceptee', 'en_attente'].includes(String(r.statut)) && String(r.date) >= today,
    ).length;

    const terrainsScoped = terrains.filter((t) => ids.includes(Number(t.id)));
    const stackByTerrain = !terrainFilter && terrainsScoped.length > 1;
    const graphique = buildPeriodGraphique(
      periode,
      from,
      to,
      reservations
        .filter((r) => isRevenueStatus(r.statut))
        .map((r) => ({
          date: r.date,
          heure_debut: r.heure_debut,
          montant: avanceOf(r),
          matchs: 1,
          statut: r.statut,
          terrain_id: r.terrain_id,
        })),
      { stackByTerrain, terrains: terrainsScoped },
    );

    const byTerrain = new Map();
    for (const t of terrainsScoped) {
      byTerrain.set(Number(t.id), {
        id: Number(t.id),
        nom: t.nom,
        total_encaisse: 0,
        avances_recues: 0,
        matchs_joues: 0,
        a_venir: 0,
        nb_reservations: 0,
      });
    }
    for (const r of reservations) {
      const tid = Number(r.terrain_id);
      const bucket = byTerrain.get(tid);
      if (!bucket) continue;
      bucket.nb_reservations += 1;
      const avance = isRevenueStatus(r.statut) ? avanceOf(r) : 0;
      bucket.total_encaisse += avance;
      bucket.avances_recues += avance;
      if (isPlayedStatus(r.statut)) bucket.matchs_joues += 1;
      if (['confirme', 'acceptee', 'en_attente'].includes(String(r.statut)) && String(r.date) >= today) {
        bucket.a_venir += 1;
      }
    }

    const manuelles = reservations.filter(
      (r) => isRevenueStatus(r.statut) && (r.confirme_manuellement_par || r.confirme_manuellement_at),
    );
    const confirmations_manuelles = {
      nb_confirmations_manuelles: manuelles.length,
      avances_manuelles: manuelles.reduce((s, r) => s + avanceOf(r), 0),
    };

    const until = periode === 'aujourd_hui' ? today : null;
    const net = agregatsNetTerrains(db, ids, since, until);
    const commissionPctRow = queryOne(
      db,
      `SELECT AVG(COALESCE(commission_pourcentage, 0)) AS pct
       FROM terrains WHERE id IN (${placeholders})`,
      ids,
    );
    const deltaPct = deltaPctVsPrecedent(db, ids, since, today, net.total_avances || totalEncaisse);

    res.json({
      periode,
      from,
      to,
      total_encaisse: totalEncaisse,
      avances_recues: totalEncaisse,
      matchs_joues: net.matchs_joues,
      a_venir: aVenir,
      historique,
      graphique,
      par_terrain: [...byTerrain.values()],
      series: terrainsScoped.map((t) => ({ key: String(t.id), id: t.id, nom: t.nom })),
      variation: buildVariation(totalEncaisse, prevEncaisse, variationLabel),
      confirmations_manuelles,
      mention_blocages: 'Les abonnements et tournois ne sont pas encore pris en compte dans ce total.',
      encaisse_abonnements: 0,
      encaisse_tournois: 0,
      encaisse_blocages: 0,
      total_avances: net.total_avances || totalEncaisse,
      total_commission: net.total_commission,
      frais_payout_gerant: net.frais_payout_gerant,
      montant_net: net.montant_net,
      soldes_encaissees: net.soldes_encaissees,
      montant_touche: net.montant_touche,
      solde_a_retirer: net.solde_a_retirer,
      net_recu: net.net_recu,
      valeur_totale_matchs: net.valeur_totale_matchs,
      commission_pct: Number(commissionPctRow?.pct || 0),
      delta_total_pct: deltaPct,
      delta_net_pct: deltaPctVsPrecedent(db, ids, since, today, net.montant_touche, 'touche'),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

router.get('/proprietaire/terrains/:terrainId/tarifs', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrain = queryOne(
      db,
      'SELECT * FROM terrains WHERE id = ? AND proprietaire_id = ?',
      [Number(req.params.terrainId), req.user.id],
    );
    if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
    const grille = grilleTarifs(db, terrain);
    res.json({
      ...grille,
      prix_entier_base: Number(terrain.prix_entier || terrain.prix_heure || 0),
      prix_moitie_base: Number(terrain.prix_moitie || Math.round(Number(terrain.prix_entier || terrain.prix_heure || 0) * 0.6)),
      pourcentage_avance: Number(terrain.pourcentage_avance || 0),
      lecture_seule: true,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

router.post('/proprietaire/terrains/:terrainId/tarifs/proposition', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  res.status(501).json({
    error: 'Les propositions de tarifs propriétaire seront ouvertes prochainement. Contactez l’administration.',
  });
});

router.post('/proprietaire/reservations/:id/confirmer-avance', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  res.status(501).json({
    error: 'La confirmation d’avance manuelle propriétaire n’est pas activée. Le gérant gère les encaissements.',
  });
});

router.get('/proprietaire/contrat/:terrainId', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  const db = await getDb();
  const terrain = queryOne(
    db,
    'SELECT id FROM terrains WHERE id = ? AND proprietaire_id = ?',
    [Number(req.params.terrainId), req.user.id],
  );
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  const contrat = chargerContrat(db, terrain.id);
  const wallet = portefeuilleTerrain(db, terrain.id);
  res.json({
    contrat: contratLectureProprio(contrat),
    avances_gerant: {
      total_verse: wallet.total_verse,
      encore_du: wallet.total_encore_du,
      formule: wallet.formule,
      payout_mode: wallet.payout_mode,
    },
  });
});

/** KPIs + historique encaissements pour la page Finances gérant. */
router.get('/gerant/finances', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    if (!req.user.terrain_id) return res.status(400).json({ error: 'Gérant sans terrain' });

    const periodeRaw = String(req.query.periode || 'aujourd_hui');
    const periode = ['aujourd_hui', 'semaine', 'mois', 'annee'].includes(periodeRaw)
      ? periodeRaw
      : 'aujourd_hui';
    const today = new Date().toISOString().slice(0, 10);
    const from = periode === 'aujourd_hui'
      ? today
      : periodStart(periode);
    const terrainId = Number(req.user.terrain_id);

    const reservations = queryAll(
      db,
      `SELECT r.id, r.date, r.heure_debut, r.heure_fin, r.joueur_nom, r.joueur_telephone, r.statut,
              r.montant_avance, r.acompte, r.montant_restant, r.reste_a_payer, r.montant, r.prix_total,
              r.format_terrain, r.code_reservation, r.mode_paiement, r.canal_paiement,
              t.nom AS terrain_nom, t.id AS terrain_id
       FROM reservations r
       JOIN terrains t ON t.id = r.terrain_id
       WHERE r.terrain_id = ?
         AND r.date >= ?
         AND r.statut IN ('confirme', 'acceptee', 'match_joue', 'joue', 'en_attente')
       ORDER BY r.date DESC, r.heure_debut DESC
       LIMIT 2000`,
      [terrainId, from],
    );

    const historique = reservations.map((r) => ({
      id: r.id,
      date: r.date,
      heure_debut: r.heure_debut,
      heure_fin: r.heure_fin,
      joueur_nom: r.joueur_nom || '—',
      joueur_telephone: r.joueur_telephone || null,
      montant_avance: Number(r.montant_avance ?? r.acompte ?? 0),
      montant_total: Number(r.prix_total ?? r.montant ?? 0),
      montant_restant: Number(r.montant_restant ?? r.reste_a_payer ?? 0),
      format_terrain: r.format_terrain || 'entier',
      code_reservation: r.code_reservation || null,
      mode_paiement: r.mode_paiement || null,
      canal_paiement: r.canal_paiement || null,
      terrain_nom: r.terrain_nom,
      statut: r.statut,
      source: r.statut,
    }));

    const avanceConfirmee = (r) =>
      ['confirme', 'acceptee', 'match_joue', 'joue'].includes(String(r.statut))
        ? Number(r.montant_avance ?? r.acompte ?? 0)
        : 0;

    const totalEncaisse = historique.reduce(
      (s, r) => s + (['confirme', 'acceptee', 'match_joue', 'joue'].includes(String(r.statut)) ? Number(r.montant_avance || 0) : 0),
      0,
    );
    const aVenir = reservations.filter(
      (r) => ['confirme', 'acceptee', 'en_attente'].includes(String(r.statut)) && String(r.date) >= today,
    ).length;

    const byDay = new Map();
    for (const r of reservations) {
      if (!['confirme', 'acceptee', 'match_joue', 'joue'].includes(String(r.statut))) continue;
      const key = String(r.date).slice(0, 10);
      const cur = byDay.get(key) || { label: key, montant: 0, matchs: 0 };
      cur.montant += avanceConfirmee(r);
      cur.matchs += 1;
      byDay.set(key, cur);
    }
    const graphique = [...byDay.values()].sort((a, b) => String(a.label).localeCompare(String(b.label)));

    const terrainNom = reservations[0]?.terrain_nom || null;
    const until = periode === 'aujourd_hui' ? today : null;
    const net = agregatsNetTerrains(db, [terrainId], from, until);
    const terrain = queryOne(
      db,
      'SELECT commission_pourcentage, delai_paiement_dette_jours FROM terrains WHERE id = ?',
      [terrainId],
    );
    const wallet = portefeuilleTerrain(db, terrainId, req.user.id);
    const dette = detteService.detteOuverteTerrain(db, terrainId);
    const deltaPct = deltaPctVsPrecedent(db, [terrainId], from, today, net.total_avances || totalEncaisse);

    res.json({
      periode,
      from,
      to: today,
      total_encaisse: totalEncaisse,
      total_avances: net.total_avances || totalEncaisse,
      avances_recues: totalEncaisse,
      matchs_joues: net.matchs_joues,
      a_venir: aVenir,
      historique,
      graphique,
      par_terrain: [{
        id: terrainId,
        nom: terrainNom || `Terrain #${terrainId}`,
        total_encaisse: totalEncaisse,
        avances_recues: totalEncaisse,
        matchs_joues: net.matchs_joues,
        a_venir: aVenir,
        nb_reservations: reservations.length,
      }],
      mention_blocages: 'Les abonnements et tournois ne sont pas encore pris en compte dans ce total.',
      encaisse_abonnements: 0,
      encaisse_tournois: 0,
      encaisse_blocages: 0,
      solde_disponible: Number(wallet?.solde_disponible || 0),
      solde_a_retirer: net.solde_a_retirer,
      total_commission: net.total_commission,
      frais_payout_gerant: net.frais_payout_gerant,
      montant_net: net.montant_net,
      soldes_encaissees: net.soldes_encaissees,
      montant_touche: net.montant_touche,
      net_recu: net.net_recu,
      valeur_totale_matchs: net.valeur_totale_matchs,
      dette_commission: Number(dette?.total || 0),
      date_echeance: dette?.date_echeance || null,
      delai_paiement_jours: Number(terrain?.delai_paiement_dette_jours || 0) || null,
      commission_pct: Number(terrain?.commission_pourcentage || 0),
      delta_total_pct: deltaPct,
      delta_net_pct: deltaPctVsPrecedent(db, [terrainId], from, today, net.montant_touche, 'touche'),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

router.get('/gerant/portefeuille', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  if (!req.user.terrain_id) return res.status(400).json({ error: 'Gérant sans terrain' });
  const wallet = portefeuilleTerrain(db, req.user.terrain_id, req.user.id);
  const dette = detteService.detteOuverteTerrain(db, req.user.terrain_id);
  const payouts = historiquePayouts(db, { terrainId: req.user.terrain_id, limit: 50 });
  const soldeBrut = Number(wallet.solde_disponible || 0);
  const detteOuverte = Number(dette.total || 0);
  const soldeNetRetrait = Math.max(0, soldeBrut - detteOuverte);
  const boutonRetirer = Boolean(wallet.bouton_retirer) && (soldeBrut > 0 || detteOuverte > 0);
  const diagnostic = diagnostiquerBlocageTerrain(db, req.user.terrain_id);
  // Mode auto : toujours exposer le diagnostic. Mode retrait : seulement si bouton inactif.
  const blocage = wallet.payout_mode === 'auto'
    ? diagnostic
    : (boutonRetirer
      ? { raison_blocage: null, message_lisible: null, code: null }
      : diagnostic);
  res.json({
    ...wallet,
    dette_commission_ouverte: detteOuverte,
    dette_nb: dette.nb,
    solde_net_apres_dette: soldeNetRetrait,
    bouton_retirer: boutonRetirer,
    raison_blocage: blocage.raison_blocage,
    message_lisible: blocage.message_lisible || (blocage.raison_blocage ? messageBlocage(blocage.raison_blocage) : null),
    code_blocage: blocage.code || null,
    historique_payouts: payouts,
  });
});

router.get('/gerant/dettes', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  if (!req.user.id) return res.status(400).json({ error: 'Gérant invalide' });
  const periode = req.query.periode ? String(req.query.periode) : undefined;
  res.json(detteService.resumeGerant(db, req.user.id, periode));
});

router.post('/gerant/reservations/:id/confirmer-manuellement', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  try {
    const result = transaction(db, () => detteService.confirmerManuellement(db, {
      reservationId: Number(req.params.id),
      gerantId: req.user.id,
      note: req.body?.note,
    }));
    saveDb();
    await logActivite({
      gerant_id: req.user.id,
      terrain_id: result.terrainId,
      action: 'confirmation_manuelle',
      reservation_id: Number(req.params.id),
      details: { commission: result.commission },
    }).catch(() => {});
    res.status(201).json({
      success: true,
      code_reservation: result.code,
      commission_en_dette: result.commission,
      montant_avance: result.montantAvance,
      message: `Réservation confirmée. Commission ${result.commission} FCFA enregistrée en dette.`,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.get('/gerant/contrat', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  if (!req.user.terrain_id) return res.status(400).json({ error: 'Gérant sans terrain' });
  const contrat = chargerContrat(db, req.user.terrain_id);
  res.json(contratLectureGerant(contrat));
});

router.post('/gerant/portefeuille/retirer', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  try {
    if (!req.user.terrain_id) return res.status(400).json({ error: 'Gérant sans terrain' });
    const result = await demanderRetrait(db, {
      terrainId: req.user.terrain_id,
      gerantId: req.user.id,
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: error.message || 'Erreur serveur',
      code: error.code || null,
      message_lisible: error.message || 'Erreur serveur',
    });
  }
});

router.post('/gerant/numeros/demande-changement', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  if (!req.user.terrain_id) return res.status(400).json({ error: 'Gérant sans terrain' });
  const pending = queryOne(
    db,
    "SELECT id FROM demandes_changement_numero WHERE terrain_id = ? AND gerant_id = ? AND statut = 'en_attente'",
    [req.user.terrain_id, req.user.id],
  );
  if (pending) return res.status(409).json({ error: 'Une demande est déjà en attente de validation superadmin' });
  const identiques = req.body?.numeros_identiques_whatsapp ? 1 : 0;
  let wave = normaliserNumeroSn(req.body?.wave_numero);
  let om = normaliserNumeroSn(req.body?.om_numero);
  if (identiques) {
    const gerant = queryOne(db, 'SELECT whatsapp_number, telephone FROM employes WHERE id = ?', [req.user.id]);
    const source = normaliserNumeroSn(gerant?.whatsapp_number || gerant?.telephone || wave || om);
    wave = source;
    om = source;
  }
  const result = runSql(
    db,
    `INSERT INTO demandes_changement_numero
      (terrain_id, gerant_id, wave_numero, om_numero, numeros_identiques_whatsapp, statut, motif)
     VALUES (?, ?, ?, ?, ?, 'en_attente', ?)`,
    [req.user.terrain_id, req.user.id, wave, om, identiques, String(req.body?.motif || '').slice(0, 300)],
  );
  res.status(201).json(queryOne(db, 'SELECT * FROM demandes_changement_numero WHERE id = ?', [result.lastInsertRowid]));
});

router.post('/gerant/creneaux', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  const { date, heure_debut, heure_fin } = req.body;
  if (!date || !heure_debut || !heure_fin) {
    return res.status(400).json({ error: 'date, heure_debut et heure_fin requis' });
  }
  const overlap = queryOne(
    db,
    `SELECT id FROM creneaux
      WHERE terrain_id = ? AND date = ?
        AND heure_debut < ? AND heure_fin > ?`,
    [req.user.terrain_id, date, heure_fin, heure_debut],
  );
  if (overlap) {
    return res.status(409).json({ error: 'Ce créneau chevauche un créneau existant', code: 'CRENEAU_CONFLIT' });
  }
  const overlapResa = queryOne(
    db,
    `SELECT id FROM reservations
      WHERE terrain_id = ? AND date = ?
        AND statut IN ('en_attente', 'en_attente_paiement', 'confirme', 'match_joue', 'joue')
        AND heure_debut < ? AND heure_fin > ?`,
    [req.user.terrain_id, date, heure_fin, heure_debut],
  );
  if (overlapResa) {
    return res.status(409).json({ error: 'Ce créneau chevauche une réservation', code: 'CRENEAU_CONFLIT' });
  }
  const result = runSql(db, 'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)', [req.user.terrain_id, date, heure_debut, heure_fin, 'libre']);
  await logActivite({
    gerant_id: req.user.id,
    terrain_id: req.user.terrain_id,
    action: 'creneau_cree',
    details: { creneau_id: result.lastInsertRowid, date, heure_debut, heure_fin },
  }).catch((error) => console.error('Log activite creneau_cree:', error));
  res.status(201).json(queryOne(db, 'SELECT * FROM creneaux WHERE id = ?', [result.lastInsertRowid]));
});

router.patch('/gerant/creneaux/:id', authMiddleware, requireRole('gerant'), async (_req, res) => {
  return res.status(409).json({
    error: 'Le statut d’un créneau est géré par les réservations et le scan QR. Utilisez le calendrier ou une réservation manuelle.',
    code: 'SLOT_STATUS_LOCKED',
  });
});

router.delete('/gerant/creneaux/:id', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  const creneau = queryOne(db, "SELECT * FROM creneaux WHERE id = ? AND terrain_id = ? AND statut = 'libre'", [Number(req.params.id), req.user.terrain_id]);
  runSql(db, "DELETE FROM creneaux WHERE id = ? AND terrain_id = ? AND statut = 'libre'", [Number(req.params.id), req.user.terrain_id]);
  if (creneau) {
    await logActivite({
      gerant_id: req.user.id,
      terrain_id: req.user.terrain_id,
      action: 'creneau_supprime',
      details: { creneau_id: creneau.id, date: creneau.date, heure_debut: creneau.heure_debut, heure_fin: creneau.heure_fin },
    }).catch((error) => console.error('Log activite creneau_supprime:', error));
  }
  res.json({ message: 'Créneau supprimé' });
});

router.get('/gerant/tarifs', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [req.user.terrain_id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });
    res.json(grilleTarifs(db, terrain));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/gerant/devis', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [req.user.terrain_id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });
    const date = String(req.query.date || '');
    const heure_debut = normalizeHourString(req.query.heure_debut || '');
    const heure_fin = normalizeHourString(req.query.heure_fin || '');
    const format_terrain = req.query.format === 'moitie' ? 'moitie' : 'entier';
    if (!date || !heure_debut || !heure_fin) {
      return res.status(400).json({ error: 'date, heure_debut et heure_fin requis' });
    }
    res.json(calculerDevis(db, terrain, { date, heure_debut, heure_fin, format_terrain }));
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

router.put('/gerant/tarifs', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const grille = transaction(db, () => sauvegarderGrille(db, req.user.terrain_id, req.body || {}));
    await logActivite({
      gerant_id: req.user.id,
      terrain_id: req.user.terrain_id,
      action: 'tarifs_mis_a_jour',
      details: {
        prix_entier_base: grille.prix_entier_base,
        prix_moitie_base: grille.prix_moitie_base,
        cellules_perso: (grille.cellules || []).filter((c) => c.est_personnalise).length,
      },
    }).catch((error) => console.error('Log activite tarifs_mis_a_jour:', error));
    res.json(grille);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

/** Fenêtre de retard check-in (appliquée à tous les créneaux du terrain). */
router.get('/gerant/fenetre-retard', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const row = queryOne(
      db,
      `SELECT fenetre_retard FROM creneaux WHERE terrain_id = ? AND fenetre_retard IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
      [req.user.terrain_id],
    );
    res.json({ fenetre_retard: Number(row?.fenetre_retard ?? 30) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/gerant/fenetre-retard', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const value = Number(req.body?.fenetre_retard);
    if (![0, 15, 30, 45, 60].includes(value)) {
      return res.status(400).json({ error: 'fenetre_retard invalide (0, 15, 30, 45 ou 60)' });
    }
    runSql(db, 'UPDATE creneaux SET fenetre_retard = ? WHERE terrain_id = ?', [value, req.user.terrain_id]);
    await logActivite({
      gerant_id: req.user.id,
      terrain_id: req.user.terrain_id,
      action: 'fenetre_retard_maj',
      details: { fenetre_retard: value },
    }).catch(() => {});
    res.json({ fenetre_retard: value });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

async function persistGerantWhatsapp(db, gerantId, phoneDigits) {
  if (!gerantId || !phoneDigits) return;
  let stored = String(phoneDigits);
  try {
    stored = normalizeTelephoneStore(phoneDigits);
  } catch {
    stored = `+${String(phoneDigits).replace(/\D/g, '')}`;
  }
  runSql(
    db,
    `UPDATE employes SET whatsapp_number = ?, whatsapp_wid = ?, whatsapp_connected_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [stored, String(phoneDigits).replace(/\D/g, ''), gerantId],
  );
}

function gerantWaKey(req) {
  return whatsappClient.gerantSessionKey(req.user.id);
}

router.get('/gerant/whatsapp/status', authMiddleware, requireRole('gerant'), async (req, res) => {
  const key = gerantWaKey(req);
  const whatsappManager = require('../services/whatsappManager');
  const managed = await whatsappManager.getStatut(`gerant_${req.user.id}`);
  const status = await whatsappClient.getStatus(key);
  const db = await getDb();
  if (status.connected && status.phone) {
    await persistGerantWhatsapp(db, req.user.id, status.phone);
    await whatsappManager.upsertSession(`gerant_${req.user.id}`, {
      statut: 'connecte',
      telephone: status.phone,
    });
  }
  const employe = queryOne(db, 'SELECT whatsapp_number, whatsapp_wid, whatsapp_connected_at FROM employes WHERE id = ?', [req.user.id]);
  const connected = Boolean(status.connected || managed.pret);
  res.json({
    ...status,
    ...managed,
    connected,
    pret: connected,
    status: connected ? 'CONNECTED' : status.status || 'DISCONNECTED',
    configured_number: employe?.whatsapp_number || null,
    connected_wid: employe?.whatsapp_wid || status.phone || null,
    connected_at: employe?.whatsapp_connected_at || null,
  });
});

router.post('/gerant/whatsapp/connect', authMiddleware, requireRole('gerant'), async (req, res) => {
  const key = gerantWaKey(req);
  if (!key) {
    return res.status(400).json({ error: 'Session gérant invalide' });
  }
  const force = Boolean(req.body?.force || req.query?.force);
  const db = await getDb();
  const employe = queryOne(
    db,
    'SELECT whatsapp_number, telephone FROM employes WHERE id = ?',
    [req.user.id],
  );
  // Priorité au numéro saisi dans l’UI (sinon on restait collé à l’ancien numéro DB).
  const phoneNumber =
    whatsappClient.toWaIntlDigits?.(req.body?.telephone) ||
    whatsappClient.toWaIntlDigits?.(employe?.whatsapp_number) ||
    whatsappClient.toWaIntlDigits?.(employe?.telephone) ||
    null;

  if (phoneNumber && phoneNumber !== whatsappClient.toWaIntlDigits?.(employe?.whatsapp_number)) {
    runSql(db, `UPDATE employes SET whatsapp_number = ? WHERE id = ?`, [
      `+${phoneNumber}`,
      req.user.id,
    ]);
  }

  const whatsappManager = require('../services/whatsappManager');
  const { started, qr } = await whatsappManager.getOuCreerClient(`gerant_${req.user.id}`, {
    force,
    phoneNumber,
  });
  if (started.mock || qr.mock) {
    return res.status(503).json({
      error:
        'WhatsApp est en mode mock (WHATSAPP_MOCK=true). Passez WHATSAPP_MOCK=false dans backend/.env puis redémarrez l’API pour générer un QR.',
      mock: true,
      session: key,
    });
  }
  if (started.ready && started.phone) {
    await persistGerantWhatsapp(db, req.user.id, started.phone);
  }
  if (!started.ready && !qr.dataUrl && !qr.pairingCode) {
    return res.status(503).json({
      error:
        qr.error ||
        started.error ||
        'Code WhatsApp indisponible pour le moment. Réessayez dans quelques secondes.',
      ...started,
      ...qr,
      session: key,
    });
  }
  res.json({
    ...started,
    ...qr,
    pairingCode: qr.pairingCode || started.pairingCode || null,
    pairingPhone: qr.pairingPhone || started.pairingPhone || phoneNumber || null,
    pairingExpiresAt: qr.pairingExpiresAt || started.pairingExpiresAt || null,
    session: key,
    clientId: `gerant_${req.user.id}`,
  });
});

router.get('/gerant/whatsapp/qr', authMiddleware, requireRole('gerant'), async (req, res) => {
  const key = gerantWaKey(req);
  const status = await whatsappClient.getStatus(key);
  // Ne démarrer une session que s'il n'y a ni QR ni init en cours
  if (!status.connected && !status.initializing && !status.hasQr) {
    await whatsappClient.ensureStarted(key);
  }
  res.json(await whatsappClient.getQrPayload(key));
});

router.post('/gerant/whatsapp/disconnect', authMiddleware, requireRole('gerant'), async (req, res) => {
  const whatsappManager = require('../services/whatsappManager');
  await whatsappManager.deconnecter(`gerant_${req.user.id}`);
  res.json({ succes: true, message: 'Session WhatsApp gérant déconnectée' });
});

module.exports = router;
