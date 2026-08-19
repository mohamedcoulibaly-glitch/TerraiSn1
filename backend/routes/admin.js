const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { getDb, queryAll, queryOne, runSql, saveDb, transaction } = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { envoyerAcces } = require('../accessNotificationService');
const {
  GRACE_DAYS,
  ensurePendingAbonnement,
  marquerAbonnementPaye,
  marquerAchatDefinitifPaye,
  appliquerSuspensionsAbonnements,
  abonnementsAvecEtat,
} = require('../revenueModelService');
const {
  listTerrainPhotos,
  createTerrainPhoto,
  updateTerrainPhoto,
  deleteTerrainPhoto,
  setPhotoPrincipale,
  reorderTerrainPhotos,
  terrainAUnePhotoPrincipale,
} = require('../terrainPhotoService');
const { syncApresModificationTerrain } = require('../services/configSync');
const detteService = require('../services/detteCommissionService');
const commoditesService = require('../services/commoditesService');
const { logPhotoAction, listAuditPhotos } = require('../services/auditPhotos');
const { listAuditCommodites } = require('../services/auditCommodites');
const essaiService = require('../services/essaiService');
const terrainFeaturesService = require('../services/terrainFeaturesService');
const modeRevenuService = require('../services/modeRevenuService');

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('JPG, PNG ou WEBP uniquement'));
  },
});
const {
  listRegles,
  apercuPrix,
  creerRegle,
  modifierRegle,
  toggleRegle,
  supprimerRegle,
  mapRegle,
  grilleFromRegles,
  appliquerGrille,
  listPropositions,
  validerProposition,
  refuserProposition,
} = require('../services/tarifService');
const { normaliserDelaiHeures } = require('../services/annulationService');

const router = express.Router();

function montantAvanceReference(prixReference, pourcentageAvance) {
  return Math.round((Number(prixReference || 0) * Number(pourcentageAvance || 0)) / 100);
}

