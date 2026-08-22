const express = require('express');
const { getDb, queryAll, queryOne, runSql, transaction, saveDb } = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const {
  ownerRevenueRowsSql,
  periodStart,
  summarizeOwnerRevenue,
} = require('../ownerRevenueService');
const { logActivite } = require('../services/auditService');
const { grilleTarifs, calculerDevis } = require('../pricingService');
const { listRegles, grilleFromRegles, getPropositionPending, proposerGrille } = require('../services/tarifService');
const { computeFinances } = require('../services/financesService');
const { normalizeHourString } = require('../reservationLockService');
const whatsappClient = require('../whatsappClient');
const notificationService = require('../notificationService');
const { normalizeTelephoneStore } = require('../notificationService');
const detteService = require('../services/detteCommissionService');
const { notifyTerrain } = require('../realtimeHub');
const multer = require('multer');
const {
  listTerrainPhotos,
  createTerrainPhoto,
  deleteTerrainPhoto,
  setPhotoPrincipale,
} = require('../terrainPhotoService');
const commoditesService = require('../services/commoditesService');
const { logPhotoAction } = require('../services/auditPhotos');

const gerantPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('JPG, PNG ou WEBP uniquement'));
  },
});

function gerantTerrainId(req, res) {
  const id = Number(req.user?.terrain_id);
  if (!id) {
    res.status(400).json({ error: 'Aucun terrain associé à ce gérant' });
    return null;
  }
  return id;
}

const router = express.Router();

router.get('/proprietaire/revenus', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  const db = await getDb();
  const from = periodStart(req.query.periode);
  const rows = await queryAll(db, ownerRevenueRowsSql(), [from, req.user.id]);
  const totals = summarizeOwnerRevenue(rows);
  res.json({
    periode: req.query.periode || 'mois',
    depuis: from,
    avances_encaissees: Number(totals.avances_encaissees || 0),
    montants_reverses: Number(totals.montants_reverses || 0),
    reservations: Number(totals.reservations || 0),
    terrains: rows.map((terrain) => ({
      id: terrain.id,
      nom: terrain.nom,
      reservations: Number(terrain.reservations || 0),
      avances_encaissees: Number(terrain.avances_encaissees || 0),
      montants_reverses: Number(terrain.montants_reverses || 0),
    })),
  });
});

router.get('/gerant/portefeuille', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  const wallet = await queryOne(db, `SELECT
    COALESCE(SUM(solde_disponible), 0) AS solde_disponible,
    COALESCE(SUM(total_encaisse), 0) AS total_encaisse,
    COALESCE(SUM(total_commission_prelevee), 0) AS total_commission_prelevee
    FROM portefeuille_gerant
    WHERE gerant_id = ?`, [req.user.id]) || {};
  const historique = await queryAll(db, `SELECT reservation_id, montant, created_at AS date, statut
    FROM reversements
    WHERE gerant_id = ?
    ORDER BY created_at DESC
    LIMIT 50`, [req.user.id]);
  res.json({
    solde_disponible: Number(wallet.solde_disponible || 0),
    total_encaisse: Number(wallet.total_encaisse || 0),
    total_commission_prelevee: Number(wallet.total_commission_prelevee || 0),
    historique_reversements: historique,
  });
});

