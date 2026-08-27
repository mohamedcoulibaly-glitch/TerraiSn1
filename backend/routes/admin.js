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
const { normaliserDelaiVerrouPaiementMin } = require('../reservationLockService');
const detteService = require('../services/detteCommissionService');
const commoditesService = require('../services/commoditesService');
const { logPhotoAction, listAuditPhotos } = require('../services/auditPhotos');
const { listAuditCommodites } = require('../services/auditCommodites');
const essaiService = require('../services/essaiService');
const terrainFeaturesService = require('../services/terrainFeaturesService');
const modeRevenuService = require('../services/modeRevenuService');
const { registerAdminGerantsRoutes } = require('./multiGerants');

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
    const user = ((await queryAll(db, "SELECT * FROM users WHERE (role = 'super_admin' OR role = 'superadmin') AND is_active = 1")).find((item) => String(item.telephone || '').replace(/\D/g, '') === normalized));
    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return res.status(401).json({ error: 'Acces refuse' });
    const token = jwt.sign({ id: user.id, telephone: user.telephone, role: 'super_admin', accountType: 'user' }, process.env.JWT_SECRET || 'terrainsn_secret_key_2026', { expiresIn: '8h' });
    res.json({ token, user: { id: user.id, nom: user.nom, telephone: user.telephone, role: 'super_admin', accountType: 'user' } });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.use(authMiddleware, requireRole('super_admin'));

registerAdminGerantsRoutes(router);

router.get('/dashboard', async (req, res) => {
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  res.json({
    terrainsActifs: ((await queryOne(db, 'SELECT COUNT(*) AS total FROM terrains WHERE is_active = 1')).total),
    reservationsAujourdhui: ((await queryOne(db, 'SELECT COUNT(*) AS total FROM reservations WHERE date = ?', [today])).total),
    revenusMois: ((await queryOne(db, "SELECT COALESCE(SUM(prix_total), 0) AS total FROM reservations WHERE statut = 'joue' AND substr(date, 1, 7) = ?", [month])).total),
  });
});

router.get('/profile', async (req, res) => {
  const db = await getDb();
  const account = await queryOne(db, `SELECT id, nom, email, telephone, role, is_active, created_at
    FROM users WHERE id = ?`, [req.user.id]);
  const month = new Date().toISOString().slice(0, 7);
  const summary = {
    terrains_total: ((await queryOne(db, 'SELECT COUNT(*) AS total FROM terrains')).total),
    terrains_actifs: ((await queryOne(db, 'SELECT COUNT(*) AS total FROM terrains WHERE is_active = 1')).total),
    proprietaires: ((await queryOne(db, 'SELECT COUNT(*) AS total FROM proprietaires')).total),
    gerants: ((await queryOne(db, 'SELECT COUNT(*) AS total FROM employes')).total),
    reservations_jouees_mois: ((await queryOne(db, "SELECT COUNT(*) AS total FROM reservations WHERE statut IN ('joue','match_joue') AND substr(date, 1, 7) = ?", [month])).total),
    avances_mois: ((await queryOne(db, `SELECT COALESCE(SUM(p.montant_acompte), 0) AS total
      FROM paiements p
      JOIN reservations r ON r.id = p.reservation_id
      WHERE p.statut = 'paye'
        AND r.statut IN ('joue','match_joue')
        AND substr(r.date, 1, 7) = ?`, [month])).total),
    commissions_mois: ((await queryOne(db, `SELECT COALESCE(SUM(p.montant_commission), 0) AS total
      FROM paiements p
      JOIN reservations r ON r.id = p.reservation_id
      WHERE p.statut = 'paye'
        AND r.statut IN ('joue','match_joue')
        AND substr(r.date, 1, 7) = ?`, [month])).total),
    abonnements_en_retard: ((await queryOne(db, "SELECT COUNT(*) AS total FROM abonnements WHERE statut = 'en_retard'")).total),
  };
  const recentTerrains = await queryAll(db, `SELECT t.id, t.nom, t.ville, t.is_active, t.modele_revenus, p.nom AS proprietaire_nom
    FROM terrains t
    LEFT JOIN proprietaires p ON p.id = t.proprietaire_id
    ORDER BY t.created_at DESC
    LIMIT 6`);
  res.json({ account, summary, recentTerrains });
});

