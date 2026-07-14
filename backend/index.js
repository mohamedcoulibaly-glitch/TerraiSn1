require('dotenv').config();
require('./whatsappClient');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDb, queryAll, queryOne, runSql, saveDb, transaction } = require('./database');
const paytechService = require('./paytechService');
const notificationService = require('./notificationService');
const otpService = require('./otpService');
const adminRoutes = require('./routes/admin');
const roleRoutes = require('./routes/roles');
const path = require('path');
const logger = require('./logger');
let cron = null;
try {
  cron = require('node-cron');
} catch {
  cron = null;
}

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'terrainsn_secret_key_2026';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET est obligatoire en production');
}

// Middleware
const allowedOrigins = (process.env.CORS_ORIGINS || process.env.APP_DOMAIN || 'http://localhost:8080')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
}));
app.use(express.json());
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.error('index.js', 'JSON invalide recu', err);
    return res.status(400).json({ error: 'Requete JSON invalide' });
  }
  return next(err);
});
app.use('/api/admin', adminRoutes);
app.use('/api', roleRoutes);

const rateLimitBuckets = new Map();
function rateLimit({ windowMs, max, keyPrefix }) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const phone = req.body?.telephone || req.body?.identifier || req.body?.email || '';
    const key = `${keyPrefix}:${ip}:${String(phone).replace(/\D/g, '')}`;
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    rateLimitBuckets.set(key, bucket);
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Trop de tentatives. Veuillez reessayer plus tard.' });
    }
    return next();
  };
}

const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 12, keyPrefix: 'auth' });
const otpRateLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 5, keyPrefix: 'otp' });