router.get('/proprietaire/finances', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const owned = await queryAll(db, 'SELECT id FROM terrains WHERE proprietaire_id = ?', [req.user.id]);
    const ownedIds = owned.map((t) => Number(t.id));
    const requested = Number(req.query.terrain_id);
    const terrainIds = Number.isFinite(requested) && requested > 0
      ? ownedIds.filter((id) => id === requested)
      : ownedIds;
    if (requested && !terrainIds.length) {
      return res.status(404).json({ error: 'Terrain introuvable' });
    }
    res.json({
      ...(await computeFinances(db, terrainIds, req.query.periode)),
      confirmations_manuelles: await detteService.confirmationsManuellesProprio(db, terrainIds),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/gerant/finances', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = req.user.terrain_id;
    if (!terrainId) {
      return res.status(400).json({ error: 'Aucun terrain associé à ce gérant' });
    }
    res.json(await computeFinances(db, [terrainId], req.query.periode));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/gerant/dettes', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json(await detteService.resumeGerant(db, req.user.id, req.query.periode || null));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/gerant/reservations/:id/confirmer-manuellement', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const reservationId = Number(req.params.id);
    const result = await transaction(db, async () => await detteService.confirmerManuellement(db, {
      reservationId,
      gerantId: req.user.id,
      note: req.body?.note,
    }));

    const qrUrl = await notificationService.assurerQrCodeUrl(reservationId);
    if (qrUrl) {
      await runSql(db, 'UPDATE reservations SET qr_code_url = ? WHERE id = ?', [qrUrl, reservationId]);
    }

    await logActivite({
      gerant_id: req.user.id,
      terrain_id: result.terrainId,
      action: 'reservation_creee',
      reservation_id: reservationId,
      details: { mode: 'manuel', commission_en_dette: result.commission },
    }).catch(() => {});

    await notificationService.envoyerConfirmationManuelle(reservationId).catch((error) => {
      console.error('WhatsApp confirmation manuelle', error);
    });

    notifyTerrain(result.terrainId, 'reservation', {
      action: 'confirmed_manual',
      reservation_id: reservationId,
    });

    res.json({
      success: true,
      code_reservation: result.code,
      montant_commission: result.commission,
    });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

router.post('/gerant/creneaux', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  const { date, heure_debut, heure_fin } = req.body;
  if (!date || !heure_debut || !heure_fin) {
    return res.status(400).json({ error: 'date, heure_debut et heure_fin requis' });
  }
  const overlap = await queryOne(
    db,
    `SELECT id FROM creneaux
      WHERE terrain_id = ? AND date = ?
        AND heure_debut < ? AND heure_fin > ?`,
    [req.user.terrain_id, date, heure_fin, heure_debut],
  );
  if (overlap) {
    return res.status(409).json({ error: 'Ce créneau chevauche un créneau existant', code: 'CRENEAU_CONFLIT' });
  }
  const overlapResa = await queryOne(
    db,
    `SELECT id FROM reservations
      WHERE terrain_id = ? AND date = ?
        AND statut IN ('confirme', 'match_joue', 'joue')
        AND heure_debut < ? AND heure_fin > ?`,
    [req.user.terrain_id, date, heure_fin, heure_debut],
  );
  if (overlapResa) {
    return res.status(409).json({ error: 'Ce créneau chevauche une réservation', code: 'CRENEAU_CONFLIT' });
  }
  const result = await runSql(db, 'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)', [req.user.terrain_id, date, heure_debut, heure_fin, 'libre']);
  await logActivite({
    gerant_id: req.user.id,
    terrain_id: req.user.terrain_id,
    action: 'creneau_cree',
    details: { creneau_id: result.lastInsertRowid, date, heure_debut, heure_fin },
  }).catch((error) => console.error('Log activite creneau_cree:', error));
  res.status(201).json(await queryOne(db, 'SELECT * FROM creneaux WHERE id = ?', [result.lastInsertRowid]));
});

router.patch('/gerant/creneaux/:id', authMiddleware, requireRole('gerant'), async (_req, res) => {
  return res.status(409).json({
    error: 'Le statut d’un créneau est géré par les réservations et le scan QR. Utilisez le calendrier ou une réservation manuelle.',
    code: 'SLOT_STATUS_LOCKED',
  });
});

router.delete('/gerant/creneaux/:id', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  const creneau = await queryOne(db, "SELECT * FROM creneaux WHERE id = ? AND terrain_id = ? AND statut = 'libre'", [Number(req.params.id), req.user.terrain_id]);
  await runSql(db, "DELETE FROM creneaux WHERE id = ? AND terrain_id = ? AND statut = 'libre'", [Number(req.params.id), req.user.terrain_id]);
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
    const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [req.user.terrain_id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });
    const grille = await grilleTarifs(db, terrain);
    const regles = await listRegles(db, terrain.id, { actifsUniquement: true });
    const base = {
      prix_entier_base: Number(terrain.prix_entier || terrain.prix_heure || 0),
      prix_moitie_base: Number(terrain.prix_moitie || 0),
    };
    res.json({
      ...grille,
      regles,
      grille_standard: grilleFromRegles(regles, base),
      proposition: await getPropositionPending(db, terrain.id),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/gerant/devis', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [req.user.terrain_id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });
    const date = String(req.query.date || '');
    const heure_debut = normalizeHourString(req.query.heure_debut || '');
    const heure_fin = normalizeHourString(req.query.heure_fin || '');
    const format_terrain = req.query.format === 'moitie' ? 'moitie' : 'entier';
    if (!date || !heure_debut || !heure_fin) {
      return res.status(400).json({ error: 'date, heure_debut et heure_fin requis' });
    }
    res.json(await calculerDevis(db, terrain, { date, heure_debut, heure_fin, format_terrain }));
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

router.put('/gerant/tarifs', authMiddleware, requireRole('gerant'), async (req, res) => {
  return res.status(403).json({
    error: 'Les tarifs sont définis par l\'administration',
    code: 'TARIFS_LECTURE_SEULE',
  });
});

router.post('/gerant/tarifs/proposition', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [req.user.terrain_id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });
    const proposition = await proposerGrille(db, terrain.id, req.body || {}, {
      type: 'gerant',
      id: req.user.id,
    });
    res.status(202).json({
      message: 'Grille envoyée. En attente de confirmation par l’administration.',
      proposition,
    });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

router.get('/proprietaire/terrains/:id/tarifs', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ? AND proprietaire_id = ?', [
      terrainId,
      req.user.id,
    ]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });
    const grille = await grilleTarifs(db, terrain);
    const regles = await listRegles(db, terrain.id, { actifsUniquement: true });
    const base = {
      prix_entier_base: Number(terrain.prix_entier || terrain.prix_heure || 0),
      prix_moitie_base: Number(terrain.prix_moitie || 0),
    };
    res.json({
      ...grille,
      regles,
      grille_standard: grilleFromRegles(regles, base),
      proposition: await getPropositionPending(db, terrain.id),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/proprietaire/terrains/:id/tarifs/proposition', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ? AND proprietaire_id = ?', [
      terrainId,
      req.user.id,
    ]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });
    const proposition = await proposerGrille(db, terrain.id, req.body || {}, {
      type: 'proprietaire',
      id: req.user.id,
    });
    res.status(202).json({
      message: 'Grille envoyée. En attente de confirmation par l’administration.',
      proposition,
    });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

/** Fenêtre de retard check-in (appliquée à tous les créneaux du terrain). */
router.get('/gerant/fenetre-retard', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const row = await queryOne(
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
    await runSql(db, 'UPDATE creneaux SET fenetre_retard = ? WHERE terrain_id = ?', [value, req.user.terrain_id]);
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
  await runSql(
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
  const employe = await queryOne(db, 'SELECT whatsapp_number, whatsapp_wid, whatsapp_connected_at FROM employes WHERE id = ?', [req.user.id]);
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
  const employe = await queryOne(
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
      error: whatsappClient.USER_INFRA_ERROR,
      mock: true,
      session: key,
    });
  }
  if (started.ready && started.phone) {
    await persistGerantWhatsapp(db, req.user.id, started.phone);
  }
  if (!started.ready && !qr.dataUrl && !qr.pairingCode && !started.initializing && !qr.initializing) {
    return res.status(503).json({
      error: whatsappClient.USER_INFRA_ERROR,
      ...started,
      ...qr,
      session: key,
    });
  }
  res.json({ ...started, ...qr, session: key, initializing: Boolean(started.initializing || qr.initializing || qr.dataUrl) });
});

router.get('/gerant/whatsapp/qr', authMiddleware, requireRole('gerant'), async (req, res) => {
  const key = gerantWaKey(req);
  res.json(await whatsappClient.getQrPayload(key));
});

router.post('/gerant/whatsapp/disconnect', authMiddleware, requireRole('gerant'), async (req, res) => {
  const key = gerantWaKey(req);
  const status = await whatsappClient.logoutSession(key);
  res.json({ ...status, message: 'Session WhatsApp gérant déconnectée' });
});

router.get('/gerant/terrain/commodites', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  const terrainId = gerantTerrainId(req, res);
  if (!terrainId) return;
  res.json(await commoditesService.listTerrainCommodites(db, terrainId));
});

