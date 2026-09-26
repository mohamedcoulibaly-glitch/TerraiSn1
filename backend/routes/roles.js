const express = require('express');
const { getDb, queryAll, queryOne, runSql, transaction, saveDb } = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const {
  ownerRevenueRowsSql,
  periodStart,
  summarizeOwnerRevenue,
} = require('../ownerRevenueService');
const { logActivite } = require('../services/auditService');
const { grilleTarifs, sauvegarderGrille, calculerDevis } = require('../pricingService');
const { normalizeHourString } = require('../reservationLockService');
const whatsappClient = require('../whatsappClient');
const { normalizeTelephoneStore } = require('../notificationService');
const { chargerContrat, contratLectureGerant, contratLectureProprio } = require('../services/contratService');
const { portefeuilleTerrain } = require('../services/ledgerService');
const { demanderRetrait } = require('../services/retraitService');
const { normaliserNumeroSn } = require('../services/calculsPaiement');
const detteService = require('../services/detteCommissionService');
const { historiquePayouts } = require('../services/payoutEngine');

const router = express.Router();

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
    const periode = String(req.query.periode || 'mois');
    const from = periodStart(periode === 'aujourd_hui' ? 'semaine' : periode);
    const today = new Date().toISOString().slice(0, 10);
    const since = periode === 'aujourd_hui' ? today : from;
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
        total_encaisse: 0,
        avances_recues: 0,
        matchs_joues: 0,
        a_venir: 0,
        historique: [],
        graphique: [],
        mention_blocages: 'Les abonnements et tournois ne sont pas encore pris en compte dans ce total.',
      });
    }

    const placeholders = ids.map(() => '?').join(',');
    const reservations = queryAll(
      db,
      `SELECT r.id, r.date, r.heure_debut, r.joueur_nom, r.joueur_telephone, r.statut,
              r.montant_avance, r.acompte, r.montant, r.prix_total, t.nom AS terrain_nom, t.id AS terrain_id
       FROM reservations r
       JOIN terrains t ON t.id = r.terrain_id
       WHERE r.terrain_id IN (${placeholders})
         AND r.date >= ?
         AND r.statut IN ('confirme', 'acceptee', 'match_joue', 'joue', 'en_attente')
       ORDER BY r.date DESC, r.heure_debut DESC
       LIMIT 500`,
      [...ids, since],
    );

    const historique = reservations.map((r) => ({
      id: r.id,
      date: r.date,
      heure_debut: r.heure_debut,
      joueur_nom: r.joueur_nom || '—',
      joueur_telephone: r.joueur_telephone || null,
      montant_avance: Number(r.montant_avance ?? r.acompte ?? 0),
      terrain_nom: r.terrain_nom,
      statut: r.statut,
      source: r.statut,
    }));

    const avanceConfirmee = (r) =>
      ['confirme', 'acceptee', 'match_joue', 'joue'].includes(String(r.statut))
        ? Number(r.montant_avance ?? r.acompte ?? 0)
        : 0;

    const totalEncaisse = historique.reduce((s, r) => s + (['confirme', 'acceptee', 'match_joue', 'joue'].includes(String(r.statut)) ? Number(r.montant_avance || 0) : 0), 0);
    const matchsJoues = reservations.filter((r) => ['match_joue', 'joue'].includes(String(r.statut))).length;
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

    res.json({
      total_encaisse: totalEncaisse,
      avances_recues: totalEncaisse,
      matchs_joues: matchsJoues,
      a_venir: aVenir,
      historique,
      graphique,
      series: terrains.map((t) => ({ key: String(t.id), id: t.id, nom: t.nom })),
      mention_blocages: 'Les abonnements et tournois ne sont pas encore pris en compte dans ce total.',
      encaisse_abonnements: 0,
      encaisse_tournois: 0,
      encaisse_blocages: 0,
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

router.get('/gerant/portefeuille', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  if (!req.user.terrain_id) return res.status(400).json({ error: 'Gérant sans terrain' });
  const wallet = portefeuilleTerrain(db, req.user.terrain_id, req.user.id);
  const dette = detteService.detteOuverteTerrain(db, req.user.terrain_id);
  const payouts = historiquePayouts(db, { terrainId: req.user.terrain_id, limit: 50 });
  const soldeBrut = Number(wallet.solde_disponible || 0);
  const detteOuverte = Number(dette.total || 0);
  const soldeNetRetrait = Math.max(0, soldeBrut - detteOuverte);
  res.json({
    ...wallet,
    dette_commission_ouverte: detteOuverte,
    dette_nb: dette.nb,
    solde_net_apres_dette: soldeNetRetrait,
    bouton_retirer: Boolean(wallet.bouton_retirer) && (soldeBrut > 0 || detteOuverte > 0),
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
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
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
        AND statut IN ('en_attente', 'confirme', 'match_joue', 'joue')
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
  const status = await whatsappClient.getStatus(key);
  if (status.connected && status.phone) {
    const db = await getDb();
    await persistGerantWhatsapp(db, req.user.id, status.phone);
  }
  const db = await getDb();
  const employe = queryOne(db, 'SELECT whatsapp_number, whatsapp_wid, whatsapp_connected_at FROM employes WHERE id = ?', [req.user.id]);
  res.json({
    ...status,
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
  const phoneNumber =
    whatsappClient.toWaIntlDigits?.(employe?.whatsapp_number) ||
    whatsappClient.toWaIntlDigits?.(employe?.telephone) ||
    whatsappClient.toWaIntlDigits?.(req.body?.telephone) ||
    null;

  const started = await whatsappClient.ensureStarted(key, { force, phoneNumber });
  const qr = await whatsappClient.getQrPayload(key);
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
        'QR / code WhatsApp indisponible pour le moment. Réessayez (Nouveau QR).',
      ...started,
      ...qr,
      session: key,
    });
  }
  res.json({ ...started, ...qr, session: key });
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
  const key = gerantWaKey(req);
  const status = await whatsappClient.logoutSession(key);
  res.json({ ...status, message: 'Session WhatsApp gérant déconnectée' });
});

module.exports = router;
