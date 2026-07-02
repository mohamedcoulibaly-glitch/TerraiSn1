const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDb, queryAll, queryOne, runSql, saveDb } = require('./database');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'terrainsn_secret_key_2026';

// Middleware
app.use(cors());
app.use(express.json());

// ============================================================
// MIDDLEWARE AUTH
// ============================================================
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    next();
  };
}

// Middleware optionnel : attache l'utilisateur si un token valide est présent,
// mais laisse passer sans erreur s'il n'y a pas de token (pour les joueurs non connectés)
function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    req.user = null;
  }
  next();
}

// ============================================================
// AUTH ROUTES
// ============================================================

// Inscription joueur
app.post('/api/auth/register', async (req, res) => {
  try {
    const db = await getDb();
    const { nom, email, password, telephone } = req.body;
    if (!nom || !email || !password) {
      return res.status(400).json({ error: 'Champs obligatoires manquants' });
    }
    const existing = queryOne(db, 'SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(409).json({ error: 'Email déjà utilisé' });

    const password_hash = bcrypt.hashSync(password, 10);
    const result = runSql(db, 'INSERT INTO users (nom, email, password_hash, telephone, role) VALUES (?, ?, ?, ?, ?)', [nom, email, password_hash, telephone || null, 'joueur']);
    
    const user = queryOne(db, 'SELECT id, nom, email, telephone, role FROM users WHERE id = ?', [result.lastInsertRowid]);
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, accountType: 'user' }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Connexion (tous types de comptes)
app.post('/api/auth/login', async (req, res) => {
  try {
    const db = await getDb();
    const { email, password, accountType = 'user' } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe obligatoires' });

    let account = null;
    let role = '';

    if (accountType === 'proprietaire') {
      account = queryOne(db, 'SELECT * FROM proprietaires WHERE email = ?', [email]);
      role = 'proprietaire';
    } else if (accountType === 'employe') {
      account = queryOne(db, 'SELECT * FROM employes WHERE email = ?', [email]);
      role = 'employe';
    } else {
      account = queryOne(db, 'SELECT * FROM users WHERE email = ?', [email]);
      role = account?.role || 'joueur';
    }

    if (!account) return res.status(401).json({ error: 'Identifiants incorrects' });
    if (!bcrypt.compareSync(password, account.password_hash)) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const tokenPayload = { id: account.id, email: account.email, role, accountType };
    if (accountType === 'employe') {
      tokenPayload.terrain_id = account.terrain_id;
      tokenPayload.proprietaire_id = account.proprietaire_id;
    }
    if (accountType === 'proprietaire') {
      tokenPayload.proprietaire_id = account.id;
    }

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

    const { password_hash, ...safeAccount } = account;
    res.json({ user: { ...safeAccount, role, accountType }, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Profil connecté
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    let account;
    if (req.user.accountType === 'proprietaire') {
      account = queryOne(db, 'SELECT id, nom, email, telephone, plan, statut, created_at FROM proprietaires WHERE id = ?', [req.user.id]);
    } else if (req.user.accountType === 'employe') {
      account = queryOne(db, 'SELECT id, nom, email, telephone, whatsapp_number, terrain_id, is_active, created_at FROM employes WHERE id = ?', [req.user.id]);
    } else {
      account = queryOne(db, 'SELECT id, nom, email, telephone, role, is_active, created_at FROM users WHERE id = ?', [req.user.id]);
    }
    if (!account) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    res.json({ ...account, role: req.user.role, accountType: req.user.accountType });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// TERRAINS
// ============================================================

// Liste publique
app.get('/api/terrains', async (req, res) => {
  try {
    const db = await getDb();
    const { ville, sport, type, prix_min, prix_max, search } = req.query;
    let query = `
      SELECT t.*, 
        COALESCE(ROUND(AVG(a.note), 1), 0) as note,
        COUNT(a.id) as avis_count,
        p.nom as proprietaire_nom
      FROM terrains t
      LEFT JOIN avis a ON a.terrain_id = t.id
      LEFT JOIN proprietaires p ON p.id = t.proprietaire_id
      WHERE 1=1
    `;
    const params = [];

    if (ville && ville !== 'Toutes') { query += ' AND t.ville = ?'; params.push(ville); }
    if (sport) { query += ' AND t.sport = ?'; params.push(sport); }
    if (type && type !== 'Tous') { query += ' AND t.type = ?'; params.push(type); }
    if (prix_min) { query += ' AND t.prix_heure >= ?'; params.push(Number(prix_min)); }
    if (prix_max) { query += ' AND t.prix_heure <= ?'; params.push(Number(prix_max)); }
    if (search) { query += ' AND (t.nom LIKE ? OR t.ville LIKE ? OR t.adresse LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

    query += ' GROUP BY t.id ORDER BY note DESC, avis_count DESC';

    const terrains = queryAll(db, query, params);
    res.json(terrains);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Détails d'un terrain
app.get('/api/terrains/:id', async (req, res) => {
  try {
    const db = await getDb();
    const terrain = queryOne(db, `
      SELECT t.*, 
        COALESCE(ROUND(AVG(a.note), 1), 0) as note,
        COUNT(a.id) as avis_count,
        p.nom as proprietaire_nom
      FROM terrains t
      LEFT JOIN avis a ON a.terrain_id = t.id
      LEFT JOIN proprietaires p ON p.id = t.proprietaire_id
      WHERE t.id = ?
      GROUP BY t.id
    `, [Number(req.params.id)]);

    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });

    const horaires = queryAll(db, "SELECT * FROM horaires WHERE terrain_id = ? ORDER BY CASE jour WHEN 'lundi' THEN 1 WHEN 'mardi' THEN 2 WHEN 'mercredi' THEN 3 WHEN 'jeudi' THEN 4 WHEN 'vendredi' THEN 5 WHEN 'samedi' THEN 6 WHEN 'dimanche' THEN 7 END", [terrain.id]);
    const avis = queryAll(db, 'SELECT a.*, u.nom as joueur_nom FROM avis a LEFT JOIN users u ON u.id = a.joueur_id WHERE a.terrain_id = ? ORDER BY a.created_at DESC', [terrain.id]);
    const employe = queryOne(db, 'SELECT whatsapp_number, nom FROM employes WHERE terrain_id = ? AND is_active = 1 LIMIT 1', [terrain.id]);

    res.json({ ...terrain, horaires, avis, employe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Créneaux disponibles
app.get('/api/terrains/:id/creneaux', async (req, res) => {
  try {
    const db = await getDb();
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'Date requise' });

    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(req.params.id)]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });

    const d = new Date(date);
    const joursMap = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const jour = joursMap[d.getDay()];

    const horaire = queryOne(db, 'SELECT * FROM horaires WHERE terrain_id = ? AND jour = ?', [terrain.id, jour]);
    if (!horaire || !horaire.est_ouvert) {
      return res.json({ creneaux: [], message: 'Fermé ce jour' });
    }

    const reservationsExistantes = queryAll(db, "SELECT heure_debut, heure_fin FROM reservations WHERE terrain_id = ? AND date = ? AND statut IN ('acceptee', 'en_attente')", [terrain.id, date]);
    const blocages = queryAll(db, 'SELECT heure_debut, heure_fin FROM blocages_creneaux WHERE terrain_id = ? AND date = ?', [terrain.id, date]);

    const startHour = parseInt(horaire.heure_debut.split(':')[0]);
    const endHour = parseInt(horaire.heure_fin.split(':')[0]);
    const creneaux = [];

    for (let h = startHour; h < endHour; h++) {
      const slot = `${h.toString().padStart(2, '0')}:00`;
      const slotEnd = `${(h + 1).toString().padStart(2, '0')}:00`;

      const isReserved = reservationsExistantes.some(r => slot >= r.heure_debut && slot < r.heure_fin);
      const isBlocked = blocages.some(b => slot >= b.heure_debut && slot < b.heure_fin);

      creneaux.push({ heure: slot, heure_fin: slotEnd, disponible: !isReserved && !isBlocked, bloque: isBlocked });
    }

    res.json({ creneaux, horaire });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// CRUD Terrains (propriétaire)
app.post('/api/terrains', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const { nom, adresse, ville, sport, type, prix_heure, description, telephone } = req.body;
    const result = runSql(db, 'INSERT INTO terrains (proprietaire_id, nom, adresse, ville, sport, type, prix_heure, description, telephone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, nom, adresse, ville, sport || 'foot', type || '11 vs 11', prix_heure, description, telephone]);
    
    const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    for (const jour of jours) {
      runSql(db, 'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, 1)', [result.lastInsertRowid, jour, '08:00', '22:00']);
    }

    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(terrain);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/terrains/:id', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ? AND proprietaire_id = ?', [Number(req.params.id), req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });

    const { nom, adresse, ville, sport, type, prix_heure, description, telephone, is_active } = req.body;
    runSql(db, 'UPDATE terrains SET nom=?, adresse=?, ville=?, sport=?, type=?, prix_heure=?, description=?, telephone=?, is_active=? WHERE id=?',
      [nom || terrain.nom, adresse || terrain.adresse, ville || terrain.ville, sport || terrain.sport, type || terrain.type, prix_heure || terrain.prix_heure, description || terrain.description, telephone || terrain.telephone, is_active !== undefined ? is_active : terrain.is_active, terrain.id]);
    
    const updated = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrain.id]);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/terrains/:id', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ? AND proprietaire_id = ?', [Number(req.params.id), req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });
    runSql(db, 'DELETE FROM terrains WHERE id = ?', [terrain.id]);
    res.json({ message: 'Terrain supprimé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// RESERVATIONS
// ============================================================

app.post('/api/reservations', async (req, res) => {
  try {
    const db = await getDb();
    const { terrain_id, date, heure_debut, heure_fin, joueur_nom, joueur_telephone } = req.body;
    if (!joueur_nom || !joueur_telephone) {
      return res.status(400).json({ error: 'Nom et téléphone du joueur requis' });
    }

    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrain_id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });

    const existing = queryOne(db, "SELECT id FROM reservations WHERE terrain_id = ? AND date = ? AND statut IN ('acceptee', 'en_attente') AND heure_debut < ? AND heure_fin > ?",
      [terrain_id, date, heure_fin, heure_debut]);
    if (existing) return res.status(409).json({ error: 'Créneau déjà réservé' });

    const startH = parseInt(heure_debut.split(':')[0]);
    const endH = parseInt(heure_fin.split(':')[0]);
    const duree = endH - startH;
    const montant = terrain.prix_heure * duree;
    const expireAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const result = runSql(db, 'INSERT INTO reservations (terrain_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin, montant, statut, expire_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [terrain_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin, montant, 'en_attente', expireAt]);

    const reservation = queryOne(db, `
      SELECT r.*, t.nom as terrain_nom, t.ville as terrain_ville, t.type as terrain_type
      FROM reservations r JOIN terrains t ON t.id = r.terrain_id WHERE r.id = ?
    `, [result.lastInsertRowid]);

    res.status(201).json(reservation);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Recharger une réservation (utile pour refresh / accès direct)
app.get('/api/reservations/:id', optionalAuth, async (req, res) => {
  try {
    const db = await getDb();
    const reservation = queryOne(db, `
      SELECT r.*, t.nom as terrain_nom, t.ville as terrain_ville, t.type as terrain_type
      FROM reservations r
      JOIN terrains t ON t.id = r.terrain_id
      WHERE r.id = ?
    `, [Number(req.params.id)]);

    if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });

    // Si un user est connecté, on peut restreindre à ses réservations
    if (req.user && reservation.joueur_id && Number(reservation.joueur_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }

    // Pour compat front: calculer durée si pas fournie
    if (!reservation.duree && reservation.heure_debut && reservation.heure_fin) {
      const startH = parseInt(String(reservation.heure_debut).split(':')[0]);
      const endH = parseInt(String(reservation.heure_fin).split(':')[0]);
      reservation.duree = endH - startH;
    }

    res.json(reservation);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/reservations/mes', optionalAuth, async (req, res) => {
  try {
    // Sans compte connecté, retourner un tableau vide (accès libre pour les joueurs)
    if (!req.user) return res.json([]);
    const db = await getDb();
    const reservations = queryAll(db, `
      SELECT r.*, t.nom as terrain_nom, t.ville as terrain_ville, t.type as terrain_type, t.prix_heure
      FROM reservations r JOIN terrains t ON t.id = r.terrain_id
      WHERE r.joueur_id = ? ORDER BY r.created_at DESC
    `, [req.user.id]);
    res.json(reservations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/reservations/:id/annuler', optionalAuth, async (req, res) => {
  try {
    const db = await getDb();
    // Si pas connecté, chercher la réservation juste par ID (joueur sans compte)
    let reservation;
    if (req.user) {
      reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ? AND joueur_id = ?', [Number(req.params.id), req.user.id]);
    } else {
      reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [Number(req.params.id)]);
    }
    if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });
    if (!['en_attente', 'acceptee'].includes(reservation.statut)) {
      return res.status(400).json({ error: 'Réservation ne peut pas être annulée' });
    }
    runSql(db, "UPDATE reservations SET statut = 'annulee' WHERE id = ?", [reservation.id]);
    res.json({ message: 'Réservation annulée' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/reservations/:id/traiter', authMiddleware, requireRole('employe', 'proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const { action } = req.body;
    if (!['acceptee', 'refusee'].includes(action)) {
      return res.status(400).json({ error: 'Action invalide' });
    }
    const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [Number(req.params.id)]);
    if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });
    runSql(db, 'UPDATE reservations SET statut = ?, traite_par = ? WHERE id = ?', [action, req.user.id, reservation.id]);
    res.json({ message: `Réservation ${action}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/reservations/terrain/:terrainId', authMiddleware, requireRole('employe', 'proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const reservations = queryAll(db, `
      SELECT r.*, u.nom as joueur_nom, u.telephone as joueur_telephone, t.nom as terrain_nom
      FROM reservations r JOIN users u ON u.id = r.joueur_id JOIN terrains t ON t.id = r.terrain_id
      WHERE r.terrain_id = ? ORDER BY r.date DESC, r.heure_debut ASC
    `, [Number(req.params.terrainId)]);
    res.json(reservations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// PAIEMENTS
// ============================================================
app.post('/api/paiements', async (req, res) => {
  try {
    const db = await getDb();
    const { reservation_id, methode } = req.body;
    if (!['wave', 'orange_money'].includes(methode)) {
      return res.status(400).json({ error: 'Méthode de paiement invalide (wave ou orange_money uniquement)' });
    }
    const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservation_id]);
    if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });

    const refExterne = `${methode.toUpperCase().replace('_', '-')}-${Date.now()}`;
    const result = runSql(db, 'INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe) VALUES (?, ?, ?, ?, ?)',
      [reservation.id, reservation.montant, methode, 'paye', refExterne]);

    runSql(db, "UPDATE reservations SET statut = 'acceptee' WHERE id = ?", [reservation.id]);

    const paiement = queryOne(db, 'SELECT * FROM paiements WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(paiement);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// PROPRIETAIRE
// ============================================================
app.get('/api/proprietaire/stats', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const propId = req.user.id;
    const terrains = queryAll(db, 'SELECT * FROM terrains WHERE proprietaire_id = ?', [propId]);
    const terrainIds = terrains.map(t => t.id);
    
    if (terrainIds.length === 0) {
      return res.json({ totalRevenue: 0, occupancyRate: 0, totalReservations: 0, pendingReservations: 0, totalTerrains: 0, totalEmployes: 0, terrainStats: [], weeklyRevenue: [] });
    }

    const placeholders = terrainIds.map(() => '?').join(',');

    const revenueRow = queryOne(db, `SELECT COALESCE(SUM(montant), 0) as total FROM reservations WHERE terrain_id IN (${placeholders}) AND statut = 'acceptee'`, terrainIds);
    const totalRes = queryOne(db, `SELECT COUNT(*) as count FROM reservations WHERE terrain_id IN (${placeholders})`, terrainIds);
    const pendingRes = queryOne(db, `SELECT COUNT(*) as count FROM reservations WHERE terrain_id IN (${placeholders}) AND statut = 'en_attente'`, terrainIds);
    const totalEmp = queryOne(db, 'SELECT COUNT(*) as count FROM employes WHERE proprietaire_id = ?', [propId]);

    const terrainStats = terrains.map(t => {
      const rev = queryOne(db, "SELECT COALESCE(SUM(montant), 0) as total FROM reservations WHERE terrain_id = ? AND statut = 'acceptee'", [t.id]);
      const resCount = queryOne(db, 'SELECT COUNT(*) as count FROM reservations WHERE terrain_id = ?', [t.id]);
      return { nom: t.nom, id: t.id, reservations: resCount.count, revenue: rev.total, occupancy: Math.min(Math.round((resCount.count / 50) * 100), 100) };
    });

    const weeklyRevenue = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const rev = queryOne(db, `SELECT COALESCE(SUM(montant), 0) as total FROM reservations WHERE terrain_id IN (${placeholders}) AND date = ? AND statut = 'acceptee'`, [...terrainIds, dateStr]);
      weeklyRevenue.push({ day: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][d.getDay()], revenue: rev.total });
    }

    res.json({
      totalRevenue: revenueRow.total,
      occupancyRate: terrainStats.length > 0 ? Math.round(terrainStats.reduce((s, t) => s + t.occupancy, 0) / terrainStats.length) : 0,
      totalReservations: totalRes.count,
      pendingReservations: pendingRes.count,
      totalTerrains: terrains.length,
      totalEmployes: totalEmp.count,
      terrainStats,
      weeklyRevenue,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/proprietaire/terrains', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrains = queryAll(db, `
      SELECT t.*, COALESCE(ROUND(AVG(a.note), 1), 0) as note, COUNT(a.id) as avis_count
      FROM terrains t LEFT JOIN avis a ON a.terrain_id = t.id
      WHERE t.proprietaire_id = ? GROUP BY t.id
    `, [req.user.id]);
    res.json(terrains);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/proprietaire/reservations', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const reservations = queryAll(db, `
      SELECT r.*, t.nom as terrain_nom, t.ville as terrain_ville, u.nom as joueur_nom, u.telephone as joueur_telephone
      FROM reservations r JOIN terrains t ON t.id = r.terrain_id JOIN users u ON u.id = r.joueur_id
      WHERE t.proprietaire_id = ? ORDER BY r.created_at DESC
    `, [req.user.id]);
    res.json(reservations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// EMPLOYES
// ============================================================
app.get('/api/employes', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const employes = queryAll(db, 'SELECT e.*, t.nom as terrain_nom FROM employes e LEFT JOIN terrains t ON t.id = e.terrain_id WHERE e.proprietaire_id = ?', [req.user.id]);
    res.json(employes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/employes', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const { nom, email, password, telephone, whatsapp_number, terrain_id } = req.body;
    if (!nom || !email || !password || !whatsapp_number) {
      return res.status(400).json({ error: 'Champs obligatoires manquants' });
    }
    const password_hash = bcrypt.hashSync(password, 10);
    const result = runSql(db, 'INSERT INTO employes (proprietaire_id, terrain_id, nom, email, password_hash, telephone, whatsapp_number) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, terrain_id || null, nom, email, password_hash, telephone, whatsapp_number]);

    const employe = queryOne(db, 'SELECT e.*, t.nom as terrain_nom FROM employes e LEFT JOIN terrains t ON t.id = e.terrain_id WHERE e.id = ?', [result.lastInsertRowid]);
    res.status(201).json(employe);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/employes/:id', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const emp = queryOne(db, 'SELECT * FROM employes WHERE id = ? AND proprietaire_id = ?', [Number(req.params.id), req.user.id]);
    if (!emp) return res.status(404).json({ error: 'Employé non trouvé' });
    runSql(db, 'DELETE FROM employes WHERE id = ?', [emp.id]);
    res.json({ message: 'Employé supprimé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// GERANT
// ============================================================
app.get('/api/gerant/dashboard', authMiddleware, requireRole('employe'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = req.user.terrain_id;
    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
    
    const reservations = queryAll(db, `
      SELECT r.*, u.nom as joueur_nom, u.telephone as joueur_telephone
      FROM reservations r JOIN users u ON u.id = r.joueur_id
      WHERE r.terrain_id = ? ORDER BY r.date DESC, r.heure_debut ASC LIMIT 20
    `, [terrainId]);

    const horaires = queryAll(db, "SELECT * FROM horaires WHERE terrain_id = ? ORDER BY CASE jour WHEN 'lundi' THEN 1 WHEN 'mardi' THEN 2 WHEN 'mercredi' THEN 3 WHEN 'jeudi' THEN 4 WHEN 'vendredi' THEN 5 WHEN 'samedi' THEN 6 WHEN 'dimanche' THEN 7 END", [terrainId]);
    const blocages = queryAll(db, 'SELECT * FROM blocages_creneaux WHERE terrain_id = ? ORDER BY date DESC', [terrainId]);
    const pendingCount = queryOne(db, "SELECT COUNT(*) as count FROM reservations WHERE terrain_id = ? AND statut = 'en_attente'", [terrainId]);
    const monthCount = queryOne(db, "SELECT COUNT(*) as count FROM reservations WHERE terrain_id = ?", [terrainId]);

    res.json({ terrain, reservations, horaires, blocages, pendingCount: pendingCount.count, monthReservations: monthCount.count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/gerant/horaires', authMiddleware, requireRole('employe'), async (req, res) => {
  try {
    const db = await getDb();
    const { horaires } = req.body;
    const terrainId = req.user.terrain_id;
    for (const h of horaires) {
      runSql(db, 'UPDATE horaires SET heure_debut = ?, heure_fin = ?, est_ouvert = ? WHERE terrain_id = ? AND jour = ?',
        [h.heure_debut, h.heure_fin, h.est_ouvert ? 1 : 0, terrainId, h.jour]);
    }
    res.json({ message: 'Horaires mis à jour' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/gerant/blocages', authMiddleware, requireRole('employe'), async (req, res) => {
  try {
    const db = await getDb();
    const { date, heure_debut, heure_fin, motif } = req.body;
    const result = runSql(db, 'INSERT INTO blocages_creneaux (terrain_id, employe_id, date, heure_debut, heure_fin, motif) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.terrain_id, req.user.id, date, heure_debut, heure_fin, motif]);
    const blocage = queryOne(db, 'SELECT * FROM blocages_creneaux WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(blocage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/gerant/blocages/:id', authMiddleware, requireRole('employe'), async (req, res) => {
  try {
    const db = await getDb();
    runSql(db, 'DELETE FROM blocages_creneaux WHERE id = ? AND terrain_id = ?', [Number(req.params.id), req.user.terrain_id]);
    res.json({ message: 'Blocage supprimé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// AVIS
// ============================================================
app.post('/api/avis', optionalAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { terrain_id, note, commentaire, reservation_id } = req.body;
    if (!note || note < 1 || note > 5) return res.status(400).json({ error: 'Note entre 1 et 5 requise' });
    // Permettre l'avis sans compte (joueur_id = null si non connecté)
    const joueur_id = req.user ? req.user.id : null;
    const result = runSql(db, 'INSERT INTO avis (reservation_id, joueur_id, terrain_id, note, commentaire) VALUES (?, ?, ?, ?, ?)',
      [reservation_id || null, joueur_id, terrain_id, note, commentaire]);
    const avis = queryOne(db, 'SELECT a.*, COALESCE(u.nom, "Joueur anonyme") as joueur_nom FROM avis a LEFT JOIN users u ON u.id = a.joueur_id WHERE a.id = ?', [result.lastInsertRowid]);
    res.status(201).json(avis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/avis/terrain/:terrainId', async (req, res) => {
  try {
    const db = await getDb();
    const avis = queryAll(db, 'SELECT a.*, u.nom as joueur_nom FROM avis a JOIN users u ON u.id = a.joueur_id WHERE a.terrain_id = ? ORDER BY a.created_at DESC', [Number(req.params.terrainId)]);
    res.json(avis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// NOTIFICATIONS
// ============================================================
app.get('/api/notifications', optionalAuth, async (req, res) => {
  try {
    if (!req.user) return res.json([]);
    const db = await getDb();
    const destType = req.user.accountType === 'user' ? 'user' : req.user.accountType;
    const notifs = queryAll(db, 'SELECT * FROM notifications WHERE destinataire_type = ? AND destinataire_id = ? ORDER BY created_at DESC', [destType, req.user.id]);
    res.json(notifs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/notifications/:id/lire', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    runSql(db, 'UPDATE notifications SET lu = 1 WHERE id = ?', [Number(req.params.id)]);
    res.json({ message: 'Notification lue' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// SUPER ADMIN
// ============================================================
app.get('/api/admin/stats', authMiddleware, requireRole('superadmin'), async (req, res) => {
  try {
    const db = await getDb();
    const totalTerrains = queryOne(db, 'SELECT COUNT(*) as count FROM terrains');
    const totalUsers = queryOne(db, "SELECT COUNT(*) as count FROM users WHERE role = 'joueur'");
    const totalProprietaires = queryOne(db, 'SELECT COUNT(*) as count FROM proprietaires');
    const totalReservations = queryOne(db, 'SELECT COUNT(*) as count FROM reservations');
    const totalRevenue = queryOne(db, "SELECT COALESCE(SUM(montant), 0) as total FROM reservations WHERE statut = 'acceptee'");
    const proprietaires = queryAll(db, 'SELECT id, nom, email, telephone, plan, statut, created_at FROM proprietaires ORDER BY created_at DESC');
    
    res.json({
      totalTerrains: totalTerrains.count,
      totalUsers: totalUsers.count,
      totalProprietaires: totalProprietaires.count,
      totalReservations: totalReservations.count,
      totalRevenue: totalRevenue.total,
      proprietaires
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/admin/proprietaires/:id', authMiddleware, requireRole('superadmin'), async (req, res) => {
  try {
    const db = await getDb();
    const { statut } = req.body;
    runSql(db, 'UPDATE proprietaires SET statut = ? WHERE id = ?', [statut, Number(req.params.id)]);
    res.json({ message: 'Propriétaire mis à jour' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/admin/audit', authMiddleware, requireRole('superadmin'), async (req, res) => {
  try {
    const db = await getDb();
    const logs = queryAll(db, 'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100');
    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// PROFIL
// ============================================================
app.put('/api/profil', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const { nom, telephone } = req.body;
    if (req.user.accountType === 'user') {
      runSql(db, 'UPDATE users SET nom = ?, telephone = ? WHERE id = ?', [nom, telephone, req.user.id]);
    } else if (req.user.accountType === 'proprietaire') {
      runSql(db, 'UPDATE proprietaires SET nom = ?, telephone = ? WHERE id = ?', [nom, telephone, req.user.id]);
    }
    res.json({ message: 'Profil mis à jour' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// SERVE STATIC (production)
// ============================================================
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

// ============================================================
// START
// ============================================================
async function start() {
  await getDb(); // Initialize DB
  app.listen(PORT, () => {
    console.log(`🚀 TerrainSN API démarrée sur http://localhost:${PORT}`);
  });
}

start();
