require('dotenv').config();
require('./whatsappClient');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDb, queryAll, queryOne, runSql, saveDb, transaction } = require('./database');
const paytechService = require('./paytechService');
const notificationService = require('./notificationService');
const pushService = require('./pushService');
const otpService = require('./otpService');
const adminRoutes = require('./routes/admin');
const roleRoutes = require('./routes/roles');
const { mountPaymentRoutes } = require('./payments/routes');
const { genererCodeReservation } = require('./payments/flow');
const { mountGerantCheckinRoutes } = require('./gerantCheckin');
const { mountGerantCrmRoutes } = require('./gerantCrm');
const {
  ensurePendingAbonnement,
  appliquerSuspensionsAbonnements: appliquerSuspensionsAbonnementsDb,
} = require('./revenueModelService');
const {
  ownerRevenueRowsSql,
  playedStatusSql,
  summarizeOwnerRevenue,
} = require('./ownerRevenueService');
const {
  UPLOAD_ROOT,
  listTerrainPhotos,
  createTerrainPhoto,
  updateTerrainPhoto,
  deleteTerrainPhoto,
} = require('./terrainPhotoService');
const { saveProfilePhoto } = require('./profilePhotoService');
const { logActivite } = require('./services/auditService');
const scoreService = require('./services/scoreService');
const { assertFenetreScanQr, calculerFenetreCheckIn, DEFAULT_FENETRE_RETARD_MIN } = require('./services/checkInFenetre');
const { serializeQrPayload, parseQrPayload, assertQrMatchesReservation } = require('./services/qrPayload');
const {
  lockCreneauxAtomique,
  libererCreneauxReservation,
  confirmerCreneauxReservation,
  rowsModified,
  normalizeHourString,
} = require('./reservationLockService');
const { calculerPrixReservation, prixHoraireEffectif, calculerDevis, calculerMontantAvance } = require('./pricingService');
const {
  buildSlotsForOpenDay,
  jourDepuisDate,
  addDaysYmd,
  parseEndHour,
  labelHeureSenegal,
  courtLabelHeureSenegal,
  validateHorairePayload,
} = require('./scheduleService');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const {
  authMiddleware,
  requireRole,
  genererAccessToken,
  genererRefreshToken,
  hashRefreshToken,
  JWT_SECRET,
  JWT_REFRESH_SECRET,
} = require('./middleware/auth');
let cron = null;
try {
  cron = require('node-cron');
} catch {
  cron = null;
}

const app = express();
const PORT = process.env.PORT || 3001;

function refreshTableFor(accountType) {
  if (accountType === 'proprietaire') return 'proprietaires';
  if (accountType === 'employe') return 'employes';
  return 'users';
}

function setRefreshCookie(res, refreshToken) {
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearRefreshCookie(res) {
  res.clearCookie('refresh_token', { path: '/' });
}

function issueAuthTokens(res, db, tokenPayload) {
  const accessToken = genererAccessToken(tokenPayload);
  const refreshToken = genererRefreshToken(tokenPayload);
  const table = refreshTableFor(tokenPayload.accountType || 'user');
  runSql(
    db,
    `UPDATE ${table} SET refresh_token = ?, refresh_token_expire_at = datetime('now', '+30 days') WHERE id = ?`,
    [hashRefreshToken(refreshToken), tokenPayload.id]
  );
  setRefreshCookie(res, refreshToken);
  return accessToken;
}

function findAccountByRefreshToken(db, table, userId, refreshToken) {
  const hashed = hashRefreshToken(refreshToken);
  // Priorité au hash ; fallback legacy (token en clair) le temps de la bascule
  return (
    queryOne(
      db,
      `SELECT * FROM ${table}
       WHERE id = ?
         AND refresh_token = ?
         AND refresh_token_expire_at > datetime('now')`,
      [userId, hashed]
    ) ||
    queryOne(
      db,
      `SELECT * FROM ${table}
       WHERE id = ?
         AND refresh_token = ?
         AND refresh_token_expire_at > datetime('now')`,
      [userId, refreshToken]
    )
  );
}

function isAccountBlocked(account, accountType) {
  if (!account) return true;
  if (accountType === 'proprietaire') {
    const statut = String(account.statut || '').toLowerCase();
    return statut === 'bloque' || statut === 'suspendu' || statut === 'inactif';
  }
  if (Number(account.is_active) === 0) return true;
  const statut = String(account.statut || '').toLowerCase();
  return statut === 'bloque' || statut === 'suspendu';
}

function parsePhotos(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      if (raw.startsWith('/') || raw.startsWith('http')) return [raw];
    }
  }
  return [];
}

function serializeTerrain(terrain) {
  if (!terrain) return terrain;
  return { ...terrain, photos: parsePhotos(terrain.photos) };
}

function profileTableFor(accountType) {
  if (accountType === 'proprietaire') return 'proprietaires';
  if (accountType === 'employe') return 'employes';
  return 'users';
}

function selectProfileAccount(db, reqUser) {
  const table = profileTableFor(reqUser.accountType);
  if (table === 'proprietaires') {
    return queryOne(db, `SELECT id, nom, prenom, email, telephone, plan, statut, quartier,
      date_naissance, bio, photo_url, must_change_password, created_at
      FROM proprietaires WHERE id = ?`, [reqUser.id]);
  }
  if (table === 'employes') {
    return queryOne(db, `SELECT id, nom, prenom, email, telephone, whatsapp_number, terrain_id,
      proprietaire_id, is_active, quartier, date_naissance, bio, photo_url,
      must_change_password, created_at
      FROM employes WHERE id = ?`, [reqUser.id]);
  }
  return queryOne(db, `SELECT id, nom, prenom, email, telephone, role, terrain_id, is_active, statut,
    quartier, date_naissance, bio, photo_url, must_change_password, created_at
    FROM users WHERE id = ?`, [reqUser.id]);
}

function splitDisplayName(account) {
  const prenom = String(account?.prenom || '').trim();
  const nom = String(account?.nom || '').trim();
  if (prenom || !nom.includes(' ')) return { prenom, nom };
  const parts = nom.split(/\s+/);
  return { prenom: parts.shift() || '', nom: parts.join(' ') || nom };
}

function profileRoleLabel(role) {
  if (role === 'super_admin' || role === 'superadmin') return 'Admin';
  if (role === 'proprietaire') return 'Propriétaire';
  if (role === 'gerant' || role === 'employe') return 'Gérant';
  return 'Joueur';
}

function buildProfileStats(db, reqUser) {
  const role = reqUser.role === 'superadmin' ? 'super_admin' : reqUser.role;

  if (role === 'proprietaire') {
    const terrains = queryOne(db, 'SELECT COUNT(*) AS total FROM terrains WHERE proprietaire_id = ?', [reqUser.id]) || { total: 0 };
    const rows = queryAll(db, ownerRevenueRowsSql({ ownerWhere: 't.proprietaire_id = ?', dateWhere: '' }), [reqUser.id]);
    const revenue = summarizeOwnerRevenue(rows);
    return {
      terrainAssocie: `${Number(terrains.total || 0)} terrain(s)`,
      stats: [
        { label: 'Terrains', value: Number(terrains.total || 0) },
        { label: 'Revenus du mois', value: Number(revenue.montants_reverses || 0) },
      ],
    };
  }

  if (role === 'gerant' || reqUser.accountType === 'employe') {
    const terrain = queryOne(db, 'SELECT id, nom FROM terrains WHERE id = ?', [reqUser.terrain_id]) || null;
    const matches = queryOne(db, 'SELECT COUNT(*) AS total FROM matchs WHERE gerant_id = ?', [reqUser.id]) || { total: 0 };
    const creneaux = queryOne(db, 'SELECT COUNT(*) AS total FROM creneaux WHERE terrain_id = ?', [reqUser.terrain_id]) || { total: 0 };
    return {
      terrainAssocie: terrain?.nom || 'Terrain non associé',
      stats: [
        { label: 'Matchs validés', value: Number(matches.total || 0) },
        { label: 'Créneaux gérés', value: Number(creneaux.total || 0) },
      ],
    };
  }

  if (role === 'super_admin') {
    const terrains = queryOne(db, 'SELECT COUNT(*) AS total FROM terrains') || { total: 0 };
    const owners = queryOne(db, 'SELECT COUNT(*) AS total FROM proprietaires') || { total: 0 };
    return {
      terrainAssocie: '',
      stats: [
        { label: 'Terrains', value: Number(terrains.total || 0) },
        { label: 'Propriétaires', value: Number(owners.total || 0) },
      ],
    };
  }

  const reservations = queryOne(db, 'SELECT COUNT(*) AS total FROM reservations WHERE joueur_id = ?', [reqUser.id]) || { total: 0 };
  const terrains = queryOne(db, 'SELECT COUNT(DISTINCT terrain_id) AS total FROM reservations WHERE joueur_id = ?', [reqUser.id]) || { total: 0 };
  return {
    terrainAssocie: '',
    stats: [
      { label: 'Réservations totales', value: Number(reservations.total || 0) },
      { label: 'Terrains visités', value: Number(terrains.total || 0) },
    ],
  };
}

function currentMonthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function assertAccountRole(req, role) {
  const current = req.user.role === 'superadmin' ? 'super_admin' : req.user.role;
  if (current !== role) {
    const error = new Error('Acces interdit');
    error.statusCode = 403;
    throw error;
  }
}

function publicProfileAccount(account, reqUser) {
  const role = reqUser.role === 'superadmin' ? 'super_admin' : reqUser.role;
  const name = splitDisplayName(account);
  return {
    ...account,
    prenom: account.prenom || name.prenom,
    nom: name.nom || account.nom,
    role,
    role_label: profileRoleLabel(role),
    accountType: reqUser.accountType,
  };
}
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
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '8mb' }));
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
app.use('/uploads', express.static(UPLOAD_ROOT));