router.get('/terrains', async (req, res) => {
  const db = await getDb();
  res.json(await queryAll(db, `SELECT t.*, p.nom AS proprietaire_nom,
      (SELECT h.heure_debut FROM horaires h WHERE h.terrain_id = t.id AND h.est_ouvert = 1 ORDER BY h.id ASC LIMIT 1) AS heure_debut_typique,
      (SELECT h.heure_fin FROM horaires h WHERE h.terrain_id = t.id AND h.est_ouvert = 1 ORDER BY h.id ASC LIMIT 1) AS heure_fin_typique
    FROM terrains t
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
    const result = await runSql(db, `INSERT INTO terrains
      (proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_entier, prix_moitie, montant_acompte, acompte, pourcentage_avance, modele_revenus, commission_pourcentage, abonnement_montant, achat_definitif_montant, latitude, longitude, adresse_theorique, adresse_nominatim, photos, description, commodites, is_active, delai_remboursement_heures)
      VALUES (?, ?, ?, ?, 'foot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [proprietaire_id, nom, quartier, ville || 'Dakar', taille || '11v11', prixEntier, prixEntier, prixMoitie, avanceReference, avanceReference, pourcentageAvance, modele_revenus || 'commission', Number(commission_pourcentage || 0), Number(abonnement_montant || 0), Number(achat_definitif_montant || 0), parseCoord(latitude), parseCoord(longitude), adresse_theorique ? String(adresse_theorique).trim() : null, adresse_nominatim ? String(adresse_nominatim).trim() : null, JSON.stringify(photos || []), surface || 'synthetique', typeof commodites === 'string' ? commodites : JSON.stringify(Array.isArray(commodites) ? commodites : []), delaiRemboursement]);
    const terrainId = result.lastInsertRowid;
    const actor = commoditesService.actorFromReq(req);
    let ids = Array.isArray(commodite_ids) ? commodite_ids.map(Number).filter((n) => n > 0) : [];
    if (!ids.length && Array.isArray(commodites)) {
      const catalog = await commoditesService.listCommodites(db);
      ids = commodites
        .map((key) => catalog.find((c) => c.cle === String(key))?.id)
        .filter(Boolean)
        .map(Number);
    }
    if (ids.length) {
      await commoditesService.setTerrainCommodites(db, terrainId, ids, actor);
    }
    for (const jour of ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']) {
      await runSql(db, 'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, 1)', [terrainId, jour, '06:00', '03:00']);
    }
    if ((modele_revenus || 'commission') === 'abonnement') {
      await ensurePendingAbonnement(db, terrainId, Number(abonnement_montant || 0));
      saveDb();
    }
    res.status(201).json(await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.patch('/terrains/:id/statut', async (req, res) => {
  const db = await getDb();
  if (!['actif', 'suspendu'].includes(req.body.statut)) return res.status(400).json({ error: 'Statut invalide' });
  const terrainId = Number(req.params.id);
  if (req.body.statut === 'actif' && !(await terrainAUnePhotoPrincipale(db, terrainId))) {
    return res.status(400).json({ error: 'Au moins une photo principale est requise pour activer le terrain' });
  }
  if (req.body.statut === 'actif') {
    const terrain = await queryOne(db, 'SELECT latitude, longitude FROM terrains WHERE id = ?', [terrainId]);
    if (!terrainADesCoordonnees(terrain)) {
      return res.status(400).json({ error: 'La position GPS du terrain est requise pour l\'activer' });
    }
  }
  await runSql(db, 'UPDATE terrains SET is_active = ? WHERE id = ?', [req.body.statut === 'actif' ? 1 : 0, terrainId]);
  syncApresModificationTerrain(terrainId, 'statut_terrain', { statut: req.body.statut });
  res.json({ message: `Terrain ${req.body.statut}` });
});

router.patch('/terrains/:id/localisation', async (req, res) => {
  const db = await getDb();
  const terrainId = Number(req.params.id);
  const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  const lat = parseCoord(req.body?.latitude);
  const lng = parseCoord(req.body?.longitude);
  const adresseTheorique = req.body?.adresse_theorique == null
    ? terrain.adresse_theorique
    : String(req.body.adresse_theorique).trim();
  const adresseNominatim = req.body?.adresse_nominatim == null
    ? terrain.adresse_nominatim
    : String(req.body.adresse_nominatim).trim();
  await runSql(
    db,
    'UPDATE terrains SET adresse_theorique = ?, adresse_nominatim = ?, latitude = ?, longitude = ? WHERE id = ?',
    [adresseTheorique || null, adresseNominatim || null, lat, lng, terrainId],
  );
  syncApresModificationTerrain(terrainId, 'localisation', { latitude: lat, longitude: lng });
  res.json(await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]));
});

router.patch('/terrains/:id/politique-annulation', async (req, res) => {
  const db = await getDb();
  const terrainId = Number(req.params.id);
  const terrain = await queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  const delai = normaliserDelaiHeures(req.body?.delai_remboursement_heures);
  await runSql(db, 'UPDATE terrains SET delai_remboursement_heures = ? WHERE id = ?', [delai, terrainId]);
  syncApresModificationTerrain(terrainId, 'contrat_paiement', { delai_remboursement_heures: delai });
  res.json(await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]));
});

/** Politique de paiement ('avance' | 'sans_avance') + délai dette commission */
router.patch('/terrains/:id/politique-paiement', async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = await queryOne(
      db,
      'SELECT id, politique_paiement, delai_paiement_dette_jours FROM terrains WHERE id = ?',
      [terrainId],
    );
    if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });

    const body = req.body || {};
    let politique = body.politique_paiement != null
      ? String(body.politique_paiement).trim()
      : String(terrain.politique_paiement || 'avance');
    if (politique === 'avec_avance') politique = 'avance';
    if (!['avance', 'sans_avance'].includes(politique)) {
      return res.status(400).json({ error: "politique_paiement doit être 'avance' ou 'sans_avance'" });
    }

    let delai = body.delai_paiement_dette_jours != null
      ? Number(body.delai_paiement_dette_jours)
      : Number(terrain.delai_paiement_dette_jours || 30);
    if (!Number.isFinite(delai) || delai < 7 || delai > 90) {
      return res.status(400).json({ error: 'delai_paiement_dette_jours doit être entre 7 et 90' });
    }
    delai = Math.round(delai);

    await runSql(
      db,
      `UPDATE terrains SET politique_paiement = ?, delai_paiement_dette_jours = ? WHERE id = ?`,
      [politique, delai, terrainId],
    );

    try {
      await runSql(
        db,
        `INSERT INTO audit_logs (acteur_type, acteur_id, action, table_cible, enregistrement_id, details)
         VALUES (?, ?, ?, 'terrains', ?, ?)`,
        [
          req.user?.role || 'super_admin',
          req.user?.id || null,
          'politique_paiement',
          terrainId,
          JSON.stringify({
            avant: {
              politique_paiement: terrain.politique_paiement,
              delai_paiement_dette_jours: terrain.delai_paiement_dette_jours,
            },
            apres: { politique_paiement: politique, delai_paiement_dette_jours: delai },
          }),
        ],
      );
    } catch (_) {
      /* table audit_logs optionnelle selon l'environnement */
    }

    try {
      syncApresModificationTerrain(terrainId, 'contrat_paiement', {
        politique_paiement: politique,
        delai_paiement_dette_jours: delai,
      });
    } catch (_) {
      /* sync optionnel */
    }

    res.json(await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

/** Délai d'indisponibilité du créneau pendant l'attente de confirmation paiement (minutes). */
router.patch('/terrains/:id/delai-verrou-paiement', async (req, res) => {
  const db = await getDb();
  const terrainId = Number(req.params.id);
  const terrain = await queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  const delai = normaliserDelaiVerrouPaiementMin(req.body?.delai_verrou_paiement_min);
  await runSql(db, 'UPDATE terrains SET delai_verrou_paiement_min = ? WHERE id = ?', [delai, terrainId]);
  syncApresModificationTerrain(terrainId, 'contrat_paiement', { delai_verrou_paiement_min: delai });
  res.json(await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]));
});

