const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
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
} = require('../terrainPhotoService');

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

router.post('/terrains', async (req, res) => {
  try {
    const db = await getDb();
    const { nom, quartier, ville, surface, taille, prix_heure, prix_moitie, prix_entier, pourcentage_avance, modele_revenus, commission_pourcentage, abonnement_montant, achat_definitif_montant, latitude, longitude, photos, proprietaire_id, commodites } = req.body;
    if (!nom || !prix_heure || !proprietaire_id) return res.status(400).json({ error: 'Nom, prix et proprietaire requis' });
    const prixEntier = Number(prix_entier || prix_heure);
    const prixMoitie = Number(prix_moitie || prixEntier * 0.6);
    const pourcentageAvance = Number(pourcentage_avance || 8);
    const avanceReference = montantAvanceReference(prixEntier, pourcentageAvance);
    const result = runSql(db, `INSERT INTO terrains
      (proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_entier, prix_moitie, montant_acompte, acompte, pourcentage_avance, modele_revenus, commission_pourcentage, abonnement_montant, achat_definitif_montant, latitude, longitude, photos, description, commodites, is_active)
      VALUES (?, ?, ?, ?, 'foot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [proprietaire_id, nom, quartier, ville || 'Dakar', taille || '11v11', prixEntier, prixEntier, prixMoitie, avanceReference, avanceReference, pourcentageAvance, modele_revenus || 'commission', Number(commission_pourcentage || 0), Number(abonnement_montant || 0), Number(achat_definitif_montant || 0), Number.isFinite(Number(latitude)) ? Number(latitude) : null, Number.isFinite(Number(longitude)) ? Number(longitude) : null, JSON.stringify(photos || []), surface || 'synthetique', typeof commodites === 'string' ? commodites : JSON.stringify(Array.isArray(commodites) ? commodites : [])]);
    const terrainId = result.lastInsertRowid;
    for (const jour of ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']) {
      runSql(db, 'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, 1)', [terrainId, jour, '08:00', '22:00']);
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
  runSql(db, 'UPDATE terrains SET is_active = ? WHERE id = ?', [req.body.statut === 'actif' ? 1 : 0, Number(req.params.id)]);
  res.json({ message: `Terrain ${req.body.statut}` });
});

router.get('/terrains/:id/photos', async (req, res) => {
  const db = await getDb();
  const terrainId = Number(req.params.id);
  const terrain = queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  res.json(listTerrainPhotos(db, terrainId));
});

router.post('/terrains/:id/photos', async (req, res) => {
  const db = await getDb();
  try {
    const terrainId = Number(req.params.id);
    const photo = transaction(db, () => createTerrainPhoto(db, terrainId, req.body || {}));
    res.status(201).json(photo);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.patch('/terrains/:id/photos/:photoId', async (req, res) => {
  const db = await getDb();
  try {
    const terrainId = Number(req.params.id);
    const photo = transaction(db, () => updateTerrainPhoto(db, terrainId, Number(req.params.photoId), req.body || {}));
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
  res.json(queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(req.params.id)]));
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
    terrains: terrains.map((terrain) => ({ ...terrain, avances: Number(terrain.acomptes || 0) })),
  });
});

router.get('/abonnements', async (req, res) => {
  const db = await getDb();
  transaction(db, () => {
    appliquerSuspensionsAbonnements(db);
  });
  res.json({ grace_days: GRACE_DAYS, abonnements: abonnementsAvecEtat(db) });
});

module.exports = router;