/** En-têtes de cache pour soutenir la stratégie PWA / Service Worker */
app.use((req, res, next) => {
  const reqPath = req.path.toLowerCase();

  if (reqPath.startsWith('/api/terrains') && req.method === 'GET') {
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
    res.set('Vary', 'Authorization, Accept-Encoding');
  } else if (reqPath.startsWith('/api/reservations/mes') && req.method === 'GET') {
    res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=3600');
    res.set('Vary', 'Authorization');
  } else if (/^\/api\/reservations\/\d+$/.test(reqPath) && req.method === 'GET') {
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=300');
    res.set('Vary', 'Authorization');
  } else if (reqPath.startsWith('/api/') && req.method === 'GET') {
    res.set('Cache-Control', 'private, max-age=0, must-revalidate');
  } else if (reqPath.startsWith('/api/') && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }

  if (/\.(js|css|png|jpg|jpeg|webp|avif|svg|woff2|ico)$/i.test(reqPath)) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
  }

  next();
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.error('index.js', 'JSON invalide recu', err);
    return res.status(400).json({ error: 'Requete JSON invalide' });
  }
  return next(err);
});
app.use('/api/admin', adminRoutes);
app.use('/api', roleRoutes);
mountPaymentRoutes(app);
mountGerantCheckinRoutes(app);
mountGerantCrmRoutes(app);

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
// MIDDLEWARE AUTH (voir backend/middleware/auth.js)
// ============================================================

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

    await otpService.createAndSendOtp(db, { telephone: phoneDigits, userId, prenom });

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

    const accessToken = issueAuthTokens(res, db, {
      id: user.id,
      email: user.email,
      telephone: user.telephone,
      role: 'joueur',
      accountType: 'user',
    });

    res.json({ success: true, user: safeUser, token: accessToken, accessToken });
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
    const user = queryAll(db, 'SELECT id, prenom, telephone, telephone_verified FROM users')
      .find((u) => otpService.normalizeTelephone(u.telephone) === phoneDigits);

    if (!user) return res.status(404).json({ error: 'Aucun compte en attente pour ce numéro' });
    if (Number(user.telephone_verified) === 1) {
      return res.status(400).json({ error: 'Ce numéro est déjà vérifié. Connectez-vous.' });
    }

    await otpService.createAndSendOtp(db, { telephone: phoneDigits, userId: user.id, prenom: user.prenom });

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
    if (isAccountBlocked(account, resolvedType || 'user')) {
      return res.status(403).json({
        error: 'Ton compte a été suspendu. Contacte le support.',
      });
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

    const accessToken = issueAuthTokens(res, db, tokenPayload);

    const { password_hash, ...safeAccount } = account;
    res.json({
      user: { ...safeAccount, role, accountType: resolvedType || 'user' },
      token: accessToken,
      accessToken,
    });
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
    const matchesIdentifier = (row) => (isEmail ? matchEmail(row) : matchPhone(row));

    // Un même numéro peut exister sur plusieurs tables (proprio + gérant + joueur).
    // On collecte tous les candidats, puis on garde ceux dont le mot de passe matche.
    const candidates = [
      ...queryAll(db, 'SELECT * FROM employes').map((row) => ({
        account: row,
        resolvedType: 'employe',
        role: 'gerant',
        priority: 1,
      })),
      ...queryAll(db, 'SELECT * FROM proprietaires').map((row) => ({
        account: row,
        resolvedType: 'proprietaire',
        role: 'proprietaire',
        priority: 2,
      })),
      ...queryAll(db, 'SELECT * FROM users').map((row) => {
        let role = row.role === 'superadmin' ? 'super_admin' : (row.role || 'joueur');
        if (role === 'superadmin') role = 'super_admin';
        return {
          account: row,
          resolvedType: 'user',
          role,
          priority: role === 'super_admin' ? 3 : 9,
        };
      }),
    ].filter((c) => matchesIdentifier(c.account));

    const authenticated = candidates
      .filter((c) => bcrypt.compareSync(password, c.account.password_hash))
      .filter((c) => c.role !== 'joueur' && c.role !== 'user')
      .sort((a, b) => a.priority - b.priority);

    if (candidates.length === 0 || authenticated.length === 0) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const { account, resolvedType, role } = authenticated[0];

    if (isAccountBlocked(account, resolvedType)) {
      return res.status(403).json({
        error: 'Ton compte a été suspendu. Contacte le support.',
      });
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

    const accessToken = issueAuthTokens(res, db, tokenPayload);
    const { password_hash, ...safeAccount } = account;
    res.json({ user: { ...safeAccount, role, accountType: resolvedType }, token: accessToken, accessToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Renouvellement silencieux de l'access token
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Session expirée' });
    }

    let payload;
    try {
      payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Session expirée' });
    }

    const db = await getDb();
    const accountType = payload.accountType || 'user';
    const table = refreshTableFor(accountType);
    const account = findAccountByRefreshToken(db, table, payload.id, refreshToken);

    if (!account) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Session invalide' });
    }

    if (isAccountBlocked(account, accountType)) {
      clearRefreshCookie(res);
      return res.status(403).json({
        error: 'Ton compte a été suspendu. Contacte le support.',
      });
    }

    // Migration progressive : re-hasher si l'ancien token clair était encore en base
    if (account.refresh_token === refreshToken) {
      runSql(
        db,
        `UPDATE ${table} SET refresh_token = ? WHERE id = ?`,
        [hashRefreshToken(refreshToken), account.id]
      );
    }

    let role = account.role || (accountType === 'proprietaire' ? 'proprietaire' : accountType === 'employe' ? 'gerant' : 'joueur');
    if (role === 'superadmin') role = 'super_admin';

    const tokenPayload = {
      id: account.id,
      email: account.email,
      telephone: account.telephone,
      role,
      accountType,
      must_change_password: Boolean(account.must_change_password),
    };
    if (accountType === 'employe') {
      tokenPayload.terrain_id = account.terrain_id;
      tokenPayload.proprietaire_id = account.proprietaire_id;
    }
    if (accountType === 'proprietaire') {
      tokenPayload.proprietaire_id = account.id;
    }

    const accessToken = genererAccessToken(tokenPayload);
    res.json({ accessToken, token: accessToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const db = await getDb();
    let userId = null;
    let accountType = 'user';

    const access = req.headers.authorization?.split(' ')[1];
    if (access) {
      try {
        const decoded = jwt.verify(access, JWT_SECRET, { ignoreExpiration: true });
        userId = decoded.id;
        accountType = decoded.accountType || 'user';
      } catch {
        // ignore — on retombe sur le cookie
      }
    }

    const refreshToken = req.cookies?.refresh_token;
    if (!userId && refreshToken) {
      try {
        const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
        userId = decoded.id;
        accountType = decoded.accountType || 'user';
      } catch {
        // cookie invalide
      }
    }

    if (userId) {
      const table = refreshTableFor(accountType);
      runSql(db, `UPDATE ${table} SET refresh_token = NULL, refresh_token_expire_at = NULL WHERE id = ?`, [userId]);
    }

    clearRefreshCookie(res);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    clearRefreshCookie(res);
    res.json({ success: true });
  }
});

// Profil connecté
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const account = selectProfileAccount(db, req.user);
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

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const JOURS_MAP = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Compte les créneaux libres pour un terrain à une date (générés depuis horaires + résas). */
function countCreneauxLibres(db, terrainId, dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return { libres: 0, total: 0, ferme: true };
  const jour = JOURS_MAP[d.getDay()];
  const horaire = queryOne(db, 'SELECT * FROM horaires WHERE terrain_id = ? AND jour = ?', [terrainId, jour]);
  if (!horaire || !horaire.est_ouvert) return { libres: 0, total: 0, ferme: true };

  const startHour = parseInt(String(horaire.heure_debut).split(':')[0], 10);
  const endHour = parseInt(String(horaire.heure_fin).split(':')[0], 10);
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour) || endHour <= startHour) {
    return { libres: 0, total: 0, ferme: true };
  }

  const reservations = queryAll(
    db,
    "SELECT heure_debut, heure_fin FROM reservations WHERE terrain_id = ? AND date = ? AND statut IN ('confirme', 'acceptee', 'en_attente', 'en_attente_paiement')",
    [terrainId, dateStr]
  );
  const blocages = queryAll(
    db,
    'SELECT heure_debut, heure_fin FROM blocages_creneaux WHERE terrain_id = ? AND date = ?',
    [terrainId, dateStr]
  );

  let libres = 0;
  const total = endHour - startHour;
  for (let h = startHour; h < endHour; h++) {
    const slot = `${String(h).padStart(2, '0')}:00`;
    const isReserved = reservations.some((r) => slot >= r.heure_debut && slot < r.heure_fin);
    const isBlocked = blocages.some((b) => slot >= b.heure_debut && slot < b.heure_fin);
    if (isReserved || isBlocked) continue;

    const creneau = queryOne(
      db,
      'SELECT statut FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ?',
      [terrainId, dateStr, slot]
    );
    if (!creneau || creneau.statut === 'libre') libres += 1;
  }
  return { libres, total, ferme: false };
}

function normalizeTerrainType(type) {
  return String(type || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/vs/g, 'v');
}

function serializeCommodites(raw) {
  if (Array.isArray(raw)) {
    return JSON.stringify(raw.map(String).filter(Boolean));
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return JSON.stringify(parsed.map(String).filter(Boolean));
    } catch {
      /* ignore */
    }
  }
  return '[]';
}