router.get('/terrains/:id/photos', async (req, res) => {
  const db = await getDb();
  const terrainId = Number(req.params.id);
  const terrain = await queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json(await listTerrainPhotos(db, terrainId));
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
      await logPhotoAction(db, {
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
    const photos = await transaction(db, async () => await reorderTerrainPhotos(db, terrainId, req.body?.ordre || []));
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
    const photo = await transaction(db, async () => await setPhotoPrincipale(db, terrainId, Number(req.params.photoId)));
    const actor = commoditesService.actorFromReq(req);
    await logPhotoAction(db, {
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
    const photo = await transaction(db, async () => await updateTerrainPhoto(db, terrainId, Number(req.params.photoId), req.body || {}));
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
    const result = await transaction(db, async () => await deleteTerrainPhoto(db, terrainId, Number(req.params.photoId)));
    const actor = commoditesService.actorFromReq(req);
    await logPhotoAction(db, {
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
  const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(req.params.id)]);
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
  await runSql(db, `UPDATE terrains SET acompte = ?, montant_acompte = ?, commission = ?, pourcentage_avance = ?,
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
    await ensurePendingAbonnement(db, Number(req.params.id), abonnementMontant);
    saveDb();
  }
  syncApresModificationTerrain(Number(req.params.id), 'contrat_paiement');
  res.json(await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(req.params.id)]));
});

router.get('/terrains/:id/regles-tarifs', async (req, res) => {
  const db = await getDb();
  const terrainId = Number(req.params.id);
  const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  res.json({
    terrain_id: terrainId,
    prix_entier_base: Number(terrain.prix_entier || terrain.prix_heure || 0),
    prix_moitie_base: Number(terrain.prix_moitie || 0),
    regles: await listRegles(db, terrainId),
    apercu: await apercuPrix(db, terrainId),
    grille_standard: grilleFromRegles(await listRegles(db, terrainId, { actifsUniquement: true }), {
      prix_entier_base: Number(terrain.prix_entier || terrain.prix_heure || 0),
      prix_moitie_base: Number(terrain.prix_moitie || 0),
    }),
    propositions: await listPropositions(db, { terrainId, statut: 'en_attente' }),
  });
});

router.post('/terrains/:id/regles-tarifs', async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
    if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
    const row = await creerRegle(db, terrainId, req.body || {});
    res.status(201).json({
      regle: mapRegle(row),
      apercu: await apercuPrix(db, terrainId),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.put('/terrains/:id/regles-tarifs/:regleId', async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const row = await modifierRegle(db, terrainId, Number(req.params.regleId), req.body || {});
    res.json({
      regle: mapRegle(row),
      apercu: await apercuPrix(db, terrainId),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.patch('/terrains/:id/regles-tarifs/:regleId', async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const row = await toggleRegle(db, terrainId, Number(req.params.regleId), req.body?.actif);
    res.json({
      regle: mapRegle(row),
      apercu: await apercuPrix(db, terrainId),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.delete('/terrains/:id/regles-tarifs/:regleId', async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const result = await supprimerRegle(db, terrainId, Number(req.params.regleId));
    res.json({
      ...result,
      apercu: await apercuPrix(db, terrainId),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.put('/terrains/:id/grille-tarifs', async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
    if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
    const base = {
      prix_entier_base: Number(terrain.prix_entier || terrain.prix_heure || 0),
      prix_moitie_base: Number(terrain.prix_moitie || 0),
    };
    const applied = await appliquerGrille(db, terrainId, req.body || {}, base);
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

router.get('/terrains/:id/formats', async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const formatsService = require('../services/formatsTerrainService');
    const [formats, durees] = await Promise.all([
      formatsService.listFormats(db, terrainId),
      formatsService.listDurees(db, terrainId),
    ]);
    res.json({ formats, durees });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.put('/terrains/:id/formats', async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const formatsService = require('../services/formatsTerrainService');
    const result = await formatsService.replaceFormatsEtDurees(db, terrainId, {
      formats: req.body?.formats,
      durees: req.body?.durees,
    });
    const { notifyTerrain } = require('../realtimeHub');
    notifyTerrain(terrainId, 'tarifs');
    res.json({ message: 'Formats et durées enregistrés', ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.get('/propositions-tarifs', async (req, res) => {
  const db = await getDb();
  const statut = String(req.query.statut || 'en_attente');
  res.json({ propositions: await listPropositions(db, { statut }) });
});

router.post('/propositions-tarifs/:id/valider', async (req, res) => {
  try {
    const db = await getDb();
    const result = await validerProposition(db, Number(req.params.id), req.user.id);
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
    const proposition = await refuserProposition(db, Number(req.params.id), req.user.id, req.body?.commentaire);
    res.json({ message: 'Proposition refusée', proposition });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.post('/abonnements/:id/payer', async (req, res) => {
  const db = await getDb();
  try {
    const abonnement = await transaction(db, async () => await marquerAbonnementPaye(db, Number(req.params.id)));
    res.json({ abonnement, message: 'Abonnement marque comme paye' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.post('/terrains/:id/achat-definitif/payer', async (req, res) => {
  const db = await getDb();
  try {
    const terrain = await transaction(db, async () => await marquerAchatDefinitifPaye(db, Number(req.params.id), req.body?.montant));
    res.json({ terrain, message: 'Achat definitif marque comme paye' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.get('/users', async (req, res) => {
  const db = await getDb();
  const proprietaires = await queryAll(db, `SELECT id, nom, prenom, telephone, email, statut, must_change_password,
    'proprietaire' AS role, NULL AS terrain_id FROM proprietaires`);
  const gerants = await queryAll(db, `SELECT e.id, e.nom, e.prenom, e.telephone, e.email, e.is_active AS statut, e.must_change_password,
    'gerant' AS role, e.terrain_id, t.nom AS terrain_nom FROM employes e LEFT JOIN terrains t ON t.id = e.terrain_id`);
  const superadmins = await queryAll(db, `SELECT id, nom, prenom, telephone, email, is_active AS statut, must_change_password,
    'super_admin' AS role, NULL AS terrain_id FROM users
    WHERE role IN ('super_admin', 'superadmin')`);
  res.json([...superadmins, ...proprietaires, ...gerants]);
});

// ─── Propriétaires CRUD ─────────────────────────────────────────────
router.get('/proprietaires', async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db, `
      SELECT p.*,
        (SELECT COUNT(*) FROM terrains t WHERE t.proprietaire_id = p.id) AS nb_terrains,
        (SELECT COUNT(*) FROM employes e WHERE e.proprietaire_id = p.id AND e.is_active = 1) AS nb_gerants
      FROM proprietaires p
      ORDER BY p.created_at DESC, p.id DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/proprietaires', async (req, res) => {
  try {
    const db = await getDb();
    const { nom, prenom, telephone, email, terrain_id } = req.body || {};
    if (!nom || !telephone) return res.status(400).json({ error: 'Nom et téléphone requis' });

    const telDigits = String(telephone).replace(/\D/g, '');
    const existing = ((await queryAll(db, 'SELECT id, telephone FROM proprietaires')).find(
      (p) => String(p.telephone || '').replace(/\D/g, '') === telDigits,
    ));
    if (existing) return res.status(409).json({ error: 'Un propriétaire avec ce téléphone existe déjà' });

    const temporaryPassword = crypto.randomBytes(6).toString('base64url');
    const passwordHash = bcrypt.hashSync(temporaryPassword, 12);
    const mail = email || `proprietaire-${Date.now()}@terrainsn.local`;

    let id;
    await transaction(db, async () => {
      const insertResult = await runSql(db,
        `INSERT INTO proprietaires (nom, prenom, email, telephone, password_hash, statut, must_change_password)
         VALUES (?, ?, ?, ?, ?, 'actif', 1)`,
        [nom, prenom || null, mail, telephone, passwordHash],
      );
      id = insertResult.lastInsertRowid;
      if (terrain_id) {
        await runSql(db, 'UPDATE terrains SET proprietaire_id = ? WHERE id = ?', [id, Number(terrain_id)]);
      }
    });

    try {
      await envoyerAcces({ telephone, motDePasse: temporaryPassword, role: 'proprietaire' });
    } catch (waErr) {
      console.warn('[admin] Accès propriétaire créé mais WhatsApp échoué:', waErr.message);
    }

    const row = await queryOne(db, 'SELECT * FROM proprietaires WHERE id = ?', [id]);
    res.status(201).json({ ...row, role: 'proprietaire', temporary_password_sent: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.patch('/proprietaires/:id', async (req, res) => {
  try {
    const db = await getDb();
    const id = Number(req.params.id);
    const current = await queryOne(db, 'SELECT * FROM proprietaires WHERE id = ?', [id]);
    if (!current) return res.status(404).json({ error: 'Propriétaire introuvable' });

    const nom = req.body.nom !== undefined ? req.body.nom : current.nom;
    const prenom = req.body.prenom !== undefined ? req.body.prenom : current.prenom;
    const telephone = req.body.telephone !== undefined ? req.body.telephone : current.telephone;
    const email = req.body.email !== undefined ? req.body.email : current.email;
    let statut = req.body.statut !== undefined ? String(req.body.statut) : current.statut;
    if (req.body.actif != null) {
      statut = Number(req.body.actif) ? 'actif' : 'inactif';
    }
    if (!['actif', 'inactif', 'bloque', 'suspendu'].includes(String(statut).toLowerCase())) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    await runSql(db, `
      UPDATE proprietaires
      SET nom = ?, prenom = ?, telephone = ?, email = ?, statut = ?
      WHERE id = ?
    `, [nom, prenom, telephone, email, statut, id]);

    res.json(await queryOne(db, 'SELECT * FROM proprietaires WHERE id = ?', [id]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
});

// ─── Superadmins CRUD ───────────────────────────────────────────────
router.get('/superadmins', async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryAll(db, `
      SELECT id, nom, prenom, email, telephone, role, is_active, must_change_password, created_at
      FROM users
      WHERE role IN ('super_admin', 'superadmin')
      ORDER BY id ASC
    `);
    res.json(rows.map((r) => ({ ...r, role: 'super_admin' })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/superadmins', async (req, res) => {
  try {
    const db = await getDb();
    const { nom, prenom, telephone, email } = req.body || {};
    if (!nom || !telephone) return res.status(400).json({ error: 'Nom et téléphone requis' });

    const telDigits = String(telephone).replace(/\D/g, '');
    const existingTel = ((await queryAll(db, `
      SELECT id, telephone FROM users WHERE role IN ('super_admin', 'superadmin')
    `)).find((u) => String(u.telephone || '').replace(/\D/g, '') === telDigits));
    if (existingTel) return res.status(409).json({ error: 'Un superadmin avec ce téléphone existe déjà' });

    const mail = email || `superadmin-${Date.now()}@terrainsn.local`;
    const existingMail = await queryOne(db, 'SELECT id FROM users WHERE email = ?', [mail]);
    if (existingMail) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    const temporaryPassword = crypto.randomBytes(6).toString('base64url');
    const passwordHash = bcrypt.hashSync(temporaryPassword, 12);

    const result = await runSql(db, `
      INSERT INTO users (nom, prenom, email, telephone, password_hash, role, is_active, must_change_password)
      VALUES (?, ?, ?, ?, ?, 'super_admin', 1, 1)
    `, [nom, prenom || null, mail, telephone, passwordHash]);

    try {
      await envoyerAcces({ telephone, motDePasse: temporaryPassword, role: 'super_admin' });
    } catch (waErr) {
      console.warn('[admin] Accès superadmin créé mais WhatsApp échoué:', waErr.message);
    }

    const row = await queryOne(db, `
      SELECT id, nom, prenom, email, telephone, role, is_active, must_change_password, created_at
      FROM users WHERE id = ?
    `, [result.lastInsertRowid]);
    res.status(201).json({ ...row, role: 'super_admin', temporary_password_sent: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.patch('/superadmins/:id', async (req, res) => {
  try {
    const db = await getDb();
    const id = Number(req.params.id);
    const current = await queryOne(db, `
      SELECT * FROM users WHERE id = ? AND role IN ('super_admin', 'superadmin')
    `, [id]);
    if (!current) return res.status(404).json({ error: 'Superadmin introuvable' });

    if (Number(req.user.id) === id && (req.body.is_active === 0 || req.body.is_active === false || req.body.actif === 0 || req.body.actif === false)) {
      return res.status(400).json({ error: 'Tu ne peux pas désactiver ton propre compte' });
    }

    // Empêcher de désactiver le dernier superadmin actif
    const nextActive = req.body.is_active != null
      ? (Number(req.body.is_active) ? 1 : 0)
      : (req.body.actif != null ? (Number(req.body.actif) ? 1 : 0) : Number(current.is_active));
    if (Number(current.is_active) === 1 && nextActive === 0) {
      const actifs = await queryOne(db, `
        SELECT COUNT(*) AS n FROM users
        WHERE role IN ('super_admin', 'superadmin') AND is_active = 1 AND id != ?
      `, [id]);
      if (Number(actifs?.n || 0) < 1) {
        return res.status(400).json({ error: 'Impossible de désactiver le dernier superadmin actif' });
      }
    }

    const nom = req.body.nom !== undefined ? req.body.nom : current.nom;
    const prenom = req.body.prenom !== undefined ? req.body.prenom : current.prenom;
    const telephone = req.body.telephone !== undefined ? req.body.telephone : current.telephone;
    const email = req.body.email !== undefined ? req.body.email : current.email;

    await runSql(db, `
      UPDATE users SET nom = ?, prenom = ?, telephone = ?, email = ?, is_active = ?
      WHERE id = ?
    `, [nom, prenom, telephone, email, nextActive, id]);

    const row = await queryOne(db, `
      SELECT id, nom, prenom, email, telephone, role, is_active, must_change_password, created_at
      FROM users WHERE id = ?
    `, [id]);
    res.json({ ...row, role: 'super_admin' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
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
    await transaction(db, async () => {
      if (role === 'proprietaire') {
        const insertResult = await runSql(db, `INSERT INTO proprietaires (nom, email, telephone, password_hash, statut, must_change_password)
          VALUES (?, ?, ?, ?, 'actif', 1)`, [nom, email, telephone, passwordHash]);
        id = insertResult.lastInsertRowid;
        if (terrain_id) await runSql(db, 'UPDATE terrains SET proprietaire_id = ? WHERE id = ?', [id, terrain_id]);
      } else {
        const terrain = await queryOne(db, 'SELECT proprietaire_id FROM terrains WHERE id = ?', [terrain_id]);
        if (!terrain) throw new Error('Terrain introuvable');
        const insertResult = await runSql(db, `INSERT INTO employes (proprietaire_id, terrain_id, nom, email, telephone, whatsapp_number, password_hash, is_active, must_change_password)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`, [terrain.proprietaire_id, terrain_id, nom, email, telephone, telephone, passwordHash]);
        id = insertResult.lastInsertRowid;
        // Multi-gérants : liaison + principal si premier
        const hasPrincipal = await queryOne(db, `
          SELECT id FROM gerants_terrains WHERE terrain_id = ? AND est_principal = 1 AND actif = 1
        `, [terrain_id]);
        await runSql(db, `INSERT INTO gerants_terrains
          (gerant_id, terrain_id, est_principal, actif, date_debut, note)
          VALUES (?, ?, ?, 1, CURRENT_DATE, 'Création compte admin')
          ON CONFLICT (gerant_id, terrain_id) DO NOTHING`,
          [id, terrain_id, hasPrincipal ? 0 : 1]);
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
  const rows = await queryAll(db, `SELECT t.id, t.nom, COUNT(r.id) AS reservations,
    COALESCE(SUM(CASE WHEN r.statut = 'joue' THEN r.prix_total ELSE 0 END), 0) AS revenu
    FROM terrains t LEFT JOIN reservations r ON r.terrain_id = t.id AND r.date >= ?
    GROUP BY t.id, t.nom ORDER BY revenu DESC`, [from]);
  res.json({ periode: req.query.periode || 'mois', depuis: from, total: rows.reduce((sum, row) => sum + Number(row.revenu), 0), terrains: rows });
});

router.get('/finances', async (req, res) => {
  const db = await getDb();
  const totals = await queryOne(db, `SELECT
    COALESCE(SUM(montant_acompte), 0) AS total_acomptes,
    COALESCE(SUM(montant_commission), 0) AS total_commissions,
    COALESCE(SUM(montant_reverse), 0) AS total_reverse
    FROM paiements
    WHERE statut = 'paye'`) || {};
  const terrains = await queryAll(db, `SELECT t.id, t.nom,
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
    dettes: await detteService.resumeSuperadminMois(db),
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
  res.json(await detteService.listDettesAdmin(db, {
    periode: periodeKey,
    terrainId: req.query.terrain_id ? Number(req.query.terrain_id) : null,
    statut: req.query.statut || null,
  }));
});

router.patch('/dettes/instructions', async (req, res) => {
  const db = await getDb();
  await transaction(db, async () => {
    await detteService.setSetting(db, 'dette_instructions', req.body?.texte || req.body?.instructions || '');
  });
  res.json({ success: true, instructions: await detteService.instructionsPaiementDette(db) });
});

router.patch('/dettes/:terrain_id/remise-a-zero', async (req, res) => {
  const db = await getDb();
  try {
    const periode = String(req.body?.periode || '').trim();
    const periodeKey = /^\d{4}-\d{2}$/.test(periode) ? periode : detteService.periodeCivile();
    const result = await transaction(db, async () => await detteService.remiseAZero(db, {
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
  await transaction(db, async () => {
    await appliquerSuspensionsAbonnements(db);
  });
  res.json({ grace_days: GRACE_DAYS, abonnements: await abonnementsAvecEtat(db) });
});

router.get('/commodites', async (req, res) => {
  const db = await getDb();
  res.json(await commoditesService.listCommodites(db));
});

router.post('/commodites', async (req, res) => {
  const db = await getDb();
  try {
    const created = await transaction(db, async () => await commoditesService.createCommodite(db, req.body || {}, commoditesService.actorFromReq(req)));
    res.status(201).json(created);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.patch('/commodites/:id', async (req, res) => {
  const db = await getDb();
  try {
    const updated = await transaction(db, async () => await commoditesService.updateCommodite(db, Number(req.params.id), req.body || {}, commoditesService.actorFromReq(req)));
    res.json(updated);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.delete('/commodites/:id', async (req, res) => {
  const db = await getDb();
  try {
    const updated = await transaction(db, async () => await commoditesService.softDeleteCommodite(db, Number(req.params.id), commoditesService.actorFromReq(req)));
    res.json(updated);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.get('/terrains/:id/commodites', async (req, res) => {
  const db = await getDb();
  const terrain = await queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [Number(req.params.id)]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  res.json(await commoditesService.listTerrainCommodites(db, terrain.id));
});

router.put('/terrains/:id/commodites', async (req, res) => {
  const db = await getDb();
  try {
    const terrainId = Number(req.params.id);
    const terrain = await queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [terrainId]);
    if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
    const list = await transaction(db, async () => await commoditesService.setTerrainCommodites(
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
    photos: await listAuditPhotos(db, filters),
    commodites: await listAuditCommodites(db, filters),
  });
});

router.get('/audit/photos-commodites', async (req, res) => {
  const db = await getDb();
  const type = String(req.query.type || 'tout');
  const filters = parseAuditFilters(req.query);
  const photos = type === 'commodites' ? [] : await listAuditPhotos(db, filters);
  const commodites = type === 'photos' ? [] : await listAuditCommodites(db, filters);
  res.json({ photos, commodites });
});

router.get('/terrains/:id/essai', async (req, res) => {
  const db = await getDb();
  const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(req.params.id)]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  res.json(essaiService.publicEssai(terrain));
});

router.patch('/terrains/:id/essai', async (req, res) => {
  const db = await getDb();
  const id = Number(req.params.id);
  const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [id]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  const action = String(req.body?.action || '');
  const today = essaiService.ymd(new Date());
  try {
    await transaction(db, async () => {
      if (action === 'activer') {
        const duree = Math.max(1, Number(req.body?.essai_duree_jours || 30));
        const nego = Math.max(0, Number(req.body?.delai_negociation_jours || 7));
        const fin = essaiService.addDays(today, duree);
        await runSql(db, `UPDATE terrains SET mode_essai = 1, essai_debut_at = ?, essai_duree_jours = ?, essai_fin_at = ?,
          delai_negociation_jours = ?, essai_suspendu_auto = 0, notif_essai_fin_j7 = 0, notif_essai_fin_j3 = 0, notif_essai_fin_j1 = 0 WHERE id = ?`,
          [today, duree, fin, nego, id]);
      } else if (action === 'production' || action === 'desactiver') {
        await runSql(db, 'UPDATE terrains SET mode_essai = 0, essai_fin_at = COALESCE(essai_fin_at, ?) WHERE id = ?', [today, id]);
      } else if (action === 'modifier') {
        const duree = Math.max(1, Number(req.body?.essai_duree_jours || terrain.essai_duree_jours || 30));
        const nego = Math.max(0, Number(req.body?.delai_negociation_jours || terrain.delai_negociation_jours || 7));
        const debut = String(terrain.essai_debut_at || today).slice(0, 10);
        const fin = essaiService.addDays(debut, duree);
        await runSql(db, 'UPDATE terrains SET essai_duree_jours = ?, delai_negociation_jours = ?, essai_fin_at = ? WHERE id = ?', [duree, nego, fin, id]);
      } else if (action === 'delai') {
        const extra = Math.max(1, Number(req.body?.jours || 7));
        const nego = Number(terrain.delai_negociation_jours || 7) + extra;
        await runSql(db, 'UPDATE terrains SET delai_negociation_jours = ? WHERE id = ?', [nego, id]);
      } else if (action === 'reactiver-essai') {
        const duree = Math.max(1, Number(req.body?.essai_duree_jours || 30));
        const nego = Math.max(0, Number(req.body?.delai_negociation_jours || 7));
        const fin = essaiService.addDays(today, duree);
        await runSql(db, `UPDATE terrains SET mode_essai = 1, essai_suspendu_auto = 0, is_active = 1, essai_debut_at = ?, essai_duree_jours = ?, essai_fin_at = ?, delai_negociation_jours = ? WHERE id = ?`,
          [today, duree, fin, nego, id]);
      } else if (action === 'reactiver-production') {
        await runSql(db, 'UPDATE terrains SET mode_essai = 0, essai_suspendu_auto = 0, is_active = 1 WHERE id = ?', [id]);
      } else {
        const err = new Error('Action essai inconnue');
        err.statusCode = 400;
        throw err;
      }
    });
    const next = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [id]);
    res.json(essaiService.publicEssai(next));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.get('/essai-kpis', async (req, res) => {
  const db = await getDb();
  const terrains = await queryAll(db, 'SELECT * FROM terrains');
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
  const terrain = await queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [Number(req.params.id)]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  res.json(await terrainFeaturesService.listFeatures(db, terrain.id));
});

router.put('/terrains/:id/features', async (req, res) => {
  const db = await getDb();
  const terrainId = Number(req.params.id);
  const terrain = await queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  const list = await transaction(db, async () => await terrainFeaturesService.saveFeatures(db, terrainId, req.body?.features || [], req.user?.id));
  res.json(list);
});

router.get('/nuit-prolongee', async (req, res) => {
  const db = await getDb();
  const row = await queryOne(db, 'SELECT valeur FROM plateforme_settings WHERE cle = ?', ['heure_fermeture_maximale']);
  res.json({
    heure_fermeture_maximale: row?.valeur || '03:00',
    heure_debut_nuit_prolongee: '00:00',
  });
});

router.put('/nuit-prolongee', async (req, res) => {
  const db = await getDb();
  const allowed = new Set(['23:00', '00:00', '01:00', '02:00', '03:00', '04:00']);
  const val = String(req.body?.heure_fermeture_maximale || '03:00').slice(0, 5);
  if (!allowed.has(val)) return res.status(400).json({ error: 'Heure de fermeture maximale invalide' });
  const existing = await queryOne(db, 'SELECT cle FROM plateforme_settings WHERE cle = ?', ['heure_fermeture_maximale']);
  if (existing) {
    await runSql(db, 'UPDATE plateforme_settings SET valeur = ?, updated_at = CURRENT_TIMESTAMP WHERE cle = ?', [val, 'heure_fermeture_maximale']);
  } else {
    await runSql(db, 'INSERT INTO plateforme_settings (cle, valeur) VALUES (?, ?)', ['heure_fermeture_maximale', val]);
  }
  res.json({ heure_fermeture_maximale: val, heure_debut_nuit_prolongee: '00:00' });
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

router.post('/bug-alerts/test', async (req, res) => {
  const bugAlert = require('../services/bugAlertService');
  try {
    const result = await bugAlert.notify({
      kind: 'test',
      title: 'Test alerte développeur TerrainSN',
      error: new Error(req.body?.message || 'Ceci est un test manuel depuis le superadmin.'),
      req,
      force: true,
      meta: { triggered_by: req.user?.email || req.user?.id || 'superadmin' },
    });
    res.json({
      ok: Boolean(result.ok),
      email: result.email,
      whatsapp: result.whatsapp,
      recipients: {
        emails: bugAlert.emailRecipients(),
        whatsapp: bugAlert.whatsappContacts().map((c) => ({
          phone: c.phone,
          name: c.fullName,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || 'Envoi impossible' });
  }
});

router.get('/bug-alerts/status', async (req, res) => {
  const bugAlert = require('../services/bugAlertService');
  res.json({
    enabled: String(process.env.BUG_ALERT_ENABLED || 'true').toLowerCase() !== 'false',
    smtp_configured: bugAlert.smtpConfigured(),
    emails: bugAlert.emailRecipients(),
    whatsapp: bugAlert.whatsappContacts().map((c) => ({ phone: c.phone, name: c.fullName })),
  });
});

router.get('/mode-revenu/defaults', async (req, res) => {
  const db = await getDb();
  res.json(await modeRevenuService.getDefaults(db));
});

router.patch('/mode-revenu/defaults', async (req, res) => {
  const db = await getDb();
  try {
    const next = await transaction(db, async () => await modeRevenuService.saveDefaults(db, req.body || {}));
    res.json(next);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Enregistrement impossible' });
  }
});

router.get('/mode-revenu/history', async (req, res) => {
  const db = await getDb();
  res.json(await modeRevenuService.listHistory(db));
});

router.patch('/terrains/:id/mode-revenu', async (req, res) => {
  const db = await getDb();
  const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(req.params.id)]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  try {
    const next = await transaction(db, async () => await modeRevenuService.applyMode(db, terrain, req.body || {}, req.user?.id));
    res.json(modeRevenuService.enrichTerrain(next));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

module.exports = router;
