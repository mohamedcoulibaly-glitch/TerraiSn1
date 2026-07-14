const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getDb, queryAll, queryOne, runSql, transaction } = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { envoyerAcces } = require('../accessNotificationService');

const router = express.Router();

router.post('/auth/login', async (req, res) => {
  try {
    const db = await getDb();
    const { telephone, password } = req.body;
    const normalized = String(telephone || '').replace(/\D/g, '');
    const user = queryAll(db, "SELECT * FROM users WHERE (role = 'super_admin' OR role = 'superadmin') AND is_active = 1").find((item) => String(item.telephone || '').replace(/\D/g, '') === normalized);
    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return res.status(401).json({ error: 'Accès refusé' });
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

router.get('/terrains', async (req, res) => {
  const db = await getDb();
  res.json(queryAll(db, `SELECT t.*, p.nom AS proprietaire_nom FROM terrains t
    LEFT JOIN proprietaires p ON p.id = t.proprietaire_id ORDER BY t.created_at DESC`));
});

router.post('/terrains', async (req, res) => {
  try {
    const db = await getDb();
    const { nom, quartier, ville, surface, taille, prix_heure, photos, proprietaire_id } = req.body;
    if (!nom || !prix_heure || !proprietaire_id) return res.status(400).json({ error: 'Nom, prix et propriétaire requis' });
    const result = runSql(db, `INSERT INTO terrains
      (proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_entier, prix_moitie, photos, description, is_active)
      VALUES (?, ?, ?, ?, 'foot', ?, ?, ?, ?, ?, ?, 1)`,
      [proprietaire_id, nom, quartier, ville || 'Dakar', taille || '11v11', prix_heure, prix_heure, Number(prix_heure) * 0.6, JSON.stringify(photos || []), surface || 'synthétique']);
    const terrainId = result.lastInsertRowid;
    for (const jour of ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']) {
      runSql(db, 'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, 1)', [terrainId, jour, '08:00', '22:00']);
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

router.patch('/terrains/:id/tarifs', async (req, res) => {
  const db = await getDb();
  const acompte = Number(req.body.acompte);
  const commission = Number(req.body.commission);
  if (!Number.isFinite(acompte) || acompte <= 0 || !Number.isFinite(commission) || commission < 0 || commission >= acompte) {
    return res.status(400).json({ error: 'Tarifs invalides' });
  }
  runSql(db, 'UPDATE terrains SET acompte = ?, montant_acompte = ?, commission = ? WHERE id = ?', [acompte, acompte, commission, Number(req.params.id)]);
  res.json(queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(req.params.id)]));
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
    if (!nom || !telephone || !['gerant', 'proprietaire'].includes(role)) return res.status(400).json({ error: 'Données invalides' });
    if (role === 'gerant' && !terrain_id) return res.status(400).json({ error: 'Terrain obligatoire pour un gérant' });
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
  const period = req.query.periode === 'semaine' ? 7 : 31;
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
    total_commissions: Number(totals.total_commissions || 0),
    total_reverse: Number(totals.total_reverse || 0),
    terrains,
  });
});

module.exports = router;