// Liste publique
app.get('/api/terrains', async (req, res) => {
  try {
    const db = await getDb();
    const {
      ville, sport, type, prix_min, prix_max, search,
      lat, lng, distance_max, quartier, surface,
      date, heure, dates,
    } = req.query;

    let query = `
      SELECT t.*, 
        COALESCE(ROUND(AVG(a.note), 1), 0) as note,
        COUNT(a.id) as avis_count,
        p.nom as proprietaire_nom
      FROM terrains t
      LEFT JOIN avis a ON a.terrain_id = t.id
      LEFT JOIN proprietaires p ON p.id = t.proprietaire_id
      WHERE COALESCE(t.is_active, 1) = 1
    `;
    const params = [];

    if (ville && ville !== 'Toutes') { query += ' AND t.ville = ?'; params.push(ville); }
    if (sport) { query += ' AND t.sport = ?'; params.push(sport); }

    const typeVal = String(type || '').trim();
    if (typeVal && typeVal !== 'Tous') {
      if (typeVal === 'demi_terrain' || typeVal === 'moitie') {
        query += ' AND COALESCE(t.prix_moitie, 0) > 0';
      } else if (typeVal === 'terrain_entier' || typeVal === 'entier') {
        query += ' AND COALESCE(t.prix_entier, t.prix_heure, 0) > 0';
      } else {
        // 5v5 / 7v7 / 11v11 — tolère "5 vs 5", "5v5", etc.
        const normalized = normalizeTerrainType(typeVal);
        query += ` AND REPLACE(REPLACE(LOWER(COALESCE(t.type,'')), ' ', ''), 'vs', 'v') LIKE ?`;
        params.push(`%${normalized}%`);
      }
    }

    if (prix_min) { query += ' AND t.prix_heure >= ?'; params.push(Number(prix_min)); }
    if (prix_max) { query += ' AND COALESCE(t.prix_entier, t.prix_heure) <= ?'; params.push(Number(prix_max)); }
    if (quartier) {
      query += ' AND (t.adresse LIKE ? OR t.ville LIKE ? OR t.nom LIKE ?)';
      const q = `%${quartier}%`;
      params.push(q, q, q);
    }
    if (search) {
      query += ' AND (t.nom LIKE ? OR t.ville LIKE ? OR t.adresse LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Surface stockée en description côté admin (pas de colonne dédiée)
    const surfaceVal = String(surface || '').trim().toLowerCase();
    if (surfaceVal) {
      if (surfaceVal.includes('synth')) {
        query += ` AND LOWER(COALESCE(t.description,'')) LIKE '%synth%'`;
      } else if (surfaceVal.includes('naturel')) {
        query += ` AND (LOWER(COALESCE(t.description,'')) LIKE '%naturel%' OR LOWER(COALESCE(t.description,'')) LIKE '%gazon_naturel%')`;
      } else if (surfaceVal.includes('beton') || surfaceVal.includes('béton')) {
        query += ` AND LOWER(COALESCE(t.description,'')) LIKE '%beton%'`;
      } else {
        query += ` AND LOWER(COALESCE(t.description,'')) LIKE ?`;
        params.push(`%${surfaceVal}%`);
      }
    }

    // Dates ciblées pour enrichissement dispo (Demain / week-end)
    const dateList = [];
    if (dates) {
      String(dates)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((d) => dateList.push(d));
    } else if (date) {
      dateList.push(String(date));
    }

    // Ancien filtre EXISTS désactivé : les créneaux sont souvent créés à la demande.
    // On filtre après enrichissement sur creneaux_libres.
    void heure;

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const hasGeo = Number.isFinite(userLat) && Number.isFinite(userLng);

    query += hasGeo
      ? ' GROUP BY t.id'
      : ' GROUP BY t.id ORDER BY t.nom COLLATE NOCASE ASC';

    let terrains = queryAll(db, query, params);

    if (dateList.length > 0) {
      terrains = terrains.map((t) => {
        let libres = 0;
        let total = 0;
        let ferme = true;
        for (const d of dateList) {
          const info = countCreneauxLibres(db, t.id, d);
          libres += info.libres;
          total += info.total;
          if (!info.ferme) ferme = false;
        }
        return { ...t, creneaux_libres: libres, creneaux_total: total, ferme_date: ferme };
      });
      // Ouverts avec créneaux d'abord, puis presque complets, puis complets/fermés
      terrains.sort((a, b) => {
        const score = (t) => {
          if (t.ferme_date) return -1;
          return Number(t.creneaux_libres) || 0;
        };
        return score(b) - score(a);
      });
    }

    if (hasGeo) {
      const distanceMax = parseFloat(distance_max);
      const maxKm = Number.isFinite(distanceMax) && distanceMax > 0 ? distanceMax : 10;
      terrains = terrains
        .map((t) => {
          const tLat = Number(t.latitude);
          const tLng = Number(t.longitude);
          const distance_km = Number.isFinite(tLat) && Number.isFinite(tLng)
            ? Math.round(haversineKm(userLat, userLng, tLat, tLng) * 10) / 10
            : null;
          return { ...t, distance_km };
        })
        .filter((t) => t.distance_km === null || t.distance_km <= maxKm)
        .sort((a, b) => {
          if (a.distance_km === null) return 1;
          if (b.distance_km === null) return -1;
          return a.distance_km - b.distance_km;
        });
    }

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

    res.json({ ...serializeTerrain(terrain), horaires, avis, employe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Créneaux disponibles (plages horaires configurables + minuit culturel SN)
app.get('/api/terrains/:id/creneaux', async (req, res) => {
  try {
    const db = await getDb();
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'Date requise' });
    const dateStr = String(date).slice(0, 10);

    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(req.params.id)]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });

    const jour = jourDepuisDate(dateStr);
    const horaire = queryOne(db, 'SELECT * FROM horaires WHERE terrain_id = ? AND jour = ?', [terrain.id, jour]);

    // Slots du jour + éventuel minuit culturel (calendrier lendemain)
    let planned = buildSlotsForOpenDay(dateStr, horaire);

    // Si la veille ferme à minuit, exposer aussi 00:00 ce jour (label « … minuit »)
    const prevDate = addDaysYmd(dateStr, -1);
    const prevJour = jourDepuisDate(prevDate);
    const prevHoraire = queryOne(db, 'SELECT * FROM horaires WHERE terrain_id = ? AND jour = ?', [terrain.id, prevJour]);
    if (prevHoraire && Number(prevHoraire.est_ouvert) && parseEndHour(prevHoraire.heure_fin) === 24) {
      const hasMidnight = planned.some((s) => s.date === dateStr && s.heure_debut === '00:00');
      if (!hasMidnight) {
        planned = [
          {
            date: dateStr,
            heure_debut: '00:00',
            heure_fin: '01:00',
            label: labelHeureSenegal(dateStr, '00:00'),
            label_court: courtLabelHeureSenegal(dateStr, '00:00'),
            est_minuit_culturel: true,
            jour_tarif: prevJour,
            date_affichage: prevDate,
          },
          ...planned,
        ];
      }
    }

    if (!planned.length) {
      return res.json({
        creneaux: [],
        message: 'Fermé ce jour',
        horaire: horaire || null,
        calendrier: 'senegal',
      });
    }

    // Occupations : par date réelle du slot (minuit = jour calendaire suivant)
    const datesNeeded = [...new Set(planned.map((s) => s.date))];
    const reservationsExistantes = queryAll(
      db,
      `SELECT date, heure_debut, heure_fin FROM reservations
        WHERE terrain_id = ? AND date IN (${datesNeeded.map(() => '?').join(',')})
          AND statut IN ('confirme', 'acceptee', 'en_attente')`,
      [terrain.id, ...datesNeeded],
    );
    const blocages = queryAll(
      db,
      `SELECT date, heure_debut, heure_fin FROM blocages_creneaux
        WHERE terrain_id = ? AND date IN (${datesNeeded.map(() => '?').join(',')})`,
      [terrain.id, ...datesNeeded],
    );

    const creneaux = [];
    for (const slotPlan of planned) {
      const slot = slotPlan.heure_debut;
      const slotEnd = slotPlan.heure_fin;
      const slotDate = slotPlan.date;

      const isReserved = reservationsExistantes.some(
        (r) =>
          String(r.date).slice(0, 10) === String(slotDate).slice(0, 10) &&
          slot >= String(r.heure_debut).slice(0, 5) &&
          slot < String(r.heure_fin).slice(0, 5),
      );
      const isBlocked = blocages.some(
        (b) =>
          String(b.date).slice(0, 10) === String(slotDate).slice(0, 10) &&
          slot >= String(b.heure_debut).slice(0, 5) &&
          slot < String(b.heure_fin).slice(0, 5),
      );

      // Déduplique les lignes creneaux (anciens doublons libre+bloque)
      const twins = queryAll(
        db,
        'SELECT id, statut FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ? ORDER BY id ASC',
        [terrain.id, slotDate, slot, slotEnd],
      );
      let creneau = twins.length
        ? queryOne(db, 'SELECT * FROM creneaux WHERE id = ?', [twins[twins.length - 1].id])
        : null;
      if (twins.length > 1) {
        const keepId = twins[twins.length - 1].id;
        twins.slice(0, -1).forEach((t) => {
          runSql(db, 'DELETE FROM creneaux WHERE id = ?', [t.id]);
        });
        creneau = queryOne(db, 'SELECT * FROM creneaux WHERE id = ?', [keepId]);
      }
      if (!creneau) {
        runSql(
          db,
          'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)',
          [terrain.id, slotDate, slot, slotEnd, isReserved ? 'reserve' : isBlocked ? 'bloque' : 'libre'],
        );
        creneau = queryOne(
          db,
          'SELECT * FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ? ORDER BY id DESC',
          [terrain.id, slotDate, slot, slotEnd],
        );
      }

      // Resync statut avec occupations réelles (évite faux « libre »)
      const effectiveStatut = isBlocked ? 'bloque' : isReserved ? 'reserve' : 'libre';
      if (creneau && creneau.statut !== effectiveStatut) {
        runSql(db, 'UPDATE creneaux SET statut = ? WHERE id = ?', [effectiveStatut, creneau.id]);
        creneau = { ...creneau, statut: effectiveStatut };
      }

      const disponible = !isReserved && !isBlocked;
      const prixEntier = prixHoraireEffectif(
        db,
        terrain,
        slotDate,
        slot,
        'entier',
        slotPlan.jour_tarif || null,
      );
      const prixMoitie = prixHoraireEffectif(
        db,
        terrain,
        slotDate,
        slot,
        'moitie',
        slotPlan.jour_tarif || null,
      );

      creneaux.push({
        id: creneau.id,
        date: slotDate,
        date_selection: dateStr,
        heure: slot,
        heure_fin: slotEnd,
        label: slotPlan.label || labelHeureSenegal(slotDate, slot),
        label_court: slotPlan.label_court || courtLabelHeureSenegal(slotDate, slot),
        est_minuit_culturel: Boolean(slotPlan.est_minuit_culturel),
        statut: effectiveStatut,
        disponible,
        bloque: isBlocked,
        prix_entier: prixEntier,
        prix_moitie: prixMoitie,
      });
    }

    res.json({
      creneaux,
      horaire: horaire || null,
      calendrier: 'senegal',
      note_minuit:
        'Le créneau 00:00 (ex. vendredi) s’affiche et se programme comme « Jeudi minuit ».',
      prix_entier_base: Number(terrain.prix_entier || terrain.prix_heure || 0),
      prix_moitie_base: Number(terrain.prix_moitie || 0),
      pourcentage_avance: Number(terrain.pourcentage_avance || 12.5),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Devis prix dynamique (joueur / public)
app.get('/api/terrains/:id/devis', async (req, res) => {
  try {
    const db = await getDb();
    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(req.params.id)]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });
    const date = String(req.query.date || '');
    const heure_debut = normalizeHourString(req.query.heure_debut || req.query.debut || '');
    const heure_fin = normalizeHourString(req.query.heure_fin || req.query.fin || '');
    const format_terrain = req.query.format === 'moitie' ? 'moitie' : 'entier';
    if (!date || !heure_debut || !heure_fin) {
      return res.status(400).json({ error: 'date, heure_debut et heure_fin requis' });
    }
    const devis = calculerDevis(db, terrain, { date, heure_debut, heure_fin, format_terrain });
    res.json(devis);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

// CRUD Terrains (propriétaire)
app.post('/api/terrains', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const { nom, adresse, ville, sport, type, prix_heure, prix_moitie, prix_entier, montant_acompte, acompte, pourcentage_avance, latitude, longitude, description, telephone, commodites, heure_debut, heure_fin } = req.body;
    const prixEntier = Number(prix_entier || prix_heure);
    const prixMoitie = Number(prix_moitie || prixEntier * 0.6);
    const pourcentageAvance = Number(pourcentage_avance || (montant_acompte || acompte ? (Number(montant_acompte || acompte) * 100) / prixEntier : 8));
    const avanceTerrain = Math.round((prixEntier * pourcentageAvance) / 100);
    const result = runSql(db, `INSERT INTO terrains
      (proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_moitie, prix_entier, montant_acompte, acompte, pourcentage_avance, modele_revenus, commission_pourcentage, abonnement_montant, achat_definitif_montant, latitude, longitude, description, telephone, commodites)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, nom, adresse, ville, sport || 'foot', type || '11v11', prixEntier, prixMoitie, prixEntier, avanceTerrain, avanceTerrain, pourcentageAvance, 'commission', 0, 0, 0, Number.isFinite(Number(latitude)) ? Number(latitude) : null, Number.isFinite(Number(longitude)) ? Number(longitude) : null, description, telephone, serializeCommodites(commodites)]);
    
    const openStart = String(heure_debut || '06:00').slice(0, 5);
    const openEnd = String(heure_fin || '00:00').slice(0, 5); // 00:00 = jusqu'à minuit par défaut élargi
    const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    for (const jour of jours) {
      runSql(db, 'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, 1)', [result.lastInsertRowid, jour, openStart, openEnd]);
    }
    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(serializeTerrain(terrain));
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

    const { nom, adresse, ville, sport, type, prix_heure, prix_moitie, prix_entier, montant_acompte, acompte, pourcentage_avance, latitude, longitude, description, telephone, is_active, commodites } = req.body;
    const prixEntier = Number(prix_entier || prix_heure || terrain.prix_entier || terrain.prix_heure);
    const pourcentageAvance = Number(pourcentage_avance || (montant_acompte || acompte ? (Number(montant_acompte || acompte) * 100) / prixEntier : terrain.pourcentage_avance || 8));
    const avanceTerrain = Math.round((prixEntier * pourcentageAvance) / 100);
    const commoditesJson =
      commodites !== undefined ? serializeCommodites(commodites) : (terrain.commodites || '[]');
    runSql(db, `UPDATE terrains SET nom=?, adresse=?, ville=?, sport=?, type=?, prix_heure=?, prix_moitie=?, prix_entier=?,
      montant_acompte=?, acompte=?, pourcentage_avance=?, latitude=?, longitude=?, description=?, telephone=?, is_active=?, commodites=? WHERE id=?`,
      [nom || terrain.nom, adresse || terrain.adresse, ville || terrain.ville, sport || terrain.sport, type || terrain.type, prixEntier, Number(prix_moitie || terrain.prix_moitie || prixEntier * 0.6), prixEntier, avanceTerrain, avanceTerrain, pourcentageAvance, latitude === '' || latitude == null ? terrain.latitude : (Number.isFinite(Number(latitude)) ? Number(latitude) : null), longitude === '' || longitude == null ? terrain.longitude : (Number.isFinite(Number(longitude)) ? Number(longitude) : null), description || terrain.description, telephone || terrain.telephone, is_active !== undefined ? is_active : terrain.is_active, commoditesJson, terrain.id]);
    
    const updated = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrain.id]);
    res.json(serializeTerrain(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/terrains/:id/photos', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = queryOne(db, 'SELECT id FROM terrains WHERE id = ? AND proprietaire_id = ?', [terrainId, req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouve' });
    res.json(listTerrainPhotos(db, terrainId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/terrains/:id/photos', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = queryOne(db, 'SELECT id FROM terrains WHERE id = ? AND proprietaire_id = ?', [terrainId, req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouve' });
    const photo = transaction(db, () => createTerrainPhoto(db, terrainId, req.body || {}));
    res.status(201).json(photo);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.patch('/api/terrains/:id/photos/:photoId', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = queryOne(db, 'SELECT id FROM terrains WHERE id = ? AND proprietaire_id = ?', [terrainId, req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouve' });
    const photo = transaction(db, () => updateTerrainPhoto(db, terrainId, Number(req.params.photoId), req.body || {}));
    res.json(photo);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.delete('/api/terrains/:id/photos/:photoId', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = queryOne(db, 'SELECT id FROM terrains WHERE id = ? AND proprietaire_id = ?', [terrainId, req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouve' });
    const result = transaction(db, () => deleteTerrainPhoto(db, terrainId, Number(req.params.photoId)));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
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
    const {
      terrain_id,
      date,
      heure_debut,
      heure_fin,
      joueur_nom,
      joueur_telephone,
      format_terrain = 'entier',
      joueur_id: joueurIdBody,
      mode: modeBody,
      anonyme: anonymeBody,
    } = req.body;
    /** 'paiement' = lien PayTech + WA | 'bloquer' = hold sur place sans lien */
    const mode = modeBody === 'bloquer' ? 'bloquer' : 'paiement';
    const anonyme = Boolean(anonymeBody);
    const terrainId = terrainIdForce || Number(terrain_id);
    if (!joueur_nom || (!anonyme && !joueur_telephone)) {
      return res.status(400).json({ error: 'Nom et téléphone du joueur requis' });
    }
    if (mode === 'paiement' && anonyme) {
      return res.status(400).json({ error: 'Impossible d’envoyer un lien de paiement à un joueur anonyme' });
    }
    if (mode === 'paiement' && !joueur_telephone) {
      return res.status(400).json({ error: 'Téléphone requis pour envoyer le lien de paiement' });
    }

    let telephoneNorm = null;
    if (joueur_telephone) {
      try {
        telephoneNorm = notificationService.normalizeTelephoneStore(joueur_telephone);
      } catch (phoneErr) {
        return res.status(400).json({ error: phoneErr.message || 'Numéro WhatsApp invalide' });
      }
    } else if (anonyme) {
      telephoneNorm = '000000000';
    }

    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });

    if (!date || !heure_debut || !heure_fin) return res.status(400).json({ error: 'Créneau invalide' });
    const heureDebutNorm = normalizeHourString(heure_debut);
    const heureFinNorm = normalizeHourString(heure_fin);
    const startH = parseInt(heureDebutNorm.split(':')[0], 10);
    const endH = parseInt(heureFinNorm.split(':')[0], 10);
    const duree = endH - startH;
    if (duree <= 0) return res.status(400).json({ error: 'Créneau invalide' });
    if (!['moitie', 'entier'].includes(format_terrain)) return res.status(400).json({ error: 'Format de terrain invalide' });
    const montant = calculerPrixReservation(db, terrain, date, heureDebutNorm, heureFinNorm, format_terrain);
    // Bloquer sur place : tout encaissé au match (avance 0). Paiement lien : avance calculée.
    const montantAvance = mode === 'bloquer' ? 0 : calculerMontantAvance(terrain, montant);
    const montantRestant = Math.max(0, montant - montantAvance);
    const verrouExpireAt = mode === 'bloquer' ? null : Date.now() + lockDurationMs;
    // Bloquer = confirmé (scan possible). Paiement = en_attente jusqu'au PayTech.
    const statutInitial = mode === 'bloquer' ? 'confirme' : 'en_attente';

    // Lier au compte joueur pour que la résa apparaisse dans Mes réservations + push.
    let resolvedJoueurId = null;
    if (creePar === 'joueur' && req.user?.id) {
      resolvedJoueurId = Number(req.user.id);
    } else if (joueurIdBody) {
      const explicit = queryOne(
        db,
        `SELECT id FROM users WHERE id = ? AND COALESCE(role, 'joueur') = 'joueur'`,
        [Number(joueurIdBody)],
      );
      if (explicit) resolvedJoueurId = explicit.id;
    }
    if (!resolvedJoueurId && telephoneNorm && telephoneNorm !== '000000000') {
      const digits = String(telephoneNorm || '').replace(/\D/g, '');
      const local9 = digits.length >= 9 ? digits.slice(-9) : digits;
      if (local9.length === 9) {
        const byPhone = queryOne(
          db,
          `SELECT id FROM users
            WHERE COALESCE(role, 'joueur') = 'joueur'
              AND REPLACE(REPLACE(REPLACE(telephone, ' ', ''), '+', ''), '-', '') LIKE ?
            ORDER BY id DESC LIMIT 1`,
          [`%${local9}`],
        );
        if (byPhone) resolvedJoueurId = byPhone.id;
      }
    }
    if (!resolvedJoueurId && creePar === 'gerant' && !anonyme && telephoneNorm && telephoneNorm !== '000000000') {
      const digits = String(telephoneNorm || '').replace(/\D/g, '');
      const email = `walkin.${digits || 'x'}.${Date.now()}@joueur.terrainsn.local`;
      runSql(
        db,
        `INSERT INTO users (nom, email, telephone, role, is_active, telephone_verified)
         VALUES (?, ?, ?, 'joueur', 1, 0)`,
        [String(joueur_nom).trim(), email, telephoneNorm],
      );
      const created = queryOne(db, 'SELECT id FROM users WHERE email = ?', [email]);
      resolvedJoueurId = created?.id || null;
    }

    // Transaction ACID : verrou IMMEDIATE + UPDATE conditionnel sur chaque heure (anti double-booking)
    const reservationId = transaction(db, () => {
      const creneauId = lockCreneauxAtomique(db, terrainId, date, heureDebutNorm, heureFinNorm);
      db.run(`INSERT INTO reservations
        (terrain_id, creneau_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin, montant, prix_total, acompte, reste_a_payer, montant_avance, montant_restant, format_terrain, statut, expire_at, verrou_expire_at, cree_par)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          terrainId,
          creneauId,
          resolvedJoueurId,
          joueur_nom,
          telephoneNorm,
          date,
          heureDebutNorm,
          heureFinNorm,
          montant,
          montant,
          montantAvance,
          montantRestant,
          montantAvance,
          montantRestant,
          format_terrain,
          statutInitial,
          verrouExpireAt ? new Date(verrouExpireAt).toISOString() : null,
          verrouExpireAt,
          creePar,
        ]);
      return queryOne(db, 'SELECT last_insert_rowid() AS id').id;
    });

    let reservation = queryOne(db, `
      SELECT r.*, t.nom as terrain_nom, t.ville as terrain_ville, t.type as terrain_type
      FROM reservations r JOIN terrains t ON t.id = r.terrain_id WHERE r.id = ?
    `, [reservationId]);

    // Code + payload QR dès la création (scan / validation manuelle / WhatsApp)
    if (!reservation.code_reservation) {
      const code = genererCodeReservation(db);
      const fenetre = calculerFenetreCheckIn({
        date: reservation.date,
        heure_debut: reservation.heure_debut,
        heure_fin: reservation.heure_fin,
        fenetre_retard: DEFAULT_FENETRE_RETARD_MIN,
      });
      const qrPayload = serializeQrPayload({
        reservation_id: reservation.id,
        code,
        creneau_id: reservation.creneau_id,
        terrain_id: reservation.terrain_id,
        expire_at: fenetre.finFenetre,
      });
      runSql(db, 'UPDATE reservations SET code_reservation = ?, qr_code_payload = ? WHERE id = ?', [
        code,
        qrPayload,
        reservation.id,
      ]);
      reservation = { ...reservation, code_reservation: code, qr_code_payload: qrPayload };
    }

    if (mode === 'paiement') {
      try {
        const payment = await paytechService.creerLienPaiement(reservation);
        runSql(db, 'UPDATE reservations SET lien_paiement = ?, reference_paytech = ? WHERE id = ?', [
          payment.redirectUrl,
          payment.reference,
          reservation.id,
        ]);
        reservation = {
          ...reservation,
          lien_paiement: payment.redirectUrl,
          reference_paytech: payment.reference,
          redirect_url: payment.redirectUrl,
        };
      } catch (error) {
        transaction(db, () => {
          libererCreneauxReservation(db, reservation, ['en_attente_paiement']);
          db.run("UPDATE reservations SET statut = 'annule' WHERE id = ?", [reservation.id]);
        });
        throw error;
      }
    }

    // Notif in-app / push joueur (lien paiement en attente)
    if (resolvedJoueurId && mode === 'paiement') {
      try {
        runSql(
          db,
          `INSERT INTO notifications (destinataire_type, destinataire_id, type, canal, contenu, lu)
           VALUES ('user', ?, 'paiement', 'app', ?, 0)`,
          [
            resolvedJoueurId,
            `Nouvelle réservation au ${reservation.terrain_nom} le ${date} à ${heureDebutNorm} — avance à payer : ${montantAvance} FCFA`,
          ],
        );
        await pushService.sendToUser(
          resolvedJoueurId,
          {
            title: 'Réservation créée — paiement',
            body: `${reservation.terrain_nom} le ${date} à ${heureDebutNorm}. Ouvre Mes réservations pour payer.`,
            url: '/reservations',
            tag: `resa-pending-${reservation.id}`,
            type: 'reservation_pending',
          },
          'reservation_confirmation',
        );
      } catch (pushErr) {
        logger.error('index.js', 'Push / notif joueur réservation', pushErr);
      }
    }

    if (creePar === 'gerant') {
      await logActivite({
        gerant_id: req.user.id,
        terrain_id: terrainId,
        action: mode === 'bloquer' ? 'reservation_bloquee' : 'reservation_creee',
        reservation_id: reservation.id,
        details: {
          date,
          heure_debut: heureDebutNorm,
          heure_fin: heureFinNorm,
          format_terrain,
          montant,
          mode,
          anonyme,
          joueur_id: resolvedJoueurId,
        },
      }).catch((error) => logger.error('index.js', 'Log activite reservation_creee', error));

      let whatsapp_sent = false;
      let whatsapp_error = null;
      if (mode === 'paiement' && !anonyme) {
        try {
          await notificationService.envoyerLienPaiement(reservation.id);
          whatsapp_sent = true;
        } catch (error) {
          whatsapp_error = error.message || 'Envoi WhatsApp impossible';
          logger.error('index.js', 'Envoi lien paiement WhatsApp impossible', error);
        }
      }

      return res.status(201).json({
        success: true,
        mode,
        reservation_id: reservation.id,
        joueur_id: resolvedJoueurId,
        montant,
        montant_avance: montantAvance,
        montant_restant: montantRestant,
        heure_debut: heureDebutNorm,
        heure_fin: heureFinNorm,
        joueur_telephone: telephoneNorm,
        joueur_nom: joueur_nom,
        code_reservation: reservation.code_reservation || null,
        statut: statutInitial,
        whatsapp_sent,
        whatsapp_error,
        lien_paiement: reservation.lien_paiement || null,
      });
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

app.get('/api/whatsapp/status', (req, res) => {
  const whatsappClient = require('./whatsappClient');
  res.json(typeof whatsappClient.getStatus === 'function' ? whatsappClient.getStatus() : {
    connected: Boolean(whatsappClient.isReady),
    mock: String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true',
  });
});

app.get('/api/whatsapp/qr', (req, res) => {
  const whatsappClient = require('./whatsappClient');
  const payload = typeof whatsappClient.getQrPayload === 'function'
    ? whatsappClient.getQrPayload()
    : { connected: Boolean(whatsappClient.isReady), mock: false };
  res.json(payload);
});

app.get('/whatsapp-qr', (req, res) => {
  const whatsappClient = require('./whatsappClient');
  const payload = typeof whatsappClient.getQrPayload === 'function'
    ? whatsappClient.getQrPayload()
    : { connected: Boolean(whatsappClient.isReady) };
  const status = typeof whatsappClient.getStatus === 'function' ? whatsappClient.getStatus() : {};
  const img = payload.dataUrl
    ? `<img src="${payload.dataUrl}" alt="QR WhatsApp" width="320" height="320" />`
    : payload.connected
      ? `<p style="color:#0A5C36;font-size:1.25rem">WhatsApp deja connecte</p>`
      : status.mock
        ? `<p>Mode MOCK actif (WHATSAPP_MOCK=true)</p>`
        : `<p>En attente du QR… rafraîchissement auto</p><script>setTimeout(()=>location.reload(),2500)</script>`;
  res.type('html').send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"/><meta http-equiv="Content-Type" content="text/html; charset=utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>TerrainSN — Connecter WhatsApp</title>
<style>
 body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;
  background:#F4F6F9;color:#122;margin:0}
 .card{background:#fff;padding:2rem;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.08);text-align:center;max-width:420px}
 h1{font-size:1.25rem;margin:0 0 .5rem} p{color:#556;line-height:1.4}
</style></head><body><div class="card">
<h1>Scanner pour activer WhatsApp</h1>
<p>WhatsApp → Paramètres → Appareils connectés → Connecter un appareil</p>
${img}
<p style="margin-top:1rem;font-size:.85rem">Puis un test peut être envoyé à ${process.env.WHATSAPP_TEST_NUMBER || ''}</p>
</div></body></html>`);
});

/** Envoi de test (dev uniquement) — body: { telephone, message? } */
app.post('/api/whatsapp/test', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Non disponible' });
  }
  try {
    const whatsappClient = require('./whatsappClient');
    if (typeof whatsappClient.ensureStarted === 'function') {
      await whatsappClient.ensureStarted();
    }
    const telephone = req.body?.telephone || process.env.WHATSAPP_TEST_NUMBER;
    const message = req.body?.message ||
      `\u2705 *TerrainSN* — test WhatsApp OK \u26BD\n` +
      `\uD83D\uDCF1 Envoye le ${new Date().toLocaleString('fr-SN')}\n` +
      `L'integration WhatsApp fonctionne !`;
    if (!telephone) return res.status(400).json({ error: 'telephone requis' });
    await notificationService.envoyerMessage(telephone, message);
    res.json({
      ok: true,
      telephone,
      mock: String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true',
      connected: Boolean(whatsappClient.isReady),
    });
  } catch (error) {
    res.status(503).json({ error: error.message || 'Envoi WhatsApp impossible' });
  }
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

/** Renvoi confirmation + QR image (dev / dépannage) — body optionnel, auth gerant ou admin */
app.post('/api/reservations/:id(\\d+)/renvoyer-confirmation', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const reservation = queryOne(
      db,
      `SELECT id, statut, code_reservation, joueur_telephone FROM reservations WHERE id = ? AND terrain_id = ?`,
      [Number(req.params.id), req.user.terrain_id]
    );
    if (!reservation) return res.status(404).json({ error: 'Réservation introuvable' });
    if (reservation.statut !== 'confirme' && reservation.statut !== 'acceptee') {
      return res.status(400).json({
        error: `La réservation doit être confirmée (statut actuel: ${reservation.statut})`,
      });
    }
    if (!reservation.code_reservation) {
      return res.status(400).json({ error: 'Pas de code_reservation — impossible de générer le QR' });
    }
    await notificationService.envoyerConfirmation(reservation.id);
    res.json({
      ok: true,
      reservation_id: reservation.id,
      code_reservation: reservation.code_reservation,
      telephone: reservation.joueur_telephone,
      message: 'Confirmation WhatsApp + QR envoyés',
    });
  } catch (error) {
    console.error('Renvoi confirmation WhatsApp:', error);
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

/** PNG du QR code (JSON métier ou fallback code) — page succès joueur / fiche gérant */
app.get('/api/reservations/:id(\\d+)/qr.png', optionalAuth, async (req, res) => {
  try {
    const db = await getDb();
    const reservation = queryOne(
      db,
      `SELECT r.id, r.joueur_id, r.code_reservation, r.qr_code_payload, r.creneau_id, r.terrain_id, r.date, r.heure_debut, r.heure_fin,
              COALESCE(c.fenetre_retard, ${DEFAULT_FENETRE_RETARD_MIN}) AS fenetre_retard
       FROM reservations r
       LEFT JOIN creneaux c ON c.id = r.creneau_id
       WHERE r.id = ?`,
      [Number(req.params.id)]
    );
    if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });
    if (req.user && reservation.joueur_id && Number(reservation.joueur_id) !== Number(req.user.id) && req.user.role === 'joueur') {
      return res.status(403).json({ error: 'Accès interdit' });
    }

    let payload = reservation.qr_code_payload;
    if (!payload && reservation.code_reservation) {
      const fenetre = calculerFenetreCheckIn({
        date: reservation.date,
        heure_debut: reservation.heure_debut,
        heure_fin: reservation.heure_fin,
        fenetre_retard: reservation.fenetre_retard,
      });
      payload = serializeQrPayload({
        reservation_id: reservation.id,
        code: reservation.code_reservation,
        creneau_id: reservation.creneau_id,
        terrain_id: reservation.terrain_id,
        expire_at: Math.floor(fenetre.finFenetre / 1000),
      });
    }
    if (!payload) payload = String(reservation.id);

    const png = await require('qrcode').toBuffer(payload, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
    });
    res.set('Cache-Control', 'private, max-age=300');
    res.type('png').send(png);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Génération QR impossible' });
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
      db.run("UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut IN ('en_attente', 'confirme', 'acceptee')", [reservation.id]);
      if (rowsModified(db) !== 1) {
        const error = new Error('Réservation ne peut pas être annulée');
        error.statusCode = 400;
        throw error;
      }
      if (reservation.statut === 'en_attente') {
        libererCreneauxReservation(db, reservation, ['en_attente_paiement']);
      } else {
        libererCreneauxReservation(db, reservation, ['reserve', 'en_attente_paiement']);
      }
    });
    res.json({ message: 'Réservation annulée' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.patch('/api/gerant/reservations/:id/annuler', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ? AND terrain_id = ?', [Number(req.params.id), req.user.terrain_id]);
    if (!reservation) return res.status(404).json({ error: 'Reservation non trouvee pour ce terrain' });
    if (!['en_attente', 'confirme', 'acceptee'].includes(reservation.statut)) {
      return res.status(400).json({ error: 'Reservation ne peut pas etre annulee' });
    }
    transaction(db, () => {
      db.run("UPDATE reservations SET statut = 'annule', traite_par = ? WHERE id = ? AND statut IN ('en_attente', 'confirme', 'acceptee')", [req.user.id, reservation.id]);
      if (rowsModified(db) !== 1) {
        const error = new Error('Reservation ne peut pas etre annulee');
        error.statusCode = 400;
        throw error;
      }
      libererCreneauxReservation(db, reservation, ['en_attente_paiement', 'reserve']);
    });
    await logActivite({
      gerant_id: req.user.id,
      terrain_id: reservation.terrain_id,
      action: 'reservation_annulee',
      reservation_id: reservation.id,
      details: { statut_avant: reservation.statut },
    }).catch((error) => logger.error('index.js', 'Log activite reservation_annulee', error));
    await scoreService.recalculerScore(req.user.id, reservation.terrain_id).catch((error) => logger.error('index.js', 'Recalcul score annulation', error));
    res.json({ message: 'Reservation annulee' });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
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
      db.run("UPDATE reservations SET statut = 'annule', traite_par = ? WHERE id = ? AND statut IN ('en_attente', 'confirme', 'acceptee')", [req.user.id, reservation.id]);
      libererCreneauxReservation(db, reservation, ['en_attente_paiement', 'reserve']);
    });
    if (req.user.role === 'gerant') {
      await logActivite({
        gerant_id: req.user.id,
        terrain_id: reservation.terrain_id,
        action: 'reservation_annulee',
        reservation_id: reservation.id,
        details: { statut_avant: reservation.statut, action },
      }).catch((error) => logger.error('index.js', 'Log activite reservation_annulee', error));
      await scoreService.recalculerScore(req.user.id, reservation.terrain_id).catch((error) => logger.error('index.js', 'Recalcul score annulation traiter', error));
    }
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
// Paiement isolé : voir backend/payments/

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

    const revenueRows = queryAll(db, ownerRevenueRowsSql({ ownerWhere: 't.proprietaire_id = ?', dateWhere: '' }), [propId]);
    const revenueTotals = summarizeOwnerRevenue(revenueRows);
    const totalRes = queryOne(db, `SELECT COUNT(*) as count FROM reservations WHERE terrain_id IN (${placeholders})`, terrainIds);
    const pendingRes = queryOne(db, `SELECT COUNT(*) as count FROM reservations WHERE terrain_id IN (${placeholders}) AND statut = 'en_attente'`, terrainIds);
    const totalEmp = queryOne(db, 'SELECT COUNT(*) as count FROM employes WHERE proprietaire_id = ?', [propId]);

    const terrainStats = terrains.map(t => {
      const revenue = revenueRows.find((row) => Number(row.id) === Number(t.id)) || {};
      const resCount = queryOne(db, 'SELECT COUNT(*) as count FROM reservations WHERE terrain_id = ?', [t.id]);
      return { nom: t.nom, id: t.id, reservations: resCount.count, revenue: Number(revenue.montants_reverses || 0), occupancy: Math.min(Math.round((resCount.count / 50) * 100), 100) };
    });

    const weeklyRevenue = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const rev = queryOne(db, `SELECT
        COALESCE(SUM(CASE
          WHEN t.modele_revenus = 'commission'
          THEN COALESCE(p.montant_acompte, 0) - COALESCE(p.montant_commission, ROUND(COALESCE(p.montant_acompte, 0) * COALESCE(t.commission_pourcentage, 0) / 100.0))
          ELSE COALESCE(p.montant_acompte, 0)
        END), 0) as total
        FROM reservations r
        JOIN terrains t ON t.id = r.terrain_id
        LEFT JOIN paiements p ON p.reservation_id = r.id AND p.statut = 'paye'
        WHERE r.terrain_id IN (${placeholders}) AND r.date = ? AND ${playedStatusSql('r')}`, [...terrainIds, dateStr]);
      weeklyRevenue.push({ day: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][d.getDay()], revenue: rev.total });
    }

    res.json({
      totalRevenue: revenueTotals.montants_reverses,
      totalAvances: revenueTotals.avances_encaissees,
      totalCommission: revenueTotals.commissions_prelevees,
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

app.get('/api/proprietaire/profile', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const propId = req.user.id;
    const account = queryOne(db, `SELECT id, nom, email, telephone, plan, statut, created_at
      FROM proprietaires WHERE id = ?`, [propId]);
    if (!account) return res.status(404).json({ error: 'Profil proprietaire introuvable' });

    const terrains = queryAll(db, `SELECT id, nom, ville, adresse, type, is_active, modele_revenus,
      pourcentage_avance, commission_pourcentage, abonnement_montant, achat_definitif_montant, achat_definitif_paye
      FROM terrains WHERE proprietaire_id = ? ORDER BY created_at DESC`, [propId]);
    const revenueRows = queryAll(db, ownerRevenueRowsSql({ ownerWhere: 't.proprietaire_id = ?', dateWhere: '' }), [propId]);
    const revenue = summarizeOwnerRevenue(revenueRows);
    const pendingReservations = queryOne(db, `SELECT COUNT(*) AS total
      FROM reservations r
      JOIN terrains t ON t.id = r.terrain_id
      WHERE t.proprietaire_id = ? AND r.statut = 'en_attente'`, [propId]).total;
    const playedMatches = queryAll(db, `SELECT r.id, r.joueur_nom, r.date, r.heure_debut, r.heure_fin,
        COALESCE(r.montant_avance, r.acompte, 0) AS montant_avance,
        t.nom AS terrain_nom
      FROM reservations r
      JOIN terrains t ON t.id = r.terrain_id
      WHERE t.proprietaire_id = ? AND ${playedStatusSql('r')}
      ORDER BY r.date DESC, r.heure_debut DESC
      LIMIT 8`, [propId]);

    res.json({
      account,
      summary: {
        terrains_total: terrains.length,
        terrains_actifs: terrains.filter((terrain) => Number(terrain.is_active) === 1).length,
        reservations_en_attente: Number(pendingReservations || 0),
        ...revenue,
      },
      terrains,
      playedMatches,
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
    res.json(terrains.map(serializeTerrain));
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

app.get('/api/proprietaire/sante/:terrain_id', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.terrain_id);
    const terrain = queryOne(db, 'SELECT id FROM terrains WHERE id = ? AND proprietaire_id = ?', [terrainId, req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
    res.json(scoreService.getSanteTerrain(db, terrainId));
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
    
    // Fenêtre large pour calendrier / anti-conflit UI (pas LIMIT 20 qui masquait des résas)
    const reservations = queryAll(db, `
      SELECT r.*, COALESCE(r.joueur_nom, u.nom) as joueur_nom, COALESCE(r.joueur_telephone, u.telephone) as joueur_telephone
      FROM reservations r LEFT JOIN users u ON u.id = r.joueur_id
      WHERE r.terrain_id = ?
        AND r.date >= date('now', '-7 days')
        AND r.date <= date('now', '+60 days')
        AND r.statut IN ('en_attente', 'confirme', 'acceptee', 'joue', 'match_joue')
      ORDER BY r.date ASC, r.heure_debut ASC
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
    if (!Array.isArray(horaires) || !horaires.length) {
      return res.status(400).json({ error: 'Liste d\'horaires requise' });
    }
    const terrainId = req.user.terrain_id;
    for (const raw of horaires) {
      const h = validateHorairePayload(raw);
      const existing = queryOne(db, 'SELECT id FROM horaires WHERE terrain_id = ? AND jour = ?', [
        terrainId,
        h.jour,
      ]);
      if (existing) {
        runSql(
          db,
          'UPDATE horaires SET heure_debut = ?, heure_fin = ?, est_ouvert = ? WHERE terrain_id = ? AND jour = ?',
          [h.heure_debut, h.heure_fin, h.est_ouvert ? 1 : 0, terrainId, h.jour],
        );
      } else {
        runSql(
          db,
          'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, ?)',
          [terrainId, h.jour, h.heure_debut, h.heure_fin, h.est_ouvert ? 1 : 0],
        );
      }
    }
    res.json({
      message: 'Horaires mis à jour',
      note_minuit: 'Fin à 00:00 = ouvert jusqu\'à minuit (créneau « … minuit » = 00:00 du lendemain).',
    });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

// Propriétaire : mêmes plages horaires configurables
app.put('/api/terrains/:id/horaires', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ? AND proprietaire_id = ?', [
      Number(req.params.id),
      req.user.id,
    ]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });
    const { horaires } = req.body;
    if (!Array.isArray(horaires) || !horaires.length) {
      return res.status(400).json({ error: 'Liste d\'horaires requise' });
    }
    for (const raw of horaires) {
      const h = validateHorairePayload(raw);
      const existing = queryOne(db, 'SELECT id FROM horaires WHERE terrain_id = ? AND jour = ?', [terrain.id, h.jour]);
      if (existing) {
        runSql(db, 'UPDATE horaires SET heure_debut = ?, heure_fin = ?, est_ouvert = ? WHERE terrain_id = ? AND jour = ?',
          [h.heure_debut, h.heure_fin, h.est_ouvert ? 1 : 0, terrain.id, h.jour]);
      } else {
        runSql(db, 'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, ?)',
          [terrain.id, h.jour, h.heure_debut, h.heure_fin, h.est_ouvert ? 1 : 0]);
      }
    }
    res.json({ message: 'Horaires mis à jour' });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.post('/api/gerant/blocages', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const { date, heure_debut, heure_fin, motif } = req.body;
    if (!date || !heure_debut || !heure_fin) {
      return res.status(400).json({ error: 'date, heure_debut et heure_fin requis' });
    }
    if (String(heure_fin) <= String(heure_debut)) {
      return res.status(400).json({ error: 'L\'heure de fin doit être après l\'heure de début' });
    }

    const terrainId = req.user.terrain_id;
    const chevauchementResa = queryAll(
      db,
      `SELECT id, joueur_nom, heure_debut, heure_fin FROM reservations
        WHERE terrain_id = ? AND date = ?
          AND statut IN ('en_attente', 'confirme', 'acceptee')
          AND heure_debut < ? AND heure_fin > ?`,
      [terrainId, date, heure_fin, heure_debut],
    );
    if (chevauchementResa.length) {
      return res.status(409).json({
        error: 'Impossible de bloquer : une réservation existe déjà sur ce créneau',
        code: 'CRENEAU_CONFLIT',
      });
    }

    const chevauchementBlocage = queryAll(
      db,
      `SELECT id FROM blocages_creneaux
        WHERE terrain_id = ? AND date = ?
          AND heure_debut < ? AND heure_fin > ?`,
      [terrainId, date, heure_fin, heure_debut],
    );
    if (chevauchementBlocage.length) {
      return res.status(409).json({
        error: 'Ce créneau est déjà bloqué',
        code: 'CRENEAU_CONFLIT',
      });
    }

    const result = runSql(db, 'INSERT INTO blocages_creneaux (terrain_id, employe_id, date, heure_debut, heure_fin, motif) VALUES (?, ?, ?, ?, ?, ?)',
      [terrainId, req.user.id, date, heure_debut, heure_fin, motif || null]);
    // Aligne la table creneaux pour l’app joueur / file gérant
    runSql(
      db,
      `UPDATE creneaux SET statut = 'bloque'
        WHERE terrain_id = ? AND date = ?
          AND heure_debut >= ? AND heure_debut < ?`,
      [terrainId, date, heure_debut, heure_fin],
    );
    const blocage = queryOne(db, 'SELECT * FROM blocages_creneaux WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(blocage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** Blocage multi-créneaux (Workflow 6) */
app.post('/api/gerant/blocages/batch', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = req.user.terrain_id;
    const date = String(req.body?.date || '').slice(0, 10);
    const motif = req.body?.motif ? String(req.body.motif) : null;
    const slots = Array.isArray(req.body?.creneaux) ? req.body.creneaux : [];
    if (!date || slots.length === 0) {
      return res.status(400).json({ error: 'date et creneaux requis' });
    }

    const created = [];
    const errors = [];

    for (const raw of slots) {
      const heure_debut = String(raw?.heure_debut || '').slice(0, 5);
      const heure_fin = String(raw?.heure_fin || '').slice(0, 5);
      if (!heure_debut || !heure_fin || heure_fin <= heure_debut) {
        errors.push({ heure_debut, error: 'Créneau invalide' });
        continue;
      }

      const chevauchementResa = queryAll(
        db,
        `SELECT id FROM reservations
          WHERE terrain_id = ? AND date = ?
            AND statut IN ('en_attente', 'confirme', 'acceptee')
            AND heure_debut < ? AND heure_fin > ?`,
        [terrainId, date, heure_fin, heure_debut],
      );
      if (chevauchementResa.length) {
        errors.push({ heure_debut, error: 'Réservation existante' });
        continue;
      }

      const chevauchementBlocage = queryAll(
        db,
        `SELECT id FROM blocages_creneaux
          WHERE terrain_id = ? AND date = ?
            AND heure_debut < ? AND heure_fin > ?`,
        [terrainId, date, heure_fin, heure_debut],
      );
      if (chevauchementBlocage.length) {
        errors.push({ heure_debut, error: 'Déjà bloqué' });
        continue;
      }

      const result = runSql(
        db,
        'INSERT INTO blocages_creneaux (terrain_id, employe_id, date, heure_debut, heure_fin, motif) VALUES (?, ?, ?, ?, ?, ?)',
        [terrainId, req.user.id, date, heure_debut, heure_fin, motif],
      );
      runSql(
        db,
        `UPDATE creneaux SET statut = 'bloque'
          WHERE terrain_id = ? AND date = ?
            AND heure_debut >= ? AND heure_debut < ?`,
        [terrainId, date, heure_debut, heure_fin],
      );
      // Si aucune ligne creneaux, en créer une bloquée
      const existing = queryOne(
        db,
        'SELECT id FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ? ORDER BY id DESC',
        [terrainId, date, heure_debut, heure_fin],
      );
      if (!existing) {
        runSql(
          db,
          'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)',
          [terrainId, date, heure_debut, heure_fin, 'bloque'],
        );
      }
      const blocage =
        queryOne(db, 'SELECT * FROM blocages_creneaux WHERE id = ?', [result.lastInsertRowid]) ||
        queryOne(
          db,
          `SELECT * FROM blocages_creneaux
            WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?
            ORDER BY id DESC`,
          [terrainId, date, heure_debut, heure_fin],
        );
      if (blocage) created.push(blocage);
    }

    if (created.length === 0) {
      return res.status(409).json({
        error: errors[0]?.error || 'Aucun créneau bloqué',
        code: 'CRENEAU_CONFLIT',
        errors,
      });
    }

    res.status(201).json({
      count: created.length,
      blocages: created,
      errors,
      message: `${created.length} créneau(x) bloqué(s) ✓`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/gerant/blocages/:id', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = req.user.terrain_id;
    const blocage = queryOne(db, 'SELECT * FROM blocages_creneaux WHERE id = ? AND terrain_id = ?', [
      Number(req.params.id),
      terrainId,
    ]);
    if (!blocage) return res.status(404).json({ error: 'Blocage introuvable' });

    runSql(db, 'DELETE FROM blocages_creneaux WHERE id = ? AND terrain_id = ?', [
      Number(req.params.id),
      terrainId,
    ]);
    runSql(
      db,
      `UPDATE creneaux SET statut = 'libre'
        WHERE terrain_id = ? AND date = ?
          AND heure_debut >= ? AND heure_debut < ?
          AND statut = 'bloque'`,
      [terrainId, blocage.date, blocage.heure_debut, blocage.heure_fin],
    );
    res.json({ message: 'Créneau débloqué' });
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
// WEB PUSH
// ============================================================
app.get('/api/push/vapid-public-key', (req, res) => {
  const publicKey = pushService.getPublicKey();
  if (!publicKey) {
    return res.status(503).json({ error: 'Web Push non configuré sur ce serveur' });
  }
  res.json({ publicKey });
});

app.get('/api/push/preferences', authMiddleware, requireRole('joueur'), async (req, res) => {
  try {
    const prefs = await pushService.getPreferences(req.user.id);
    res.json(prefs);
  } catch (err) {
    logger.error('index.js', 'GET push preferences', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/push/preferences', authMiddleware, requireRole('joueur'), async (req, res) => {
  try {
    const prefs = await pushService.updatePreferences(req.user.id, req.body || {});
    res.json(prefs);
  } catch (err) {
    logger.error('index.js', 'PUT push preferences', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/push/subscribe', authMiddleware, requireRole('joueur'), async (req, res) => {
  try {
    const { subscription } = req.body || {};
    if (!subscription) return res.status(400).json({ error: 'Subscription manquante' });
    await pushService.upsertSubscription(req.user.id, subscription, req.headers['user-agent'] || '');
    res.json({ message: 'Abonnement push enregistré' });
  } catch (err) {
    logger.error('index.js', 'POST push subscribe', err);
    res.status(400).json({ error: err.message || 'Erreur abonnement push' });
  }
});

app.delete('/api/push/unsubscribe', authMiddleware, requireRole('joueur'), async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'Endpoint manquant' });
    await pushService.removeSubscription(req.user.id, endpoint);
    res.json({ message: 'Désabonnement effectué' });
  } catch (err) {
    logger.error('index.js', 'DELETE push unsubscribe', err);
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
app.get('/api/profil', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const account = selectProfileAccount(db, req.user);
    if (!account) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const role = req.user.role === 'superadmin' ? 'super_admin' : req.user.role;
    const name = splitDisplayName(account);
    const computed = buildProfileStats(db, { ...req.user, role });

    res.json({
      account: {
        ...account,
        prenom: account.prenom || name.prenom,
        nom: name.nom || account.nom,
        role,
        role_label: profileRoleLabel(role),
        accountType: req.user.accountType,
      },
      terrain_associe: computed.terrainAssocie,
      stats: computed.stats,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/profil/joueur', authMiddleware, requireRole('joueur'), async (req, res) => {
  try {
    const db = await getDb();
    const account = selectProfileAccount(db, req.user);
    if (!account) return res.status(404).json({ error: 'Profil joueur introuvable' });

    const reservationsTotales = queryOne(db, 'SELECT COUNT(*) AS total FROM reservations WHERE joueur_id = ?', [req.user.id]) || { total: 0 };
    const matchsJoues = queryOne(db, `SELECT COUNT(*) AS total FROM reservations
      WHERE joueur_id = ? AND ${playedStatusSql('reservations')}`, [req.user.id]) || { total: 0 };
    const terrainPrefere = queryOne(db, `SELECT t.nom, COUNT(*) AS total
      FROM reservations r
      JOIN terrains t ON t.id = r.terrain_id
      WHERE r.joueur_id = ?
      GROUP BY t.id
      ORDER BY total DESC, t.nom ASC
      LIMIT 1`, [req.user.id]);

    res.json({
      account: publicProfileAccount(account, req.user),
      stats: {
        reservations_totales: Number(reservationsTotales.total || 0),
        matchs_joues: Number(matchsJoues.total || 0),
        terrain_prefere: terrainPrefere?.nom || 'Aucun',
      },
    });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.get('/api/profil/gerant', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const account = selectProfileAccount(db, req.user);
    if (!account) return res.status(404).json({ error: 'Profil gerant introuvable' });

    const terrain = queryOne(db, 'SELECT id, nom, adresse, ville FROM terrains WHERE id = ?', [req.user.terrain_id]);
    const from = currentMonthStart();
    const matchs = queryOne(db, `SELECT COUNT(*) AS total FROM matchs
      WHERE gerant_id = ? AND date(joue_at) >= date(?)`, [req.user.id, from]) || { total: 0 };
    const creneaux = queryOne(db, `SELECT COUNT(*) AS total FROM creneaux
      WHERE terrain_id = ? AND statut IN ('libre', 'reserve', 'en_attente_paiement')`, [req.user.terrain_id]) || { total: 0 };

    res.json({
      account: publicProfileAccount(account, req.user),
      terrain,
      stats: {
        matchs_valides_mois: Number(matchs.total || 0),
        creneaux_actifs: Number(creneaux.total || 0),
        membre_depuis: account.created_at,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.get('/api/profil/proprietaire', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const account = selectProfileAccount(db, req.user);
    if (!account) return res.status(404).json({ error: 'Profil proprietaire introuvable' });

    const terrains = queryAll(db, `SELECT id, nom, adresse, ville, type, is_active
      FROM terrains WHERE proprietaire_id = ?
      ORDER BY nom ASC`, [req.user.id]);
    const from = currentMonthStart();
    const terrainIds = terrains.map((terrain) => Number(terrain.id));
    let matchs = { total: 0 };
    if (terrainIds.length) {
      const placeholders = terrainIds.map(() => '?').join(',');
      matchs = queryOne(db, `SELECT COUNT(*) AS total FROM matchs
        WHERE terrain_id IN (${placeholders}) AND date(joue_at) >= date(?)`, [...terrainIds, from]) || { total: 0 };
    }

    res.json({
      account: publicProfileAccount(account, req.user),
      terrains,
      stats: {
        nombre_terrains: terrains.length,
        matchs_joues_mois: Number(matchs.total || 0),
        membre_depuis: account.created_at,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.get('/api/profil/admin', authMiddleware, requireRole('super_admin'), async (req, res) => {
  try {
    const db = await getDb();
    const account = selectProfileAccount(db, req.user);
    if (!account) return res.status(404).json({ error: 'Profil admin introuvable' });

    res.json({
      account: publicProfileAccount(account, req.user),
      stats: {
        membre_depuis: account.created_at,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.put('/api/profil', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const table = profileTableFor(req.user.accountType);
    const prenom = String(req.body.prenom || '').trim().slice(0, 120) || null;
    const nom = String(req.body.nom || '').trim().slice(0, 180);
    const quartier = String(req.body.quartier || '').trim().slice(0, 180) || null;
    const dateNaissance = String(req.body.date_naissance || '').trim() || null;
    const bio = String(req.body.bio || '').trim().slice(0, 150) || null;

    if (!nom) {
      return res.status(400).json({ error: 'Le nom est obligatoire' });
    }

    runSql(db, `UPDATE ${table}
      SET prenom = ?, nom = ?, quartier = ?, date_naissance = ?, bio = ?
      WHERE id = ?`, [prenom, nom, quartier, dateNaissance, bio, req.user.id]);

    const account = selectProfileAccount(db, req.user);
    res.json({ message: 'Profil mis à jour', account: { ...account, role: req.user.role, accountType: req.user.accountType } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/profil/photo', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const table = profileTableFor(req.user.accountType);
    const photoUrl = saveProfilePhoto(req.user.accountType, req.user.id, req.body?.dataUrl);
    runSql(db, `UPDATE ${table} SET photo_url = ? WHERE id = ?`, [photoUrl, req.user.id]);
    res.status(201).json({ photo_url: photoUrl });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.patch('/api/profil/photo', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const table = profileTableFor(req.user.accountType);
    const photoUrl = saveProfilePhoto(req.user.accountType, req.user.id, req.body?.dataUrl);
    runSql(db, `UPDATE ${table} SET photo_url = ? WHERE id = ?`, [photoUrl, req.user.id]);
    res.json({ photo_url: photoUrl });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.patch('/api/profil/password', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const { old_password, new_password, confirm_password } = req.body || {};
    if (!new_password || String(new_password).length < 8) {
      return res.status(400).json({ error: 'Mot de passe trop court' });
    }
    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'Confirmation du mot de passe invalide' });
    }

    const table = profileTableFor(req.user.accountType);
    const account = queryOne(db, `SELECT password_hash FROM ${table} WHERE id = ?`, [req.user.id]);
    if (!account) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const role = req.user.role === 'superadmin' ? 'super_admin' : req.user.role;
    if (role === 'super_admin' && !bcrypt.compareSync(String(old_password || ''), account.password_hash || '')) {
      return res.status(400).json({ error: 'Ancien mot de passe incorrect' });
    }

    const hash = bcrypt.hashSync(new_password, 12);
    runSql(db, `UPDATE ${table} SET password_hash = ?, must_change_password = 0 WHERE id = ?`, [hash, req.user.id]);
    res.json({ message: 'Mot de passe modifie' });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.patch('/api/profil/joueur', authMiddleware, requireRole('joueur'), async (req, res) => {
  try {
    assertAccountRole(req, 'joueur');
    const db = await getDb();
    const prenom = String(req.body.prenom || '').trim().slice(0, 120) || null;
    const nom = String(req.body.nom || '').trim().slice(0, 180);
    const quartier = String(req.body.quartier || '').trim().slice(0, 180) || null;
    const dateNaissance = String(req.body.date_naissance || '').trim() || null;
    if (!nom) return res.status(400).json({ error: 'Le nom est obligatoire' });
    runSql(db, `UPDATE users SET prenom = ?, nom = ?, quartier = ?, date_naissance = ? WHERE id = ?`,
      [prenom, nom, quartier, dateNaissance, req.user.id]);
    res.json({ message: 'Profil joueur mis a jour' });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.patch('/api/profil/admin', authMiddleware, requireRole('super_admin'), async (req, res) => {
  try {
    assertAccountRole(req, 'super_admin');
    const db = await getDb();
    const prenom = String(req.body.prenom || '').trim().slice(0, 120) || null;
    const nom = String(req.body.nom || '').trim().slice(0, 180);
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!nom || !email) return res.status(400).json({ error: 'Nom et email obligatoires' });
    const duplicate = queryOne(db, 'SELECT id FROM users WHERE email = ? AND id != ?', [email, req.user.id]);
    if (duplicate) return res.status(409).json({ error: 'Email deja utilise' });
    runSql(db, 'UPDATE users SET prenom = ?, nom = ?, email = ? WHERE id = ?', [prenom, nom, email, req.user.id]);
    res.json({ message: 'Profil admin mis a jour' });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

// ============================================================
// SERVE STATIC (production)
// ============================================================
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'dist'), {
    maxAge: '1y',
    immutable: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (/\.(js|css|png|jpg|webp|avif|svg|woff2|ico)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
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
          `\uD83D\uDCCA *Resume semaine* — ${row.terrain_nom}\n\n` +
          `Reservations : ${Number(row.reservations || 0)}\n` +
          `Avances encaissees : ${Number(row.acomptes || 0).toLocaleString('fr-FR')} FCFA\n` +
          `Commission plateforme : ${Number(row.commissions || 0).toLocaleString('fr-FR')} FCFA\n` +
          `Reverse cette semaine : ${Number(row.reverse_semaine || 0).toLocaleString('fr-FR')} FCFA\n` +
          `Solde disponible : ${Number(row.solde_disponible || 0).toLocaleString('fr-FR')} FCFA`);
      }
    } catch (error) {
      logger.error('index.js', 'Resume hebdomadaire WhatsApp', error);
    }
  });
}

function programmerSurveillanceConfiance() {
  if (!cron) {
    logger.warn('index.js', 'node-cron non installe: surveillance confiance inactive');
    return;
  }

  cron.schedule('0 9 * * 1', async () => {
    await scoreService.verifierAnnulationsRepetees().catch((error) => {
      logger.error('index.js', 'Surveillance annulations repetees', error);
    });
  });

  cron.schedule('0 10 * * 1', async () => {
    await scoreService.verifierInactiviteScan().catch((error) => {
      logger.error('index.js', 'Surveillance inactivite scan', error);
    });
  });
}

async function appliquerSuspensionsAbonnements() {
  const db = await getDb();
  transaction(db, () => {
    appliquerSuspensionsAbonnementsDb(db);
  });
}

function programmerRappelsReservations() {
  if (!cron) {
    logger.warn('index.js', 'node-cron non installe: rappels push inactifs');
    return;
  }

  cron.schedule('*/15 * * * *', async () => {
    try {
      const result = await pushService.envoyerRappelsReservations();
      if (result.processed > 0) {
        logger.info('index.js', `Rappels push envoyes: ${result.processed}`);
      }
    } catch (error) {
      logger.error('index.js', 'Rappels push reservations', error);
    }
  });
}

async function ensureSeedData(db) {
  const count = queryOne(db, 'SELECT COUNT(*) AS total FROM terrains');
  if (Number(count?.total || 0) > 0) return;
  logger.info('index.js', 'Base vide — chargement des donnees de demo...');
  const { seed } = require('./seed');
  await seed();
}

async function start() {
  const db = await getDb(); // Initialize DB + migrations
  await ensureSeedData(db);
  programmerResumeHebdomadaire();
  programmerSurveillanceConfiance();
  programmerRappelsReservations();
  await appliquerSuspensionsAbonnements().catch((error) => {
    logger.error('index.js', 'Suspension abonnements au demarrage', error);
  });
  if (cron) {
    cron.schedule('15 0 * * *', async () => {
      await appliquerSuspensionsAbonnements().catch((error) => {
        logger.error('index.js', 'Suspension abonnements planifiee', error);
      });
    });
  }
  setInterval(async () => {
    try {
      const dbInterval = await getDb();
      transaction(dbInterval, () => {
        const expired = queryAll(dbInterval, `SELECT id, creneau_id, terrain_id, date, heure_debut, heure_fin FROM reservations
          WHERE statut = 'en_attente' AND verrou_expire_at IS NOT NULL AND verrou_expire_at < ?`, [Date.now()]);
        for (const reservation of expired) {
          dbInterval.run("UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut = 'en_attente'", [reservation.id]);
          if (rowsModified(dbInterval) === 1) {
            libererCreneauxReservation(dbInterval, reservation, ['en_attente_paiement']);
          }
        }
      });
    } catch (error) {
      logger.error('index.js', 'Nettoyage des verrous', error);
    }
  }, 5 * 60 * 1000);
  app.listen(PORT, () => {
    logger.info('index.js', `TerrainSN API demarree sur http://localhost:${PORT}`);
  }).on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error('index.js', `Port ${PORT} deja utilise. Arretez l'autre process ou changez PORT.`);
      process.exit(1);
    }
    throw error;
  });
}

start();