router.post('/auth/login', async (req, res) => {
  try {
    const db = await getDb();
    const { telephone, password } = req.body;
    const normalized = String(telephone || '').replace(/\D/g, '');
    const user = queryAll(db, "SELECT * FROM users WHERE (role = 'super_admin' OR role = 'superadmin') AND is_active = 1").find((item) => String(item.telephone || '').replace(/\D/g, '') === normalized);
    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return res.status(401).json({ error: 'Acces refuse' });
    const token = jwt.sign({ id: user.id, telephone: user.telephone, role: 'super_admin', accountType: 'user' }, process.env.JWT_SECRET || 'terrainsn_secret_key_2026', { expiresIn: '8h' });
    res.json({ token, user: { id: user.id, nom: user.nom, telephone: user.telephone, role: 'super_admin', accountType: 'user' } });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.use(authMiddleware, requireRole('super_admin'));

router.get('/dashboard', async (req, res) => {
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  res.json({
    terrainsActifs: queryOne(db, 'SELECT COUNT(*) AS total FROM terrains WHERE is_active = 1').total,
    reservationsAujourdhui: queryOne(db, 'SELECT COUNT(*) AS total FROM reservations WHERE date = ?', [today]).total,
    revenusMois: queryOne(db, "SELECT COALESCE(SUM(prix_total), 0) AS total FROM reservations WHERE statut = 'joue' AND substr(date, 1, 7) = ?", [month]).total,
  });
});

router.get('/profile', async (req, res) => {
  const db = await getDb();
  const account = queryOne(db, `SELECT id, nom, email, telephone, role, is_active, created_at
    FROM users WHERE id = ?`, [req.user.id]);
  const month = new Date().toISOString().slice(0, 7);
  const summary = {
    terrains_total: queryOne(db, 'SELECT COUNT(*) AS total FROM terrains').total,
    terrains_actifs: queryOne(db, 'SELECT COUNT(*) AS total FROM terrains WHERE is_active = 1').total,
    proprietaires: queryOne(db, 'SELECT COUNT(*) AS total FROM proprietaires').total,
    gerants: queryOne(db, 'SELECT COUNT(*) AS total FROM employes').total,
    reservations_jouees_mois: queryOne(db, "SELECT COUNT(*) AS total FROM reservations WHERE statut IN ('joue','match_joue') AND substr(date, 1, 7) = ?", [month]).total,
    avances_mois: queryOne(db, `SELECT COALESCE(SUM(p.montant_acompte), 0) AS total
      FROM paiements p
      JOIN reservations r ON r.id = p.reservation_id
      WHERE p.statut = 'paye'
        AND r.statut IN ('joue','match_joue')
        AND substr(r.date, 1, 7) = ?`, [month]).total,
    commissions_mois: queryOne(db, `SELECT COALESCE(SUM(p.montant_commission), 0) AS total
      FROM paiements p
      JOIN reservations r ON r.id = p.reservation_id
      WHERE p.statut = 'paye'
        AND r.statut IN ('joue','match_joue')
        AND substr(r.date, 1, 7) = ?`, [month]).total,
    abonnements_en_retard: queryOne(db, "SELECT COUNT(*) AS total FROM abonnements WHERE statut = 'en_retard'").total,
  };
  const recentTerrains = queryAll(db, `SELECT t.id, t.nom, t.ville, t.is_active, t.modele_revenus, p.nom AS proprietaire_nom
    FROM terrains t
    LEFT JOIN proprietaires p ON p.id = t.proprietaire_id
    ORDER BY t.created_at DESC
    LIMIT 6`);
  res.json({ account, summary, recentTerrains });
});

router.get('/terrains', async (req, res) => {
  const db = await getDb();
  res.json(queryAll(db, `SELECT t.*, p.nom AS proprietaire_nom FROM terrains t
    LEFT JOIN proprietaires p ON p.id = t.proprietaire_id ORDER BY t.created_at DESC`));
});

function parseCoord(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function terrainADesCoordonnees(terrain) {
  return parseCoord(terrain?.latitude) != null && parseCoord(terrain?.longitude) != null;
}

router.post('/terrains', async (req, res) => {
  try {
    const db = await getDb();
    const { nom, quartier, ville, surface, taille, prix_heure, prix_moitie, prix_entier, pourcentage_avance, modele_revenus, commission_pourcentage, abonnement_montant, achat_definitif_montant, latitude, longitude, adresse_theorique, adresse_nominatim, photos, proprietaire_id, commodites, commodite_ids, delai_remboursement_heures } = req.body;
    if (!nom || !prix_heure || !proprietaire_id) return res.status(400).json({ error: 'Nom, prix et proprietaire requis' });
    const prixEntier = Number(prix_entier || prix_heure);
    const prixMoitie = Number(prix_moitie || prixEntier * 0.6);
    const pourcentageAvance = Number(pourcentage_avance || 8);
    const avanceReference = montantAvanceReference(prixEntier, pourcentageAvance);
    const delaiRemboursement = normaliserDelaiHeures(delai_remboursement_heures);
    const result = runSql(db, `INSERT INTO terrains
      (proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_entier, prix_moitie, montant_acompte, acompte, pourcentage_avance, modele_revenus, commission_pourcentage, abonnement_montant, achat_definitif_montant, latitude, longitude, adresse_theorique, adresse_nominatim, photos, description, commodites, is_active, delai_remboursement_heures)
      VALUES (?, ?, ?, ?, 'foot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [proprietaire_id, nom, quartier, ville || 'Dakar', taille || '11v11', prixEntier, prixEntier, prixMoitie, avanceReference, avanceReference, pourcentageAvance, modele_revenus || 'commission', Number(commission_pourcentage || 0), Number(abonnement_montant || 0), Number(achat_definitif_montant || 0), parseCoord(latitude), parseCoord(longitude), adresse_theorique ? String(adresse_theorique).trim() : null, adresse_nominatim ? String(adresse_nominatim).trim() : null, JSON.stringify(photos || []), surface || 'synthetique', typeof commodites === 'string' ? commodites : JSON.stringify(Array.isArray(commodites) ? commodites : []), delaiRemboursement]);
    const terrainId = result.lastInsertRowid;
    const actor = commoditesService.actorFromReq(req);
    let ids = Array.isArray(commodite_ids) ? commodite_ids.map(Number).filter((n) => n > 0) : [];
    if (!ids.length && Array.isArray(commodites)) {
      const catalog = commoditesService.listCommodites(db);
      ids = commodites
        .map((key) => catalog.find((c) => c.cle === String(key))?.id)
        .filter(Boolean)
        .map(Number);
    }
    if (ids.length) {
      commoditesService.setTerrainCommodites(db, terrainId, ids, actor);
    }
    for (const jour of ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']) {
      runSql(db, 'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, 1)', [terrainId, jour, '06:00', '00:00']);
    }
    if ((modele_revenus || 'commission') === 'abonnement') {
      ensurePendingAbonnement(db, terrainId, Number(abonnement_montant || 0));
      saveDb();
    }
    res.status(201).json(queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.patch('/terrains/:id/statut', async (req, res) => {
  const db = await getDb();
  if (!['actif', 'suspendu'].includes(req.body.statut)) return res.status(400).json({ error: 'Statut invalide' });
  const terrainId = Number(req.params.id);
  if (req.body.statut === 'actif' && !terrainAUnePhotoPrincipale(db, terrainId)) {
    return res.status(400).json({ error: 'Au moins une photo principale est requise pour activer le terrain' });
  }
  if (req.body.statut === 'actif') {
    const terrain = queryOne(db, 'SELECT latitude, longitude FROM terrains WHERE id = ?', [terrainId]);
    if (!terrainADesCoordonnees(terrain)) {
      return res.status(400).json({ error: 'La position GPS du terrain est requise pour l\'activer' });
    }
  }
  runSql(db, 'UPDATE terrains SET is_active = ? WHERE id = ?', [req.body.statut === 'actif' ? 1 : 0, terrainId]);
  syncApresModificationTerrain(terrainId, 'statut_terrain', { statut: req.body.statut });
  res.json({ message: `Terrain ${req.body.statut}` });
});

router.patch('/terrains/:id/localisation', async (req, res) => {
  const db = await getDb();
  const terrainId = Number(req.params.id);
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  const lat = parseCoord(req.body?.latitude);
  const lng = parseCoord(req.body?.longitude);
  const adresseTheorique = req.body?.adresse_theorique == null
    ? terrain.adresse_theorique
    : String(req.body.adresse_theorique).trim();
  const adresseNominatim = req.body?.adresse_nominatim == null
    ? terrain.adresse_nominatim
    : String(req.body.adresse_nominatim).trim();
  runSql(
    db,
    'UPDATE terrains SET adresse_theorique = ?, adresse_nominatim = ?, latitude = ?, longitude = ? WHERE id = ?',
    [adresseTheorique || null, adresseNominatim || null, lat, lng, terrainId],
  );
  syncApresModificationTerrain(terrainId, 'localisation', { latitude: lat, longitude: lng });
  res.json(queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]));
});

router.patch('/terrains/:id/politique-annulation', async (req, res) => {
  const db = await getDb();
  const terrainId = Number(req.params.id);
  const terrain = queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  const delai = normaliserDelaiHeures(req.body?.delai_remboursement_heures);
  runSql(db, 'UPDATE terrains SET delai_remboursement_heures = ? WHERE id = ?', [delai, terrainId]);
  syncApresModificationTerrain(terrainId, 'contrat_paiement', { delai_remboursement_heures: delai });
  res.json(queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]));
});

router.get('/terrains/:id/photos', async (req, res) => {
  const db = await getDb();
  const terrainId = Number(req.params.id);
  const terrain = queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json(listTerrainPhotos(db, terrainId));
});

function photoPayloadFromReq(req) {
  const files = req.files && req.files.length ? req.files : (req.file ? [req.file] : []);
  if (files.length) return files.map((file) => ({ buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname, est_principale: req.body?.est_principale === 'true' || req.body?.est_principale === true }));
  return [{ dataUrl: req.body?.dataUrl, est_principale: req.body?.est_principale, ordre: req.body?.ordre, nom_fichier: req.body?.nom_fichier }];
}

router.post('/terrains/:id/photos', (req, res, next) => {
  if (String(req.headers['content-type'] || '').includes('multipart/form-data')) {
    return photoUpload.array('photos', 5)(req, res, next);
  }
  next();
}, async (req, res) => {
  const db = await getDb();
  try {
    const terrainId = Number(req.params.id);
    const payloads = photoPayloadFromReq(req);
    const created = [];
    const actor = commoditesService.actorFromReq(req);
    for (const payload of payloads) {
      const photo = await createTerrainPhoto(db, terrainId, {
        ...payload,
        uploaded_by: actor.id,
        uploaded_by_role: 'super_admin',
      });
      logPhotoAction(db, {
        terrain_id: terrainId,
        photo_id: photo.id,
        action: 'upload',
        fait_par: actor.id,
        role: 'super_admin',
        detail: `Fichier: ${photo.nom_fichier || ''} — ${photo.origWidth || photo.largeur_px}×${photo.origHeight || photo.hauteur_px}px`,
      });
      created.push(photo);
    }
    saveDb();
    syncApresModificationTerrain(terrainId, 'photos');
    res.status(201).json(created.length === 1 ? created[0] : created);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.patch('/terrains/:id/photos/ordre', async (req, res) => {
  const db = await getDb();
  try {
    const terrainId = Number(req.params.id);
    const photos = transaction(db, () => reorderTerrainPhotos(db, terrainId, req.body?.ordre || []));
    syncApresModificationTerrain(terrainId, 'photos');
    res.json(photos);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.patch('/terrains/:id/photos/:photoId/principale', async (req, res) => {
  const db = await getDb();
  try {
    const terrainId = Number(req.params.id);
    const photo = transaction(db, () => setPhotoPrincipale(db, terrainId, Number(req.params.photoId)));
    const actor = commoditesService.actorFromReq(req);
    logPhotoAction(db, {
      terrain_id: terrainId,
      photo_id: photo.id,
      action: 'principale_definie',
      fait_par: actor.id,
      role: 'super_admin',
      detail: `Photo ${photo.id} définie comme principale`,
    });
    saveDb();
    syncApresModificationTerrain(terrainId, 'photos');
    res.json(photo);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.patch('/terrains/:id/photos/:photoId', async (req, res) => {
  const db = await getDb();
  try {
    const terrainId = Number(req.params.id);
    const photo = transaction(db, () => updateTerrainPhoto(db, terrainId, Number(req.params.photoId), req.body || {}));
    syncApresModificationTerrain(terrainId, 'photos');
    res.json(photo);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.delete('/terrains/:id/photos/:photoId', async (req, res) => {
  const db = await getDb();
  try {
    const terrainId = Number(req.params.id);
    const result = transaction(db, () => deleteTerrainPhoto(db, terrainId, Number(req.params.photoId)));
    const actor = commoditesService.actorFromReq(req);
    logPhotoAction(db, {
      terrain_id: terrainId,
      photo_id: result.photo?.id || Number(req.params.photoId),
      action: 'suppression',
      fait_par: actor.id,
      role: 'super_admin',
      detail: `Photo ${result.photo?.nom_fichier || req.params.photoId} supprimée`,
    });
    saveDb();
    syncApresModificationTerrain(terrainId, 'photos');
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.patch('/terrains/:id/tarifs', async (req, res) => {
  const db = await getDb();
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(req.params.id)]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  const prixReference = Number(terrain.prix_entier || terrain.prix_heure || 0);
  const pourcentageAvance = Number(req.body.pourcentage_avance || (req.body.acompte ? (Number(req.body.acompte) * 100) / prixReference : terrain.pourcentage_avance || 8));
  const avanceReference = montantAvanceReference(prixReference, pourcentageAvance);
  const commissionPourcentage = Number(req.body.commission_pourcentage || (req.body.commission ? (Number(req.body.commission) * 100) / avanceReference : terrain.commission_pourcentage || 0));
  const modeleRevenus = req.body.modele_revenus || terrain.modele_revenus || 'commission';
  if (!Number.isFinite(pourcentageAvance) || pourcentageAvance <= 0 || pourcentageAvance > 100 || !Number.isFinite(commissionPourcentage) || commissionPourcentage < 0 || commissionPourcentage > 100 || !['commission', 'abonnement', 'achat_definitif'].includes(modeleRevenus)) {
    return res.status(400).json({ error: 'Tarifs invalides' });
  }
  const commissionReference = Math.round((avanceReference * commissionPourcentage) / 100);
  runSql(db, `UPDATE terrains SET acompte = ?, montant_acompte = ?, commission = ?, pourcentage_avance = ?,
    modele_revenus = ?, commission_pourcentage = ?, abonnement_montant = ?, achat_definitif_montant = ?, achat_definitif_paye = ?
    WHERE id = ?`, [
    avanceReference,
    avanceReference,
    commissionReference,
    pourcentageAvance,
    modeleRevenus,
    commissionPourcentage,
    Number(req.body.abonnement_montant ?? terrain.abonnement_montant ?? 0),
    Number(req.body.achat_definitif_montant ?? terrain.achat_definitif_montant ?? 0),
    Number(req.body.achat_definitif_paye ?? terrain.achat_definitif_paye ?? 0),
    Number(req.params.id),
  ]);
  const abonnementMontant = Number(req.body.abonnement_montant ?? terrain.abonnement_montant ?? 0);
  if (modeleRevenus === 'abonnement') {
    ensurePendingAbonnement(db, Number(req.params.id), abonnementMontant);
    saveDb();
  }
  syncApresModificationTerrain(Number(req.params.id), 'contrat_paiement');
  res.json(queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(req.params.id)]));
});

router.get('/terrains/:id/regles-tarifs', async (req, res) => {
  const db = await getDb();
  const terrainId = Number(req.params.id);
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  res.json({
    terrain_id: terrainId,
    prix_entier_base: Number(terrain.prix_entier || terrain.prix_heure || 0),
    prix_moitie_base: Number(terrain.prix_moitie || 0),
    regles: listRegles(db, terrainId),
    apercu: apercuPrix(db, terrainId),
    grille_standard: grilleFromRegles(listRegles(db, terrainId, { actifsUniquement: true }), {
      prix_entier_base: Number(terrain.prix_entier || terrain.prix_heure || 0),
      prix_moitie_base: Number(terrain.prix_moitie || 0),
    }),
    propositions: listPropositions(db, { terrainId, statut: 'en_attente' }),
  });
});

router.post('/terrains/:id/regles-tarifs', async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
    if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
    const row = creerRegle(db, terrainId, req.body || {});
    res.status(201).json({
      regle: mapRegle(row),
      apercu: apercuPrix(db, terrainId),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.put('/terrains/:id/regles-tarifs/:regleId', async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const row = modifierRegle(db, terrainId, Number(req.params.regleId), req.body || {});
    res.json({
      regle: mapRegle(row),
      apercu: apercuPrix(db, terrainId),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.patch('/terrains/:id/regles-tarifs/:regleId', async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const row = toggleRegle(db, terrainId, Number(req.params.regleId), req.body?.actif);
    res.json({
      regle: mapRegle(row),
      apercu: apercuPrix(db, terrainId),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.delete('/terrains/:id/regles-tarifs/:regleId', async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const result = supprimerRegle(db, terrainId, Number(req.params.regleId));
    res.json({
      ...result,
      apercu: apercuPrix(db, terrainId),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.put('/terrains/:id/grille-tarifs', async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
    if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
    const base = {
      prix_entier_base: Number(terrain.prix_entier || terrain.prix_heure || 0),
      prix_moitie_base: Number(terrain.prix_moitie || 0),
    };
    const applied = appliquerGrille(db, terrainId, req.body || {}, base);
    const { notifyTerrain } = require('../realtimeHub');
    notifyTerrain(terrainId, 'tarifs');
    res.json({
      message: 'Grille tarifaire activée',
      ...applied,
      prix_entier_base: base.prix_entier_base,
      prix_moitie_base: base.prix_moitie_base,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.get('/propositions-tarifs', async (req, res) => {
  const db = await getDb();
  const statut = String(req.query.statut || 'en_attente');
  res.json({ propositions: listPropositions(db, { statut }) });
});

router.post('/propositions-tarifs/:id/valider', async (req, res) => {
  try {
    const db = await getDb();
    const result = validerProposition(db, Number(req.params.id), req.user.id);
    const terrainId = result?.proposition?.terrain_id || result?.regles?.[0]?.terrain_id;
    if (terrainId) {
      const { notifyTerrain } = require('../realtimeHub');
      notifyTerrain(terrainId, 'tarifs');
    }
    res.json({ message: 'Grille tarifaire activée', ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.post('/propositions-tarifs/:id/refuser', async (req, res) => {
  try {
    const db = await getDb();
    const proposition = refuserProposition(db, Number(req.params.id), req.user.id, req.body?.commentaire);
    res.json({ message: 'Proposition refusée', proposition });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.post('/abonnements/:id/payer', async (req, res) => {
  const db = await getDb();
  try {
    const abonnement = transaction(db, () => marquerAbonnementPaye(db, Number(req.params.id)));
    res.json({ abonnement, message: 'Abonnement marque comme paye' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.post('/terrains/:id/achat-definitif/payer', async (req, res) => {
  const db = await getDb();
  try {
    const terrain = transaction(db, () => marquerAchatDefinitifPaye(db, Number(req.params.id), req.body?.montant));
    res.json({ terrain, message: 'Achat definitif marque comme paye' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.get('/users', async (req, res) => {
  const db = await getDb();
  const proprietaires = queryAll(db, `SELECT id, nom, telephone, email, statut, must_change_password,
    'proprietaire' AS role, NULL AS terrain_id FROM proprietaires`);
  const gerants = queryAll(db, `SELECT e.id, e.nom, e.telephone, e.email, e.is_active AS statut, e.must_change_password,
    'gerant' AS role, e.terrain_id, t.nom AS terrain_nom FROM employes e LEFT JOIN terrains t ON t.id = e.terrain_id`);
  res.json([...proprietaires, ...gerants]);
});

router.post('/users', async (req, res) => {
  try {
    const db = await getDb();
    const { nom, telephone, role, terrain_id } = req.body;
    if (!nom || !telephone || !['gerant', 'proprietaire'].includes(role)) return res.status(400).json({ error: 'Donnees invalides' });
    if (role === 'gerant' && !terrain_id) return res.status(400).json({ error: 'Terrain obligatoire pour un gerant' });
    const temporaryPassword = crypto.randomBytes(6).toString('base64url');
    const passwordHash = bcrypt.hashSync(temporaryPassword, 12);
    const email = req.body.email || `${role}-${Date.now()}@terrainsn.local`;
    let id;
    transaction(db, () => {
      if (role === 'proprietaire') {
        db.run(`INSERT INTO proprietaires (nom, email, telephone, password_hash, statut, must_change_password)
          VALUES (?, ?, ?, ?, 'actif', 1)`, [nom, email, telephone, passwordHash]);
        id = queryOne(db, 'SELECT last_insert_rowid() AS id').id;
        if (terrain_id) db.run('UPDATE terrains SET proprietaire_id = ? WHERE id = ?', [id, terrain_id]);
      } else {
        const terrain = queryOne(db, 'SELECT proprietaire_id FROM terrains WHERE id = ?', [terrain_id]);
        if (!terrain) throw new Error('Terrain introuvable');
        db.run(`INSERT INTO employes (proprietaire_id, terrain_id, nom, email, telephone, whatsapp_number, password_hash, is_active, must_change_password)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`, [terrain.proprietaire_id, terrain_id, nom, email, telephone, telephone, passwordHash]);
        id = queryOne(db, 'SELECT last_insert_rowid() AS id').id;
      }
    });
    await envoyerAcces({ telephone, motDePasse: temporaryPassword, role });
    res.status(201).json({ id, nom, telephone, role, terrain_id, must_change_password: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.get('/revenus', async (req, res) => {
  const db = await getDb();
  const period = req.query.periode === 'semaine' ? 7 : req.query.periode === 'annee' ? 365 : 31;
  const start = new Date(); start.setDate(start.getDate() - period + 1);
  const from = start.toISOString().slice(0, 10);
  const rows = queryAll(db, `SELECT t.id, t.nom, COUNT(r.id) AS reservations,
    COALESCE(SUM(CASE WHEN r.statut = 'joue' THEN r.prix_total ELSE 0 END), 0) AS revenu
    FROM terrains t LEFT JOIN reservations r ON r.terrain_id = t.id AND r.date >= ?
    GROUP BY t.id, t.nom ORDER BY revenu DESC`, [from]);
  res.json({ periode: req.query.periode || 'mois', depuis: from, total: rows.reduce((sum, row) => sum + Number(row.revenu), 0), terrains: rows });
});

router.get('/finances', async (req, res) => {
  const db = await getDb();
  const totals = queryOne(db, `SELECT
    COALESCE(SUM(montant_acompte), 0) AS total_acomptes,
    COALESCE(SUM(montant_commission), 0) AS total_commissions,
    COALESCE(SUM(montant_reverse), 0) AS total_reverse
    FROM paiements
    WHERE statut = 'paye'`) || {};
  const terrains = queryAll(db, `SELECT t.id, t.nom,
    COALESCE(SUM(p.montant_acompte), 0) AS acomptes,
    COALESCE(SUM(p.montant_commission), 0) AS commissions,
    COALESCE(SUM(p.montant_reverse), 0) AS reverse
    FROM terrains t
    LEFT JOIN reservations r ON r.terrain_id = t.id
    LEFT JOIN paiements p ON p.reservation_id = r.id AND p.statut = 'paye'
    GROUP BY t.id, t.nom
    ORDER BY commissions DESC`);
  res.json({
    total_acomptes: Number(totals.total_acomptes || 0),
    total_avances: Number(totals.total_acomptes || 0),
    total_commissions: Number(totals.total_commissions || 0),
    total_reverse: Number(totals.total_reverse || 0),
    dettes: detteService.resumeSuperadminMois(db),
    terrains: terrains.map((terrain) => ({ ...terrain, avances: Number(terrain.acomptes || 0) })),
  });
});

router.get('/dettes', async (req, res) => {
  const db = await getDb();
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  const periode = String(req.query.periode || '').trim();
  const now = new Date();
  let periodeKey = detteService.periodeCivile(now);
  if (periode === 'prev' || periode === 'mois_precedent') {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    periodeKey = detteService.periodeCivile(prev);
  } else if (/^\d{4}-\d{2}$/.test(periode)) {
    periodeKey = periode;
  }
  res.json(detteService.listDettesAdmin(db, {
    periode: periodeKey,
    terrainId: req.query.terrain_id ? Number(req.query.terrain_id) : null,
    statut: req.query.statut || null,
  }));
});

router.patch('/dettes/instructions', async (req, res) => {
  const db = await getDb();
  transaction(db, () => {
    detteService.setSetting(db, 'dette_instructions', req.body?.texte || req.body?.instructions || '');
  });
  res.json({ success: true, instructions: detteService.instructionsPaiementDette(db) });
});

router.patch('/dettes/:terrain_id/remise-a-zero', async (req, res) => {
  const db = await getDb();
  try {
    const periode = String(req.body?.periode || '').trim();
    const periodeKey = /^\d{4}-\d{2}$/.test(periode) ? periode : detteService.periodeCivile();
    const result = transaction(db, () => detteService.remiseAZero(db, {
      terrainId: Number(req.params.terrain_id),
      superAdminId: req.user.id,
      note: req.body?.note,
      montantRecu: req.body?.montant_recu,
      periode: periodeKey,
    }));
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.get('/abonnements', async (req, res) => {
  const db = await getDb();
  transaction(db, () => {
    appliquerSuspensionsAbonnements(db);
  });
  res.json({ grace_days: GRACE_DAYS, abonnements: abonnementsAvecEtat(db) });
});

router.get('/commodites', async (req, res) => {
  const db = await getDb();
  res.json(commoditesService.listCommodites(db));
});

router.post('/commodites', async (req, res) => {
  const db = await getDb();
  try {
    const created = transaction(db, () => commoditesService.createCommodite(db, req.body || {}, commoditesService.actorFromReq(req)));
    res.status(201).json(created);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.patch('/commodites/:id', async (req, res) => {
  const db = await getDb();
  try {
    const updated = transaction(db, () => commoditesService.updateCommodite(db, Number(req.params.id), req.body || {}, commoditesService.actorFromReq(req)));
    res.json(updated);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.delete('/commodites/:id', async (req, res) => {
  const db = await getDb();
  try {
    const updated = transaction(db, () => commoditesService.softDeleteCommodite(db, Number(req.params.id), commoditesService.actorFromReq(req)));
    res.json(updated);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.get('/terrains/:id/commodites', async (req, res) => {
  const db = await getDb();
  const terrain = queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [Number(req.params.id)]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  res.json(commoditesService.listTerrainCommodites(db, terrain.id));
});

router.put('/terrains/:id/commodites', async (req, res) => {
  const db = await getDb();
  try {
    const terrainId = Number(req.params.id);
    const terrain = queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [terrainId]);
    if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
    const list = transaction(db, () => commoditesService.setTerrainCommodites(
      db,
      terrainId,
      req.body?.commodite_ids || [],
      { ...commoditesService.actorFromReq(req), forceIds: req.body?.force_ids || [] },
    ));
    syncApresModificationTerrain(terrainId, 'equipements');
    res.json(list);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

function parseAuditFilters(query) {
  return {
    terrain_id: query.terrain_id ? Number(query.terrain_id) : undefined,
    role: query.role || undefined,
    action: query.action || undefined,
    depuis: query.depuis || undefined,
    jusqua: query.jusqua || undefined,
    limit: Math.min(200, Number(query.limit || 50) || 50),
    offset: Number(query.offset || 0) || 0,
  };
}

router.get('/terrains/:id/audit', async (req, res) => {
  const db = await getDb();
  const terrainId = Number(req.params.id);
  const filters = { ...parseAuditFilters(req.query), terrain_id: terrainId, limit: 200, offset: 0 };
  res.json({
    photos: listAuditPhotos(db, filters),
    commodites: listAuditCommodites(db, filters),
  });
});

router.get('/audit/photos-commodites', async (req, res) => {
  const db = await getDb();
  const type = String(req.query.type || 'tout');
  const filters = parseAuditFilters(req.query);
  const photos = type === 'commodites' ? [] : listAuditPhotos(db, filters);
  const commodites = type === 'photos' ? [] : listAuditCommodites(db, filters);
  res.json({ photos, commodites });
});

router.get('/terrains/:id/essai', async (req, res) => {
  const db = await getDb();
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(req.params.id)]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  res.json(essaiService.publicEssai(terrain));
});

router.patch('/terrains/:id/essai', async (req, res) => {
  const db = await getDb();
  const id = Number(req.params.id);
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [id]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  const action = String(req.body?.action || '');
  const today = essaiService.ymd(new Date());
  try {
    transaction(db, () => {
      if (action === 'activer') {
        const duree = Math.max(1, Number(req.body?.essai_duree_jours || 30));
        const nego = Math.max(0, Number(req.body?.delai_negociation_jours || 7));
        const fin = essaiService.addDays(today, duree);
        runSql(db, `UPDATE terrains SET mode_essai = 1, essai_debut_at = ?, essai_duree_jours = ?, essai_fin_at = ?,
          delai_negociation_jours = ?, essai_suspendu_auto = 0, notif_essai_fin_j7 = 0, notif_essai_fin_j3 = 0, notif_essai_fin_j1 = 0 WHERE id = ?`,
          [today, duree, fin, nego, id]);
      } else if (action === 'production' || action === 'desactiver') {
        runSql(db, 'UPDATE terrains SET mode_essai = 0, essai_fin_at = COALESCE(essai_fin_at, ?) WHERE id = ?', [today, id]);
      } else if (action === 'modifier') {
        const duree = Math.max(1, Number(req.body?.essai_duree_jours || terrain.essai_duree_jours || 30));
        const nego = Math.max(0, Number(req.body?.delai_negociation_jours || terrain.delai_negociation_jours || 7));
        const debut = String(terrain.essai_debut_at || today).slice(0, 10);
        const fin = essaiService.addDays(debut, duree);
        runSql(db, 'UPDATE terrains SET essai_duree_jours = ?, delai_negociation_jours = ?, essai_fin_at = ? WHERE id = ?', [duree, nego, fin, id]);
      } else if (action === 'delai') {
        const extra = Math.max(1, Number(req.body?.jours || 7));
        const nego = Number(terrain.delai_negociation_jours || 7) + extra;
        runSql(db, 'UPDATE terrains SET delai_negociation_jours = ? WHERE id = ?', [nego, id]);
      } else if (action === 'reactiver-essai') {
        const duree = Math.max(1, Number(req.body?.essai_duree_jours || 30));
        const nego = Math.max(0, Number(req.body?.delai_negociation_jours || 7));
        const fin = essaiService.addDays(today, duree);
        runSql(db, `UPDATE terrains SET mode_essai = 1, essai_suspendu_auto = 0, is_active = 1, essai_debut_at = ?, essai_duree_jours = ?, essai_fin_at = ?, delai_negociation_jours = ? WHERE id = ?`,
          [today, duree, fin, nego, id]);
      } else if (action === 'reactiver-production') {
        runSql(db, 'UPDATE terrains SET mode_essai = 0, essai_suspendu_auto = 0, is_active = 1 WHERE id = ?', [id]);
      } else {
        const err = new Error('Action essai inconnue');
        err.statusCode = 400;
        throw err;
      }
    });
    const next = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [id]);
    res.json(essaiService.publicEssai(next));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.get('/essai-kpis', async (req, res) => {
  const db = await getDb();
  const terrains = queryAll(db, 'SELECT * FROM terrains');
  const items = terrains.map((t) => ({ id: t.id, nom: t.nom, ...essaiService.publicEssai(t) }));
  const actifs = items.filter((t) => t.etat === 'actif');
  const expires = items.filter((t) => t.etat === 'expire');
  const proches = actifs.filter((t) => t.jours_restants <= 7);
  res.json({
    actifs: actifs.length,
    proches: proches.length,
    expires: expires.length,
    suspendus: items.filter((t) => t.etat === 'suspendu').length,
    proches_list: proches,
    expires_list: expires,
  });
});

router.get('/terrains/:id/features', async (req, res) => {
  const db = await getDb();
  const terrain = queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [Number(req.params.id)]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  res.json(terrainFeaturesService.listFeatures(db, terrain.id));
});

router.put('/terrains/:id/features', async (req, res) => {
  const db = await getDb();
  const terrainId = Number(req.params.id);
  const terrain = queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  const list = transaction(db, () => terrainFeaturesService.saveFeatures(db, terrainId, req.body?.features || [], req.user?.id));
  res.json(list);
});

router.get('/whatsapp/status', async (req, res) => {
  const whatsappClient = require('../whatsappClient');
  res.json(await whatsappClient.getStatus('platform'));
});

router.get('/whatsapp/qr', async (req, res) => {
  const whatsappClient = require('../whatsappClient');
  res.json(await whatsappClient.getQrPayload('platform'));
});

router.post('/whatsapp/connect', async (req, res) => {
  const whatsappClient = require('../whatsappClient');
  const started = await whatsappClient.ensureStarted('platform', { force: Boolean(req.body?.force) });
  const qr = await whatsappClient.getQrPayload('platform');
  res.json({ ...started, ...qr });
});

router.post('/whatsapp/disconnect', async (req, res) => {
  const whatsappClient = require('../whatsappClient');
  res.json(await whatsappClient.logoutSession('platform'));
});

router.post('/whatsapp/test', async (req, res) => {
  const whatsappClient = require('../whatsappClient');
  const raw = String(req.body?.telephone || '').replace(/\D/g, '');
  const digits = raw.length === 9 && raw.startsWith('7') ? `221${raw}` : raw;
  try {
    await whatsappClient.sendTextForSession('platform', `${digits}@c.us`, '✅ Test TerrainSN — notifications WhatsApp actives.');
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message || 'Envoi impossible' });
  }
});

router.get('/mode-revenu/defaults', async (req, res) => {
  const db = await getDb();
  res.json(modeRevenuService.getDefaults(db));
});

router.patch('/mode-revenu/defaults', async (req, res) => {
  const db = await getDb();
  try {
    const next = transaction(db, () => modeRevenuService.saveDefaults(db, req.body || {}));
    res.json(next);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Enregistrement impossible' });
  }
});

router.get('/mode-revenu/history', async (req, res) => {
  const db = await getDb();
  res.json(modeRevenuService.listHistory(db));
});

router.patch('/terrains/:id/mode-revenu', async (req, res) => {
  const db = await getDb();
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(req.params.id)]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  try {
    const next = transaction(db, () => modeRevenuService.applyMode(db, terrain, req.body || {}, req.user?.id));
    res.json(modeRevenuService.enrichTerrain(next));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

module.exports = router;