router.patch('/gerant/terrain/commodites', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  const terrainId = gerantTerrainId(req, res);
  if (!terrainId) return;
  try {
    const { transaction } = require('../database');
    const list = await transaction(db, async () => await commoditesService.setGerantCommodites(
      db,
      terrainId,
      req.body?.commodite_ids || [],
      commoditesService.actorFromReq(req),
    ));
    res.json(list);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.get('/gerant/terrain/photos', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  const terrainId = gerantTerrainId(req, res);
  if (!terrainId) return;
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json(await listTerrainPhotos(db, terrainId));
});

router.post('/gerant/terrain/photos', authMiddleware, requireRole('gerant'), gerantPhotoUpload.array('photos', 5), async (req, res) => {
  const db = await getDb();
  const terrainId = gerantTerrainId(req, res);
  if (!terrainId) return;
  try {
    const files = req.files && req.files.length ? req.files : [];
    if (!files.length) return res.status(400).json({ error: 'Aucune photo envoyée' });
    const actor = { id: req.user.id, role: 'gerant' };
    const created = [];
    for (const file of files) {
      const photo = await createTerrainPhoto(db, terrainId, {
        buffer: file.buffer,
        mimetype: file.mimetype,
        originalname: file.originalname,
        est_principale: req.body?.est_principale === 'true' || req.body?.est_principale === true,
        uploaded_by: actor.id,
        uploaded_by_role: 'gerant',
      });
      await logPhotoAction(db, {
        terrain_id: terrainId,
        photo_id: photo.id,
        action: 'upload',
        fait_par: actor.id,
        role: 'gerant',
        detail: `Fichier: ${photo.nom_fichier || file.originalname} — ${photo.origWidth || photo.largeur_px}×${photo.origHeight || photo.hauteur_px}px — 16:9`,
      });
      created.push(photo);
    }
    saveDb();
    notifyTerrain(terrainId, 'photos', { action: 'upload' });
    res.status(201).json(created.length === 1 ? created[0] : created);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.delete('/gerant/terrain/photos/:photoId', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  const terrainId = gerantTerrainId(req, res);
  if (!terrainId) return;
  try {
    const result = await transaction(db, async () => await deleteTerrainPhoto(db, terrainId, Number(req.params.photoId), { asGerant: true }));
    await logPhotoAction(db, {
      terrain_id: terrainId,
      photo_id: result.photo?.id || Number(req.params.photoId),
      action: 'suppression',
      fait_par: req.user.id,
      role: 'gerant',
      detail: `Photo ID ${result.photo?.id || req.params.photoId} supprimée par le gérant`,
    });
    saveDb();
    notifyTerrain(terrainId, 'photos', { action: 'suppression' });
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.patch('/gerant/terrain/photos/:photoId/principale', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  const terrainId = gerantTerrainId(req, res);
  if (!terrainId) return;
  try {
    const photo = await transaction(db, async () => await setPhotoPrincipale(db, terrainId, Number(req.params.photoId)));
    await logPhotoAction(db, {
      terrain_id: terrainId,
      photo_id: photo.id,
      action: 'principale_definie',
      fait_par: req.user.id,
      role: 'gerant',
      detail: `Photo ${photo.id} définie comme principale`,
    });
    saveDb();
    notifyTerrain(terrainId, 'photos', { action: 'principale_definie' });
    res.json(photo);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

module.exports = router;