// ============================================================
// MIDDLEWARE AUTH
// ============================================================
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    if (decoded.must_change_password && req.path !== '/api/auth/change-password' && req.path !== '/api/auth/me') {
      return res.status(403).json({ error: 'Changement de mot de passe requis', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
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

// Inscription joueur → envoi OTP WhatsApp (pas de JWT tant que non vérifié)
app.post('/api/auth/register', otpRateLimit, async (req, res) => {
  try {
    const db = await getDb();
    const { prenom, nom, telephone, password, email } = req.body;

    if (!nom || !telephone || !password) {
      return res.status(400).json({ error: 'Prénom/nom, téléphone et mot de passe obligatoires' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    }
    if (!otpService.isValidSenegalMobile(telephone)) {
      return res.status(400).json({ error: 'Numéro invalide. Format attendu : 7X XXX XX XX' });
    }

    const phoneDigits = otpService.normalizeTelephone(telephone);
    const fullName = [prenom, nom].filter(Boolean).join(' ').trim();

    const existingPhone = queryAll(db, 'SELECT id, telephone, telephone_verified, role FROM users').find(
      (u) => otpService.normalizeTelephone(u.telephone) === phoneDigits
    );
    if (existingPhone && Number(existingPhone.telephone_verified) === 1) {
      return res.status(409).json({ error: 'Ce numéro est déjà utilisé' });
    }

    const password_hash = bcrypt.hashSync(password, 12);
    const generatedEmail = email || `joueur-${phoneDigits}@terrainsn.local`;

    let userId;
    if (existingPhone && Number(existingPhone.telephone_verified) !== 1) {
      // Réinscription d'un compte non vérifié : maj des infos + nouveau OTP
      runSql(
        db,
        `UPDATE users SET nom = ?, prenom = ?, password_hash = ?, email = ?, role = 'joueur', is_active = 1, telephone_verified = 0
         WHERE id = ?`,
        [fullName, prenom || null, password_hash, generatedEmail, existingPhone.id]
      );
      userId = existingPhone.id;
    } else {
      const existingEmail = queryOne(db, 'SELECT id FROM users WHERE email = ?', [generatedEmail]);
      if (existingEmail) return res.status(409).json({ error: 'Compte déjà existant' });

      const result = runSql(
        db,
        `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active, telephone_verified)
         VALUES (?, ?, ?, ?, ?, 'joueur', 1, 0)`,
        [fullName, prenom || null, generatedEmail, password_hash, otpService.formatDisplayPhone(phoneDigits)]
      );
      userId = result.lastInsertRowid;
    }

    await otpService.createAndSendOtp(db, { telephone: phoneDigits, userId });

    res.status(201).json({
      success: true,
      message: 'Code envoyé',
      telephone: otpService.formatDisplayPhone(phoneDigits),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

// Vérification OTP → JWT joueur
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const db = await getDb();
    const { telephone, code } = req.body;
    if (!telephone || !code) {
      return res.status(400).json({ error: 'Téléphone et code obligatoires' });
    }

    const { otp, telephoneDigits, error } = otpService.findValidOtp(db, telephone, code);
    if (error) return res.status(400).json({ error });

    const user = queryAll(db, 'SELECT id, nom, prenom, email, telephone, role, telephone_verified FROM users')
      .find((u) => otpService.normalizeTelephone(u.telephone) === telephoneDigits);

    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable. Réinscrivez-vous.' });

    runSql(db, 'UPDATE auth_otps SET used = 1 WHERE id = ?', [otp.id]);
    runSql(db, 'UPDATE users SET telephone_verified = 1 WHERE id = ?', [user.id]);
    await otpService.invalidateOtps(db, telephoneDigits);

    const safeUser = {
      id: user.id,
      nom: user.nom,
      prenom: user.prenom,
      email: user.email,
      telephone: user.telephone,
      role: 'joueur',
      accountType: 'user',
      telephone_verified: 1,
    };

    const token = jwt.sign(
      { id: user.id, email: user.email, telephone: user.telephone, role: 'joueur', accountType: 'user' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ success: true, user: safeUser, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Renvoyer un OTP (invalide l'ancien)
app.post('/api/auth/resend-otp', otpRateLimit, async (req, res) => {
  try {
    const db = await getDb();
    const { telephone } = req.body;
    if (!telephone) return res.status(400).json({ error: 'Téléphone obligatoire' });
    if (!otpService.isValidSenegalMobile(telephone)) {
      return res.status(400).json({ error: 'Numéro invalide. Format attendu : 7X XXX XX XX' });
    }

    const phoneDigits = otpService.normalizeTelephone(telephone);
    const user = queryAll(db, 'SELECT id, telephone, telephone_verified FROM users')
      .find((u) => otpService.normalizeTelephone(u.telephone) === phoneDigits);

    if (!user) return res.status(404).json({ error: 'Aucun compte en attente pour ce numéro' });
    if (Number(user.telephone_verified) === 1) {
      return res.status(400).json({ error: 'Ce numéro est déjà vérifié. Connectez-vous.' });
    }

    await otpService.createAndSendOtp(db, { telephone: phoneDigits, userId: user.id });

    res.json({ success: true, message: 'Code renvoyé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

// Connexion (tous types de comptes)
app.post('/api/auth/login', authRateLimit, async (req, res) => {
  try {
    const db = await getDb();
    const { email, telephone, password, accountType } = req.body;
    const identifier = String(email || telephone || '').trim();
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Identifiant et mot de passe obligatoires' });
    }

    const phoneDigits = otpService.normalizeTelephone(identifier);
    const matchPhone = (row) =>
      phoneDigits && otpService.normalizeTelephone(row.telephone) === phoneDigits;
    const matchEmail = (row) => row.email && String(row.email).toLowerCase() === identifier.toLowerCase();
    const findIn = (rows) => rows.find((row) => matchEmail(row) || matchPhone(row)) || null;

    let account = null;
    let role = '';
    let resolvedType = accountType || null;

    if (resolvedType === 'proprietaire') {
      account = findIn(queryAll(db, 'SELECT * FROM proprietaires'));
      role = 'proprietaire';
    } else if (resolvedType === 'employe') {
      account = findIn(queryAll(db, 'SELECT * FROM employes'));
      role = 'gerant';
    } else if (resolvedType === 'user') {
      account = findIn(queryAll(db, 'SELECT * FROM users'));
      role = account?.role === 'super_admin' || account?.role === 'superadmin'
        ? (account.role === 'superadmin' ? 'super_admin' : account.role)
        : (account?.role || 'joueur');
      if (role === 'superadmin') role = 'super_admin';
    } else {
      // Auto-détection du rôle (login unique frontend) — ne change pas les tables métier
      const asUser = findIn(queryAll(db, 'SELECT * FROM users'));
      if (asUser) {
        account = asUser;
        resolvedType = 'user';
        role = asUser.role === 'superadmin' ? 'super_admin' : (asUser.role || 'joueur');
      } else {
        const asProprio = findIn(queryAll(db, 'SELECT * FROM proprietaires'));
        if (asProprio) {
          account = asProprio;
          resolvedType = 'proprietaire';
          role = 'proprietaire';
        } else {
          const asEmploye = findIn(queryAll(db, 'SELECT * FROM employes'));
          if (asEmploye) {
            account = asEmploye;
            resolvedType = 'employe';
            role = 'gerant';
          }
        }
      }
    }

    if (!account) return res.status(401).json({ error: 'Identifiants incorrects' });
    if (!bcrypt.compareSync(password, account.password_hash)) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    // Joueurs inscrits via OTP : bloquer tant que le téléphone n'est pas vérifié
    if (
      (resolvedType === 'user' || !resolvedType) &&
      (role === 'joueur' || role === 'user') &&
      account.telephone_verified !== undefined &&
      account.telephone_verified !== null &&
      Number(account.telephone_verified) === 0
    ) {
      return res.status(403).json({
        error: 'Compte non vérifié. Validez le code WhatsApp reçu.',
        code: 'OTP_REQUIRED',
        telephone: account.telephone,
      });
    }

    const tokenPayload = {
      id: account.id,
      email: account.email,
      telephone: account.telephone,
      role,
      accountType: resolvedType || 'user',
      must_change_password: Boolean(account.must_change_password),
    };
    if (resolvedType === 'employe') {
      tokenPayload.terrain_id = account.terrain_id;
      tokenPayload.proprietaire_id = account.proprietaire_id;
    }
    if (resolvedType === 'proprietaire') {
      tokenPayload.proprietaire_id = account.id;
    }

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

    const { password_hash, ...safeAccount } = account;
    res.json({ user: { ...safeAccount, role, accountType: resolvedType || 'user' }, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Connexion backoffice uniquement (téléphone OU email) — refuse les joueurs
app.post('/api/backoffice/auth/login', authRateLimit, async (req, res) => {
  try {
    const db = await getDb();
    const { email, telephone, password } = req.body;
    const identifier = String(email || telephone || '').trim();
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Identifiant et mot de passe obligatoires' });
    }

    const isEmail = identifier.includes('@');
    let phoneDigits = identifier.replace(/\D/g, '');
    if (phoneDigits.startsWith('00')) phoneDigits = phoneDigits.slice(2);
    if (phoneDigits.length === 9 && phoneDigits.startsWith('7')) phoneDigits = `221${phoneDigits}`;
    const matchPhone = (row) => {
      if (!phoneDigits) return false;
      let rowDigits = String(row.telephone || '').replace(/\D/g, '');
      if (rowDigits.startsWith('00')) rowDigits = rowDigits.slice(2);
      if (rowDigits.length === 9 && rowDigits.startsWith('7')) rowDigits = `221${rowDigits}`;
      return rowDigits === phoneDigits;
    };
    const matchEmail = (row) => row.email && String(row.email).toLowerCase() === identifier.toLowerCase();
    const findIn = (rows) =>
      rows.find((row) => (isEmail ? matchEmail(row) : matchPhone(row))) || null;

    let account = null;
    let role = '';
    let resolvedType = null;

    const asProprio = findIn(queryAll(db, 'SELECT * FROM proprietaires'));
    if (asProprio) {
      account = asProprio;
      resolvedType = 'proprietaire';
      role = 'proprietaire';
    } else {
      const asEmploye = findIn(queryAll(db, 'SELECT * FROM employes'));
      if (asEmploye) {
        account = asEmploye;
        resolvedType = 'employe';
        role = 'gerant';
      } else {
        const asUser = findIn(queryAll(db, 'SELECT * FROM users'));
        if (asUser) {
          account = asUser;
          resolvedType = 'user';
          role = asUser.role === 'superadmin' ? 'super_admin' : (asUser.role || 'joueur');
          if (role === 'superadmin') role = 'super_admin';
        }
      }
    }

    if (!account) return res.status(401).json({ error: 'Identifiants incorrects' });
    if (!bcrypt.compareSync(password, account.password_hash)) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    if (role === 'joueur' || role === 'user') {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    const tokenPayload = {
      id: account.id,
      email: account.email,
      telephone: account.telephone,
      role,
      accountType: resolvedType,
      must_change_password: Boolean(account.must_change_password),
    };
    if (resolvedType === 'employe') {
      tokenPayload.terrain_id = account.terrain_id;
      tokenPayload.proprietaire_id = account.proprietaire_id;
    }
    if (resolvedType === 'proprietaire') {
      tokenPayload.proprietaire_id = account.id;
    }

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });
    const { password_hash, ...safeAccount } = account;
    res.json({ user: { ...safeAccount, role, accountType: resolvedType }, token });
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
      account = queryOne(db, 'SELECT id, nom, email, telephone, plan, statut, must_change_password, created_at FROM proprietaires WHERE id = ?', [req.user.id]);
    } else if (req.user.accountType === 'employe') {
      account = queryOne(db, 'SELECT id, nom, email, telephone, whatsapp_number, terrain_id, is_active, must_change_password, created_at FROM employes WHERE id = ?', [req.user.id]);
    } else {
      account = queryOne(db, 'SELECT id, nom, email, telephone, role, is_active, must_change_password, created_at FROM users WHERE id = ?', [req.user.id]);
    }
    if (!account) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    res.json({ ...account, role: req.user.role, accountType: req.user.accountType });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  try {
    if (!req.body.password || req.body.password.length < 8) return res.status(400).json({ error: 'Mot de passe trop court' });
    const db = await getDb();
    const hash = bcrypt.hashSync(req.body.password, 12);
    const table = req.user.accountType === 'proprietaire' ? 'proprietaires' : req.user.accountType === 'employe' ? 'employes' : 'users';
    runSql(db, `UPDATE ${table} SET password_hash = ?, must_change_password = 0 WHERE id = ?`, [hash, req.user.id]);
    res.json({ message: 'Mot de passe modifié' });
  } catch {
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

    const reservationsExistantes = queryAll(db, "SELECT heure_debut, heure_fin FROM reservations WHERE terrain_id = ? AND date = ? AND statut IN ('confirme', 'acceptee', 'en_attente')", [terrain.id, date]);
    const blocages = queryAll(db, 'SELECT heure_debut, heure_fin FROM blocages_creneaux WHERE terrain_id = ? AND date = ?', [terrain.id, date]);

    const startHour = parseInt(horaire.heure_debut.split(':')[0]);
    const endHour = parseInt(horaire.heure_fin.split(':')[0]);
    const creneaux = [];

    for (let h = startHour; h < endHour; h++) {
      const slot = `${h.toString().padStart(2, '0')}:00`;
      const slotEnd = `${(h + 1).toString().padStart(2, '0')}:00`;

      const isReserved = reservationsExistantes.some(r => slot >= r.heure_debut && slot < r.heure_fin);
      const isBlocked = blocages.some(b => slot >= b.heure_debut && slot < b.heure_fin);

      let creneau = queryOne(db, 'SELECT * FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?', [terrain.id, date, slot, slotEnd]);
      if (!creneau) {
        runSql(db, 'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)', [terrain.id, date, slot, slotEnd, isReserved ? 'reserve' : 'libre']);
        creneau = queryOne(db, 'SELECT * FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?', [terrain.id, date, slot, slotEnd]);
      }
      const disponible = creneau.statut === 'libre' && !isReserved && !isBlocked;
      creneaux.push({ id: creneau.id, heure: slot, heure_fin: slotEnd, statut: creneau.statut, disponible, bloque: isBlocked });
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
    const { nom, adresse, ville, sport, type, prix_heure, prix_moitie, prix_entier, montant_acompte, acompte, description, telephone } = req.body;
    const prixEntier = Number(prix_entier || prix_heure);
    const prixMoitie = Number(prix_moitie || prixEntier * 0.6);
    const acompteTerrain = Number(acompte || montant_acompte || 5000);
    const result = runSql(db, 'INSERT INTO terrains (proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_moitie, prix_entier, montant_acompte, acompte, description, telephone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, nom, adresse, ville, sport || 'foot', type || '11 vs 11', prixEntier, prixMoitie, prixEntier, acompteTerrain, acompteTerrain, description, telephone]);
    
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

    const { nom, adresse, ville, sport, type, prix_heure, prix_moitie, prix_entier, montant_acompte, acompte, description, telephone, is_active } = req.body;
    const prixEntier = Number(prix_entier || prix_heure || terrain.prix_entier || terrain.prix_heure);
    const acompteTerrain = Number(acompte || montant_acompte || terrain.acompte || terrain.montant_acompte || 5000);
    runSql(db, 'UPDATE terrains SET nom=?, adresse=?, ville=?, sport=?, type=?, prix_heure=?, prix_moitie=?, prix_entier=?, montant_acompte=?, acompte=?, description=?, telephone=?, is_active=? WHERE id=?',
      [nom || terrain.nom, adresse || terrain.adresse, ville || terrain.ville, sport || terrain.sport, type || terrain.type, prixEntier, Number(prix_moitie || terrain.prix_moitie || prixEntier * 0.6), prixEntier, acompteTerrain, acompteTerrain, description || terrain.description, telephone || terrain.telephone, is_active !== undefined ? is_active : terrain.is_active, terrain.id]);
    
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

async function creerReservationAvecPaiement(req, res, creePar, lockDurationMs, terrainIdForce = null) {
  try {
    const db = await getDb();
    const { terrain_id, date, heure_debut, heure_fin, joueur_nom, joueur_telephone, format_terrain = 'entier' } = req.body;
    const terrainId = terrainIdForce || Number(terrain_id);
    if (!joueur_nom || !joueur_telephone) {
      return res.status(400).json({ error: 'Nom et téléphone du joueur requis' });
    }

    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });

    if (!date || !heure_debut || !heure_fin) return res.status(400).json({ error: 'Créneau invalide' });
    const startH = parseInt(heure_debut.split(':')[0]);
    const endH = parseInt(heure_fin.split(':')[0]);
    const duree = endH - startH;
    if (duree <= 0) return res.status(400).json({ error: 'Créneau invalide' });
    if (!['moitie', 'entier'].includes(format_terrain)) return res.status(400).json({ error: 'Format de terrain invalide' });
    const prixHoraire = Number(format_terrain === 'moitie' ? terrain.prix_moitie : terrain.prix_entier);
    const montant = prixHoraire * duree;
    const acompteTerrain = Number(terrain.acompte || terrain.montant_acompte || 5000);
    const acompte = Math.min(acompteTerrain, montant);
    const resteAPayer = Math.max(0, montant - acompte);
    const verrouExpireAt = Date.now() + lockDurationMs;

    const reservationId = transaction(db, () => {
      let creneau = queryOne(db, 'SELECT * FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?', [terrainId, date, heure_debut, heure_fin]);
      if (!creneau) {
        db.run('INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)', [terrainId, date, heure_debut, heure_fin, 'libre']);
        creneau = queryOne(db, 'SELECT * FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?', [terrainId, date, heure_debut, heure_fin]);
      }
      if (creneau.statut !== 'libre') {
        const error = new Error('Créneau déjà réservé ou en attente de paiement');
        error.statusCode = 409;
        throw error;
      }
      db.run("UPDATE creneaux SET statut = 'en_attente_paiement' WHERE id = ? AND statut = 'libre'", [creneau.id]);
      db.run(`INSERT INTO reservations
        (terrain_id, creneau_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin, montant, prix_total, acompte, reste_a_payer, format_terrain, statut, expire_at, verrou_expire_at, cree_par)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?, ?, ?)`,
        [terrainId, creneau.id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin, montant, montant, acompte, resteAPayer, format_terrain, new Date(verrouExpireAt).toISOString(), verrouExpireAt, creePar]);
      return queryOne(db, 'SELECT last_insert_rowid() AS id').id;
    });

    let reservation = queryOne(db, `
      SELECT r.*, t.nom as terrain_nom, t.ville as terrain_ville, t.type as terrain_type
      FROM reservations r JOIN terrains t ON t.id = r.terrain_id WHERE r.id = ?
    `, [reservationId]);

    try {
      const payment = await paytechService.creerLienPaiement(reservation);
      runSql(db, 'UPDATE reservations SET lien_paiement = ? WHERE id = ?', [payment.redirectUrl, reservation.id]);
      reservation = { ...reservation, lien_paiement: payment.redirectUrl, redirect_url: payment.redirectUrl };
    } catch (error) {
      transaction(db, () => {
        db.run("UPDATE creneaux SET statut = 'libre' WHERE id = ? AND statut = 'en_attente_paiement'", [reservation.creneau_id]);
        db.run("UPDATE reservations SET statut = 'annule' WHERE id = ?", [reservation.id]);
      });
      throw error;
    }

    if (creePar === 'gerant') {
      await notificationService.envoyerLienPaiement(reservation.id).catch((error) => logger.error('index.js', 'Envoi lien paiement WhatsApp impossible', error));
      return res.status(201).json({ success: true, reservation_id: reservation.id });
    }

    res.status(201).json(reservation);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
}

app.post('/api/reservations', authMiddleware, requireRole('joueur'), (req, res) => creerReservationAvecPaiement(req, res, 'joueur', 10 * 60 * 1000));

app.post('/api/reservations/gerant', authMiddleware, requireRole('gerant'), async (req, res) => {
  if (Number(req.body.terrain_id || req.user.terrain_id) !== Number(req.user.terrain_id)) {
    return res.status(403).json({ error: 'Ce terrain ne vous est pas attribué' });
  }
  return creerReservationAvecPaiement(req, res, 'gerant', 2 * 60 * 60 * 1000, Number(req.user.terrain_id));
});

app.post('/api/gerant/reservations', authMiddleware, requireRole('gerant'), async (req, res) => {
  if (Number(req.body.terrain_id || req.user.terrain_id) !== Number(req.user.terrain_id)) return res.status(403).json({ error: 'Accès refusé' });
  return creerReservationAvecPaiement(req, res, 'gerant', 2 * 60 * 60 * 1000, Number(req.user.terrain_id));
});

app.get('/api/whatsapp/status', authMiddleware, requireRole('gerant', 'proprietaire'), (req, res) => {
  const whatsappClient = require('./whatsappClient');
  res.json({ connected: Boolean(whatsappClient.isReady), mock: String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true' });
});

app.post('/api/reservations/:id/renvoyer-lien', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const reservation = queryOne(db, 'SELECT id FROM reservations WHERE id = ? AND terrain_id = ? AND statut = ?', [Number(req.params.id), req.user.terrain_id, 'en_attente']);
    if (!reservation) return res.status(404).json({ error: 'Réservation en attente introuvable pour ce terrain' });
    await notificationService.envoyerLienPaiement(reservation.id);
    res.json({ message: 'Lien WhatsApp renvoyé' });
  } catch (error) {
    console.error('Renvoi WhatsApp:', error);
    res.status(503).json({ error: error.message || 'Envoi WhatsApp impossible' });
  }
});

// Recharger une réservation (utile pour refresh / accès direct)
app.get('/api/reservations/:id(\\d+)', optionalAuth, async (req, res) => {
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
    if (!['en_attente', 'confirme', 'acceptee'].includes(reservation.statut)) {
      return res.status(400).json({ error: 'Réservation ne peut pas être annulée' });
    }
    transaction(db, () => {
      db.run("UPDATE reservations SET statut = 'annule' WHERE id = ?", [reservation.id]);
      if (reservation.statut === 'en_attente' && reservation.creneau_id) {
        db.run("UPDATE creneaux SET statut = 'libre' WHERE id = ? AND statut = 'en_attente_paiement'", [reservation.creneau_id]);
      }
    });
    res.json({ message: 'Réservation annulée' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/reservations/:id/traiter', authMiddleware, requireRole('gerant', 'proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const { action } = req.body;
    if (action === 'acceptee') {
      return res.status(400).json({ error: 'Une réservation ne peut être confirmée que par le webhook PayTech' });
    }
    if (action !== 'refusee') {
      return res.status(400).json({ error: 'Action invalide' });
    }
    const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [Number(req.params.id)]);
    if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });
    transaction(db, () => {
      db.run("UPDATE reservations SET statut = 'annule', traite_par = ? WHERE id = ?", [req.user.id, reservation.id]);
      if (reservation.creneau_id) db.run("UPDATE creneaux SET statut = 'libre' WHERE id = ? AND statut = 'en_attente_paiement'", [reservation.creneau_id]);
    });
    res.json({ message: 'Réservation annulée' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/reservations/terrain/:terrainId', authMiddleware, requireRole('gerant', 'proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const reservations = queryAll(db, `
      SELECT r.*, u.nom as joueur_nom, u.telephone as joueur_telephone, t.nom as terrain_nom
      FROM reservations r LEFT JOIN users u ON u.id = r.joueur_id JOIN terrains t ON t.id = r.terrain_id
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
function genererCodeReservation(db) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = `TF-${Math.floor(100000 + Math.random() * 900000)}`;
    if (!queryOne(db, 'SELECT id FROM reservations WHERE code_reservation = ?', [code])) return code;
  }
  throw new Error('Impossible de générer un code de réservation unique');
}

function reservationIdDepuisReference(refCommand) {
  const match = String(refCommand || '').match(/^TF-(\d+)-/);
  return match ? Number(match[1]) : 0;
}

async function traiterConfirmationPaytech(db, reservationId, refCommand) {
  let action = 'ignore';
  let reversementInfo = null;

  transaction(db, () => {
    const currentReservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (!currentReservation) return;
    const existingPaidPayment = queryOne(db, "SELECT id FROM paiements WHERE reservation_id = ? AND statut = 'paye' LIMIT 1", [reservationId]);
    const existingReversement = queryOne(db, 'SELECT id FROM reversements WHERE reservation_id = ? LIMIT 1', [reservationId]);
    if (currentReservation.statut === 'confirme' || existingPaidPayment || existingReversement) {
      action = 'already_confirmed';
      return;
    }
    const creneau = queryOne(db, 'SELECT * FROM creneaux WHERE id = ?', [currentReservation.creneau_id]);

    if (creneau?.statut === 'en_attente_paiement' && currentReservation.statut === 'en_attente') {
      const terrain = queryOne(db, `SELECT t.id AS terrain_id, t.acompte, t.montant_acompte, t.commission,
        e.id AS gerant_id, e.telephone AS gerant_tel, e.whatsapp_number AS gerant_whatsapp, e.nom AS gerant_nom
        FROM terrains t
        LEFT JOIN employes e ON e.terrain_id = t.id AND e.is_active = 1
        WHERE t.id = ?
        LIMIT 1`, [currentReservation.terrain_id]);
      const montantAcompte = Number(terrain?.acompte || terrain?.montant_acompte || currentReservation.acompte || 5000);
      const montantCommission = Number(terrain?.commission || 400);
      const montantReverse = Math.max(0, montantAcompte - montantCommission);
      const code = genererCodeReservation(db);

      db.run("UPDATE creneaux SET statut = 'reserve' WHERE id = ?", [creneau.id]);
      db.run("UPDATE reservations SET statut = 'confirme', code_reservation = ?, acompte = ? WHERE id = ?", [code, montantAcompte, reservationId]);
      db.run(`INSERT INTO paiements
        (reservation_id, montant, methode, statut, reference_externe, reference_paytech, montant_acompte, montant_commission, montant_reverse, statut_reversement)
        VALUES (?, ?, 'paytech', 'paye', ?, ?, ?, ?, ?, ?)`,
        [reservationId, montantAcompte, refCommand, refCommand, montantAcompte, montantCommission, montantReverse, terrain?.gerant_id ? 'effectue' : 'en_attente']);

      if (terrain?.gerant_id) {
        db.run(`INSERT INTO portefeuille_gerant
          (gerant_id, terrain_id, solde_disponible, total_encaisse, total_commission_prelevee)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(gerant_id, terrain_id) DO UPDATE SET
            solde_disponible = solde_disponible + excluded.solde_disponible,
            total_encaisse = total_encaisse + excluded.total_encaisse,
            total_commission_prelevee = total_commission_prelevee + excluded.total_commission_prelevee,
            updated_at = CURRENT_TIMESTAMP`,
          [terrain.gerant_id, terrain.terrain_id, montantReverse, montantAcompte, montantCommission]);
        db.run(`INSERT OR IGNORE INTO reversements (gerant_id, terrain_id, reservation_id, montant, statut)
          VALUES (?, ?, ?, ?, 'effectue')`, [terrain.gerant_id, terrain.terrain_id, reservationId, montantReverse]);
        reversementInfo = {
          telephone: terrain.gerant_whatsapp || terrain.gerant_tel,
          nom: terrain.gerant_nom,
          montant_acompte: montantAcompte,
          montant_commission: montantCommission,
          montant_reverse: montantReverse,
          reservationId,
          solde_disponible: queryOne(db, 'SELECT solde_disponible FROM portefeuille_gerant WHERE gerant_id = ? AND terrain_id = ?', [terrain.gerant_id, terrain.terrain_id])?.solde_disponible || montantReverse,
        };
      }
      action = 'confirm';
    } else if (creneau?.statut === 'reserve' && currentReservation.statut === 'en_attente') {
      action = 'refund';
    }
  });

  return { action, reversementInfo };
}

async function confirmerPaiementEtNotifier(reservationId, refCommand) {
  const db = await getDb();
  const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  if (!reservation) return { action: 'missing' };

  const { action, reversementInfo } = await traiterConfirmationPaytech(db, reservationId, refCommand);
  if (action === 'confirm') {
    await notificationService.envoyerConfirmation(reservationId).catch((error) => {
      logger.error('index.js', 'Notification confirmation', error);
    });
    if (reversementInfo) {
      await notificationService.envoyerReversement(reversementInfo).catch((error) => {
        logger.error('index.js', 'Notification reversement', error);
      });
    }
  } else if (action === 'refund') {
    await paytechService.rembourser(refCommand);
    transaction(db, () => {
      db.run("UPDATE reservations SET statut = 'annule' WHERE id = ?", [reservationId]);
      db.run(`INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe, reference_paytech)
        VALUES (?, ?, 'paytech', 'rembourse', ?, ?)`, [reservationId, reservation.acompte, refCommand, refCommand]);
    });
    await notificationService.envoyerRemboursement(reservationId).catch((error) => {
      logger.error('index.js', 'Notification remboursement', error);
    });
  }
  return { action };
}

app.post('/webhook/paytech', async (req, res) => {
  const refCommand = req.body.ref_command || req.body.refCommand;
  const receivedHash = req.headers['x-paytech-signature'] || req.headers['x-paytech-hash'] || req.headers.hash;
  if (!paytechService.verifierHash(refCommand, receivedHash)) {
    return res.status(400).json({ error: 'Signature PayTech invalide' });
  }

  try {
    const custom = typeof req.body.custom_field === 'string' ? JSON.parse(req.body.custom_field) : (req.body.custom_field || {});
    const reservationId = Number(custom.reservation_id || req.body.reservation_id || reservationIdDepuisReference(refCommand));
    await confirmerPaiementEtNotifier(reservationId, refCommand);
    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error('index.js', 'Webhook PayTech', error);
    return res.status(200).json({ received: true, processing_error: true });
  }
});

async function simulerPaytech(req, res) {
  if (!paytechService.estModeMock()) return res.status(404).json({ error: 'Simulation PayTech desactivee' });
  try {
    const refCommand = String(req.body.ref_command || req.body.ref || '');
    const reservationId = Number(req.body.reservation_id || reservationIdDepuisReference(refCommand));
    const action = req.body.action || 'success';
    if (!reservationId || !refCommand.startsWith(`TF-${reservationId}-`) || !['success', 'cancel', 'failed'].includes(action)) {
      return res.status(400).json({ error: 'Paiement simule invalide' });
    }

    const db = await getDb();
    const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (!reservation) return res.status(404).json({ error: 'Reservation non trouvee' });
    const domain = (process.env.APP_DOMAIN || 'http://localhost:8080').replace(/\/$/, '');

    if (action !== 'success') {
      transaction(db, () => {
        db.run("UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut = 'en_attente'", [reservationId]);
        db.run("UPDATE creneaux SET statut = 'libre' WHERE id = ? AND statut = 'en_attente_paiement'", [reservation.creneau_id]);
      });
      return res.json({ redirect_url: `${domain}/reservation/annule?terrain_id=${reservation.terrain_id}` });
    }

    await confirmerPaiementEtNotifier(reservationId, refCommand);
    const confirmed = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [reservationId]);
    if (confirmed?.statut !== 'confirme') throw new Error('La confirmation simulee a echoue');
    return res.json({ redirect_url: `${domain}/reservation/succes?id=${reservationId}` });
  } catch (error) {
    logger.error('index.js', 'Simulation PayTech', error);
    return res.status(500).json({ error: 'Le paiement n a pas pu etre confirme. Veuillez reessayer.' });
  }
}

app.post('/webhook/paytech/simulate', simulerPaytech);
app.post('/api/webhook/paytech/simulate', simulerPaytech);

app.put('/api/reservations/:id/jouer', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ? AND terrain_id = ?', [Number(req.params.id), req.user.terrain_id]);
    if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée pour ce terrain' });
    if (reservation.statut !== 'confirme') return res.status(400).json({ error: 'Seule une réservation confirmée peut passer à jouée' });
    const solde = Number(reservation.reste_a_payer || 0);
    const methode = ['especes', 'wave', 'orange_money'].includes(req.body.methode) ? req.body.methode : 'especes';

    transaction(db, () => {
      db.run("UPDATE reservations SET statut = 'joue', reste_a_payer = 0 WHERE id = ? AND statut = 'confirme'", [reservation.id]);
      db.run(`INSERT INTO matchs (reservation_id, terrain_id, gerant_id, montant_total, acompte_paye, solde_paye, methode_solde)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [reservation.id, reservation.terrain_id, req.user.id, reservation.prix_total || reservation.montant, reservation.acompte || 0, solde, methode]);
      if (solde > 0) {
        db.run(`INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe)
          VALUES (?, ?, ?, 'paye', ?)`, [reservation.id, solde, methode, `SOLDE-${reservation.id}-${Date.now()}`]);
      }
    });
    const match = queryOne(db, 'SELECT * FROM matchs WHERE reservation_id = ?', [reservation.id]);
    res.json({ message: 'Match marqué comme joué et revenu comptabilisé', match });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.post('/api/paytech/mock/complete', async (req, res) => {
  if (!paytechService.estModeMock()) return res.status(404).json({ error: 'Mode PayTech mock désactivé' });
  try {
    const reservationId = Number(req.body.reservation_id);
    const refCommand = String(req.body.ref_command || '');
    const action = req.body.action;
    if (!reservationId || !refCommand.startsWith(`TF-${reservationId}-`) || !['success', 'cancel'].includes(action)) {
      return res.status(400).json({ error: 'Paiement simulé invalide' });
    }

    const db = await getDb();
    const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });
    const domain = (process.env.APP_DOMAIN || 'http://localhost:8080').replace(/\/$/, '');

    if (action === 'cancel') {
      transaction(db, () => {
        db.run("UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut = 'en_attente'", [reservationId]);
        db.run("UPDATE creneaux SET statut = 'libre' WHERE id = ? AND statut = 'en_attente_paiement'", [reservation.creneau_id]);
      });
      return res.json({ redirect_url: `${domain}/reservation/annule?terrain_id=${reservation.terrain_id}` });
    }

    const webhookResponse = await fetch(`http://127.0.0.1:${PORT}/webhook/paytech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PayTech-Signature': paytechService.signerReference(refCommand) },
      body: JSON.stringify({ ref_command: refCommand, custom_field: JSON.stringify({ reservation_id: reservationId }) }),
    });
    if (!webhookResponse.ok) throw new Error('Le webhook simulé a été rejeté');
    const confirmed = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [reservationId]);
    if (confirmed?.statut !== 'confirme') throw new Error('La confirmation simulée a échoué');
    return res.json({ redirect_url: `${domain}/reservation/succes?id=${reservationId}` });
  } catch (error) {
    logger.error('index.js', 'PayTech mock legacy', error);
    return res.status(500).json({ error: error.message || 'Erreur du paiement simulé' });
  }
});

app.post('/api/paiements', async (req, res) => {
  res.status(410).json({ error: 'Le paiement direct est désactivé. Utilisez le lien PayTech de la réservation.' });
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

    const revenueRow = queryOne(db, `SELECT COALESCE(SUM(prix_total), 0) as total FROM reservations WHERE terrain_id IN (${placeholders}) AND statut = 'joue'`, terrainIds);
    const totalRes = queryOne(db, `SELECT COUNT(*) as count FROM reservations WHERE terrain_id IN (${placeholders})`, terrainIds);
    const pendingRes = queryOne(db, `SELECT COUNT(*) as count FROM reservations WHERE terrain_id IN (${placeholders}) AND statut = 'en_attente'`, terrainIds);
    const totalEmp = queryOne(db, 'SELECT COUNT(*) as count FROM employes WHERE proprietaire_id = ?', [propId]);

    const terrainStats = terrains.map(t => {
      const rev = queryOne(db, "SELECT COALESCE(SUM(prix_total), 0) as total FROM reservations WHERE terrain_id = ? AND statut = 'joue'", [t.id]);
      const resCount = queryOne(db, 'SELECT COUNT(*) as count FROM reservations WHERE terrain_id = ?', [t.id]);
      return { nom: t.nom, id: t.id, reservations: resCount.count, revenue: rev.total, occupancy: Math.min(Math.round((resCount.count / 50) * 100), 100) };
    });

    const weeklyRevenue = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const rev = queryOne(db, `SELECT COALESCE(SUM(prix_total), 0) as total FROM reservations WHERE terrain_id IN (${placeholders}) AND date = ? AND statut = 'joue'`, [...terrainIds, dateStr]);
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
      FROM reservations r JOIN terrains t ON t.id = r.terrain_id LEFT JOIN users u ON u.id = r.joueur_id
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
app.get('/api/gerant/dashboard', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = req.user.terrain_id;
    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
    
    const reservations = queryAll(db, `
      SELECT r.*, COALESCE(r.joueur_nom, u.nom) as joueur_nom, COALESCE(r.joueur_telephone, u.telephone) as joueur_telephone
      FROM reservations r LEFT JOIN users u ON u.id = r.joueur_id
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

app.put('/api/gerant/horaires', authMiddleware, requireRole('gerant'), async (req, res) => {
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

app.post('/api/gerant/blocages', authMiddleware, requireRole('gerant'), async (req, res) => {
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

app.delete('/api/gerant/blocages/:id', authMiddleware, requireRole('gerant'), async (req, res) => {
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
app.get('/api/admin/stats', authMiddleware, requireRole('super_admin'), async (req, res) => {
  try {
    const db = await getDb();
    const totalTerrains = queryOne(db, 'SELECT COUNT(*) as count FROM terrains');
    const totalUsers = queryOne(db, "SELECT COUNT(*) as count FROM users WHERE role = 'joueur'");
    const totalProprietaires = queryOne(db, 'SELECT COUNT(*) as count FROM proprietaires');
    const totalReservations = queryOne(db, 'SELECT COUNT(*) as count FROM reservations');
    const totalRevenue = queryOne(db, "SELECT COALESCE(SUM(prix_total), 0) as total FROM reservations WHERE statut = 'joue'");
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

app.put('/api/admin/proprietaires/:id', authMiddleware, requireRole('super_admin'), async (req, res) => {
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

app.get('/api/admin/audit', authMiddleware, requireRole('super_admin'), async (req, res) => {
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
function programmerResumeHebdomadaire() {
  if (!cron) {
    logger.warn('index.js', 'node-cron non installe: resume hebdomadaire WhatsApp inactif');
    return;
  }

  cron.schedule('0 20 * * 0', async () => {
    try {
      const db = await getDb();
      const depuis = new Date();
      depuis.setDate(depuis.getDate() - 7);
      const from = depuis.toISOString().slice(0, 10);
      const rows = queryAll(db, `SELECT e.id AS gerant_id, e.nom AS gerant_nom,
        COALESCE(e.whatsapp_number, e.telephone) AS telephone,
        t.nom AS terrain_nom,
        COUNT(DISTINCT rv.reservation_id) AS reservations,
        COALESCE(SUM(p.montant_acompte), 0) AS acomptes,
        COALESCE(SUM(p.montant_commission), 0) AS commissions,
        COALESCE(SUM(rv.montant), 0) AS reverse_semaine,
        COALESCE(pg.solde_disponible, 0) AS solde_disponible
        FROM employes e
        JOIN terrains t ON t.id = e.terrain_id
        LEFT JOIN reversements rv ON rv.gerant_id = e.id AND date(rv.created_at) >= date(?)
        LEFT JOIN paiements p ON p.reservation_id = rv.reservation_id AND p.statut = 'paye'
        LEFT JOIN portefeuille_gerant pg ON pg.gerant_id = e.id AND pg.terrain_id = t.id
        WHERE e.is_active = 1
        GROUP BY e.id, t.id`, [from]);

      for (const row of rows) {
        await notificationService.envoyerMessage(row.telephone,
          `Resume semaine ${row.terrain_nom}. Reservations : ${Number(row.reservations || 0)}. Acomptes encaisses : ${Number(row.acomptes || 0).toLocaleString()} FCFA. Commission plateforme : ${Number(row.commissions || 0).toLocaleString()} FCFA. Reverse cette semaine : ${Number(row.reverse_semaine || 0).toLocaleString()} FCFA. Solde total disponible : ${Number(row.solde_disponible || 0).toLocaleString()} FCFA.`);
      }
    } catch (error) {
      logger.error('index.js', 'Resume hebdomadaire WhatsApp', error);
    }
  });
}

async function start() {
  await getDb(); // Initialize DB
  programmerResumeHebdomadaire();
  setInterval(async () => {
    try {
      const db = await getDb();
      transaction(db, () => {
        const expired = queryAll(db, `SELECT id, creneau_id FROM reservations
          WHERE statut = 'en_attente' AND verrou_expire_at IS NOT NULL AND verrou_expire_at < ?`, [Date.now()]);
        for (const reservation of expired) {
          db.run("UPDATE creneaux SET statut = 'libre' WHERE id = ? AND statut = 'en_attente_paiement'", [reservation.creneau_id]);
          db.run("UPDATE reservations SET statut = 'annule' WHERE id = ?", [reservation.id]);
        }
      });
    } catch (error) {
      logger.error('index.js', 'Nettoyage des verrous', error);
    }
  }, 5 * 60 * 1000);
  app.listen(PORT, () => {
    logger.info('index.js', `TerrainSN API demarree sur http://localhost:${PORT}`);
  });
}

start();
