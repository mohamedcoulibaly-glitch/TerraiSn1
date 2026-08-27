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
const { registerGerantMultiRoutes } = require('./routes/multiGerants');
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
const { computeOwnerDashboard } = require('./services/financesService');
const {
  UPLOAD_ROOT,
  listTerrainPhotos,
  listPhotosByTerrainIds,
  createTerrainPhoto,
  updateTerrainPhoto,
  deleteTerrainPhoto,
  setPhotoPrincipale,
  reorderTerrainPhotos,
} = require('./terrainPhotoService');
const { saveProfilePhoto } = require('./profilePhotoService');
const { logActivite } = require('./services/auditService');
const commoditesService = require('./services/commoditesService');
const { executerAnnulation, evaluerRemboursement } = require('./services/annulationService');
const scoreService = require('./services/scoreService');
const { assertFenetreScanQr, calculerFenetreCheckIn, DEFAULT_FENETRE_RETARD_MIN } = require('./services/checkInFenetre');
const { serializeQrPayload, parseQrPayload, assertQrMatchesReservation } = require('./services/qrPayload');
const {
  lockCreneauxAtomique,
  libererCreneauxReservation,
  confirmerCreneauxReservation,
  annulerReservationsConcurrentes,
  libererVerrousPaiementExpires,
  delaiVerrouMs,
  normaliserDelaiVerrouPaiementMin,
  rowsModified,
  normalizeHourString,
} = require('./reservationLockService');
const { calculerPrixReservation, calculerDevis, calculerMontantAvance } = require('./pricingService');
const { getPrixActif } = require('./services/tarifService');
const creneauService = require('./services/creneauService');
const { insertSlot, createPeriode, listGroupes, deleteGroupe, deleteMany, getGroupe, encaisserGroupe } = require('./services/blocagePeriodeService');
const { notifyTerrain, mountTerrainEvents } = require('./realtimeHub');
const { syncApresModificationTerrain } = require('./services/configSync');
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
const bugAlertService = require('./services/bugAlertService');
bugAlertService.installProcessHandlers();
const {
  authMiddleware,
  requireRole,
  genererAccessToken,
  genererRefreshToken,
  hashRefreshToken,
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  verifierTerrainGerant,
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

async function issueAuthTokens(res, db, tokenPayload) {
  const accessToken = genererAccessToken(tokenPayload);
  const refreshToken = genererRefreshToken(tokenPayload);
  const table = refreshTableFor(tokenPayload.accountType || 'user');
  await runSql(
    db,
    `UPDATE ${table} SET refresh_token = ?, refresh_token_expire_at = NOW() + INTERVAL '30 days' WHERE id = ?`,
    [hashRefreshToken(refreshToken), tokenPayload.id]
  );
  setRefreshCookie(res, refreshToken);
  return accessToken;
}

async function findAccountByRefreshToken(db, table, userId, refreshToken) {
  const hashed = hashRefreshToken(refreshToken);
  // Priorité au hash ; fallback legacy (token en clair) le temps de la bascule
  return (
    await queryOne(
      db,
      `SELECT * FROM ${table}
       WHERE id = ?
         AND refresh_token = ?
         AND refresh_token_expire_at > NOW()`,
      [userId, hashed]
    ) ||
    await queryOne(
      db,
      `SELECT * FROM ${table}
       WHERE id = ?
         AND refresh_token = ?
         AND refresh_token_expire_at > NOW()`,
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

/** bcrypt.compareSync plante si le hash n'est pas une string (ex. NULL en PG → typeof null === 'object'). */
function passwordMatches(password, hash) {
  if (typeof hash !== 'string' || !hash) return false;
  try {
    return bcrypt.compareSync(String(password || ''), hash);
  } catch {
    return false;
  }
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

function serializeTerrain(terrain, photoRows, commodites) {
  if (!terrain) return terrain;
  const rows = Array.isArray(photoRows) ? photoRows : [];
  const urls = rows.length ? rows.map((p) => p.url).filter(Boolean) : parsePhotos(terrain.photos);
  const photos = rows.length
    ? rows.map((p) => ({
      id: p.id,
      url: p.url,
      est_principale: p.est_principale,
      ordre: p.ordre,
      largeur_px: p.largeur_px,
      hauteur_px: p.hauteur_px,
      uploaded_by_role: p.uploaded_by_role || null,
    }))
    : urls;
  return {
    ...terrain,
    photos,
    terrain_photos: rows,
    commodites: Array.isArray(commodites) ? commodites : [],
  };
}

async function attachPhotosToTerrains(database, terrains) {
  const list = Array.isArray(terrains) ? terrains : [];
  const photos = await listPhotosByTerrainIds(database, list.map((t) => t.id));
  const byId = new Map();
  for (const photo of photos) {
    const key = Number(photo.terrain_id);
    if (!byId.has(key)) byId.set(key, []);
    byId.get(key).push(photo);
  }
  const commoditesMap = await commoditesService.publicCommoditesByTerrainIds(database, list.map((t) => t.id));
  return list.map((terrain) => serializeTerrain(
    terrain,
    byId.get(Number(terrain.id)) || [],
    commoditesMap.get(Number(terrain.id)) || [],
  ));
}

function profileTableFor(accountType) {
  if (accountType === 'proprietaire') return 'proprietaires';
  if (accountType === 'employe') return 'employes';
  return 'users';
}

async function selectProfileAccount(db, reqUser) {
  const table = profileTableFor(reqUser.accountType);
  if (table === 'proprietaires') {
    return await queryOne(db, `SELECT id, nom, prenom, email, telephone, plan, statut, quartier,
      date_naissance, bio, photo_url, must_change_password, created_at
      FROM proprietaires WHERE id = ?`, [reqUser.id]);
  }
  if (table === 'employes') {
    return await queryOne(db, `SELECT id, nom, prenom, email, telephone, whatsapp_number, terrain_id,
      proprietaire_id, is_active, quartier, date_naissance, bio, photo_url,
      must_change_password, created_at
      FROM employes WHERE id = ?`, [reqUser.id]);
  }
  return await queryOne(db, `SELECT id, nom, prenom, email, telephone, role, terrain_id, is_active, statut,
    quartier, date_naissance, bio, photo_url, must_change_password, created_at
    FROM users WHERE id = ?`, [reqUser.id]);
}

function splitDisplayName(account) {
  const prenom = String(account?.prenom || '').trim();
  const nom = String(account?.nom || '').trim();
  if (prenom && nom) {
    const prenomLower = prenom.toLowerCase();
    const nomLower = nom.toLowerCase();
    if (nomLower === prenomLower) return { prenom, nom: '' };
    if (nomLower.startsWith(`${prenomLower} `)) {
      return { prenom, nom: nom.slice(prenom.length).trim() };
    }
    return { prenom, nom };
  }
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

async function buildProfileStats(db, reqUser) {
  const role = reqUser.role === 'superadmin' ? 'super_admin' : reqUser.role;

  if (role === 'proprietaire') {
    const terrains = await queryOne(db, 'SELECT COUNT(*) AS total FROM terrains WHERE proprietaire_id = ?', [reqUser.id]) || { total: 0 };
    const rows = await queryAll(db, ownerRevenueRowsSql({ ownerWhere: 't.proprietaire_id = ?', dateWhere: '' }), [reqUser.id]);
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
    const terrain = await queryOne(db, 'SELECT id, nom FROM terrains WHERE id = ?', [reqUser.terrain_id]) || null;
    const matches = await queryOne(db, 'SELECT COUNT(*) AS total FROM matchs WHERE gerant_id = ?', [reqUser.id]) || { total: 0 };
    const creneaux = await queryOne(db, 'SELECT COUNT(*) AS total FROM creneaux WHERE terrain_id = ?', [reqUser.terrain_id]) || { total: 0 };
    return {
      terrainAssocie: terrain?.nom || 'Terrain non associé',
      stats: [
        { label: 'Matchs validés', value: Number(matches.total || 0) },
        { label: 'Créneaux gérés', value: Number(creneaux.total || 0) },
      ],
    };
  }

  if (role === 'super_admin') {
    const terrains = await queryOne(db, 'SELECT COUNT(*) AS total FROM terrains') || { total: 0 };
    const owners = await queryOne(db, 'SELECT COUNT(*) AS total FROM proprietaires') || { total: 0 };
    return {
      terrainAssocie: '',
      stats: [
        { label: 'Terrains', value: Number(terrains.total || 0) },
        { label: 'Propriétaires', value: Number(owners.total || 0) },
      ],
    };
  }

  const reservations = await queryOne(db, 'SELECT COUNT(*) AS total FROM reservations WHERE joueur_id = ?', [reqUser.id]) || { total: 0 };
  const terrains = await queryOne(db, 'SELECT COUNT(DISTINCT terrain_id) AS total FROM reservations WHERE joueur_id = ?', [reqUser.id]) || { total: 0 };
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

  if (reqPath.includes('/events') || reqPath.includes('/creneaux') || reqPath.includes('/devis')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Vary', 'Authorization, Accept-Encoding');
  } else if (reqPath.startsWith('/api/terrains') && req.method === 'GET') {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
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
registerGerantMultiRoutes(app);
mountPaymentRoutes(app);
mountGerantCheckinRoutes(app);
mountGerantCrmRoutes(app);
mountTerrainEvents(app);

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

    const existingPhone = (await queryAll(db, 'SELECT id, telephone, telephone_verified, role FROM users')).find(
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
      await runSql(
        db,
        `UPDATE users SET nom = ?, prenom = ?, password_hash = ?, email = ?, role = 'joueur', is_active = 1, telephone_verified = 0
         WHERE id = ?`,
        [fullName, prenom || null, password_hash, generatedEmail, existingPhone.id]
      );
      userId = existingPhone.id;
    } else {
      const existingEmail = await queryOne(db, 'SELECT id FROM users WHERE email = ?', [generatedEmail]);
      if (existingEmail) return res.status(409).json({ error: 'Compte déjà existant' });

      const result = await runSql(
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

    const { otp, telephoneDigits, error } = await otpService.findValidOtp(db, telephone, code);
    if (error) return res.status(400).json({ error });

    const user = (await queryAll(db, 'SELECT id, nom, prenom, email, telephone, role, telephone_verified FROM users'))
      .find((u) => otpService.normalizeTelephone(u.telephone) === telephoneDigits);

    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable. Réinscrivez-vous.' });

    await runSql(db, 'UPDATE auth_otps SET used = 1 WHERE id = ?', [otp.id]);
    await runSql(db, 'UPDATE users SET telephone_verified = 1 WHERE id = ?', [user.id]);
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

    const accessToken = await issueAuthTokens(res, db, {
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
    const user = (await queryAll(db, 'SELECT id, prenom, telephone, telephone_verified FROM users'))
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
      account = findIn(await queryAll(db, 'SELECT * FROM proprietaires'));
      role = 'proprietaire';
    } else if (resolvedType === 'employe') {
      account = findIn(await queryAll(db, 'SELECT * FROM employes'));
      role = 'gerant';
    } else if (resolvedType === 'user') {
      account = findIn(await queryAll(db, 'SELECT * FROM users'));
      role = account?.role === 'super_admin' || account?.role === 'superadmin'
        ? (account.role === 'superadmin' ? 'super_admin' : account.role)
        : (account?.role || 'joueur');
      if (role === 'superadmin') role = 'super_admin';
    } else {
      // Auto-détection du rôle (login unique frontend) — ne change pas les tables métier
      const asUser = findIn(await queryAll(db, 'SELECT * FROM users'));
      if (asUser) {
        account = asUser;
        resolvedType = 'user';
        role = asUser.role === 'superadmin' ? 'super_admin' : (asUser.role || 'joueur');
      } else {
        const asProprio = findIn(await queryAll(db, 'SELECT * FROM proprietaires'));
        if (asProprio) {
          account = asProprio;
          resolvedType = 'proprietaire';
          role = 'proprietaire';
        } else {
          const asEmploye = findIn(await queryAll(db, 'SELECT * FROM employes'));
          if (asEmploye) {
            account = asEmploye;
            resolvedType = 'employe';
            role = 'gerant';
          }
        }
      }
    }

    if (!account) return res.status(401).json({ error: 'Identifiants incorrects' });
    if (!passwordMatches(password, account.password_hash)) {
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

    const accessToken = await issueAuthTokens(res, db, tokenPayload);

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
    // Priorité : super_admin > propriétaire > gérant (évite d'ouvrir l'espace gérant
    // quand le même téléphone existe aussi sur un compte propriétaire).
    const candidates = [
      ...(await queryAll(db, 'SELECT * FROM employes')).map((row) => ({
        account: row,
        resolvedType: 'employe',
        role: 'gerant',
        priority: 2,
      })),
      ...(await queryAll(db, 'SELECT * FROM proprietaires')).map((row) => ({
        account: row,
        resolvedType: 'proprietaire',
        role: 'proprietaire',
        priority: 1,
      })),
      ...(await queryAll(db, 'SELECT * FROM users')).map((row) => {
        let role = row.role === 'superadmin' ? 'super_admin' : (row.role || 'joueur');
        if (role === 'superadmin') role = 'super_admin';
        return {
          account: row,
          resolvedType: 'user',
          role,
          priority: role === 'super_admin' ? 0 : 9,
        };
      }),
    ].filter((c) => matchesIdentifier(c.account));

    const authenticated = candidates
      .filter((c) => passwordMatches(password, c.account.password_hash))
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

    const accessToken = await issueAuthTokens(res, db, tokenPayload);
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
    const account = await findAccountByRefreshToken(db, table, payload.id, refreshToken);

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
      await runSql(
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
      await runSql(db, `UPDATE ${table} SET refresh_token = NULL, refresh_token_expire_at = NULL WHERE id = ?`, [userId]);
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
    const account = await selectProfileAccount(db, req.user);
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
    await runSql(db, `UPDATE ${table} SET password_hash = ?, must_change_password = 0 WHERE id = ?`, [hash, req.user.id]);
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
async function countCreneauxLibres(db, terrainId, dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return { libres: 0, total: 0, ferme: true };
  const jour = JOURS_MAP[d.getDay()];
  const horaire = await queryOne(db, 'SELECT * FROM horaires WHERE terrain_id = ? AND jour = ?', [terrainId, jour]);
  if (!horaire || !horaire.est_ouvert) return { libres: 0, total: 0, ferme: true };

  const planned = buildSlotsForOpenDay(dateStr, horaire).filter((s) => {
    const slotDate = String(s.date).slice(0, 10);
    const h = parseInt(String(s.heure_debut).slice(0, 2), 10);
    if (slotDate === dateStr && h >= 5) return true;
    if (slotDate !== dateStr && h < 5) return true;
    return false;
  });
  if (!planned.length) return { libres: 0, total: 0, ferme: true };

  const datesNeeded = [...new Set(planned.map((s) => String(s.date).slice(0, 10)))];
  const placeholders = datesNeeded.map(() => '?').join(',');

  const reservations = await queryAll(
    db,
    `SELECT date, heure_debut, heure_fin FROM reservations WHERE terrain_id = ? AND date IN (${placeholders}) AND statut IN ('confirme', 'acceptee')`,
    [terrainId, ...datesNeeded],
  );
  const blocages = await queryAll(
    db,
    `SELECT date, heure_debut, heure_fin FROM blocages_creneaux WHERE terrain_id = ? AND date IN (${placeholders})`,
    [terrainId, ...datesNeeded],
  );

  let libres = 0;
  const total = planned.length;
  for (const slotPlan of planned) {
    const slotDate = String(slotPlan.date).slice(0, 10);
    const slot = String(slotPlan.heure_debut).slice(0, 5);
    const slotFin = String(slotPlan.heure_fin).slice(0, 5);
    const isReserved = reservations.some(
      (r) =>
        String(r.date).slice(0, 10) === slotDate &&
        slot < String(r.heure_fin).slice(0, 5) &&
        slotFin > String(r.heure_debut).slice(0, 5),
    );
    const isBlocked = blocages.some(
      (b) =>
        String(b.date).slice(0, 10) === slotDate &&
        slot < String(b.heure_fin).slice(0, 5) &&
        slotFin > String(b.heure_debut).slice(0, 5),
    );
    if (isReserved || isBlocked) continue;

    const creneau = await queryOne(
      db,
      'SELECT statut FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ?',
      [terrainId, slotDate, slot],
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

// Catalogue public commodités (actif) — pour pickers / affichage
app.get('/api/commodites', async (req, res) => {
  try {
    const db = await getDb();
    const rows = await commoditesService.listCommodites(db, { actif: 1 });
    res.json(
      rows.map((r) => ({
        id: r.id,
        cle: r.cle,
        label_fr: r.label_fr,
        icone: r.icone,
        description: r.description,
        ordre: r.ordre,
      })),
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

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
      ? ' GROUP BY t.id, p.nom'
      : ' GROUP BY t.id, p.nom ORDER BY LOWER(t.nom) ASC';

    let terrains = await queryAll(db, query, params);

    if (dateList.length > 0) {
      const enriched = [];
      for (const t of terrains) {
        let libres = 0;
        let total = 0;
        let ferme = true;
        for (const d of dateList) {
          const info = await countCreneauxLibres(db, t.id, d);
          libres += info.libres;
          total += info.total;
          if (!info.ferme) ferme = false;
        }
        enriched.push({ ...t, creneaux_libres: libres, creneaux_total: total, ferme_date: ferme });
      }
      terrains = enriched;
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
      const hasDistanceFilter = Number.isFinite(distanceMax) && distanceMax > 0;
      terrains = terrains
        .map((t) => {
          const tLat = Number(t.latitude);
          const tLng = Number(t.longitude);
          const distance_km = Number.isFinite(tLat) && Number.isFinite(tLng)
            ? Math.round(haversineKm(userLat, userLng, tLat, tLng) * 10) / 10
            : null;
          return { ...t, distance_km };
        });
      // Ne filtre par rayon que si distance_max est explicitement fourni
      if (hasDistanceFilter) {
        terrains = terrains.filter((t) => t.distance_km === null || t.distance_km <= distanceMax);
      }
      terrains = terrains.sort((a, b) => {
        if (a.distance_km === null) return 1;
        if (b.distance_km === null) return -1;
        return a.distance_km - b.distance_km;
      });
    }

    res.json(await attachPhotosToTerrains(db, terrains));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Détails d'un terrain
app.get('/api/terrains/:id', async (req, res) => {
  try {
    const db = await getDb();
    const full = require('./services/terrainFullDetailsService');
    // Sans ?date= : même payload enrichi + planning du jour (1 round-trip)
    const date = req.query.date ? String(req.query.date).slice(0, 10) : full.todayLocalYmd();
    const dureeParam = req.query.duree_minutes != null ? Number(req.query.duree_minutes) : null;
    const payload = await full.getTerrainFullDetails(db, Number(req.params.id), {
      date,
      duree_minutes: dureeParam,
      serializeTerrain,
    });
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

/** Endpoint consolidé anti-waterfall mobile (terrain + photos + créneaux). */
app.get('/api/terrains/:id/full-details', async (req, res) => {
  try {
    const db = await getDb();
    const full = require('./services/terrainFullDetailsService');
    const date = req.query.date ? String(req.query.date).slice(0, 10) : full.todayLocalYmd();
    const dureeParam = req.query.duree_minutes != null ? Number(req.query.duree_minutes) : null;
    const payload = await full.getTerrainFullDetails(db, Number(req.params.id), {
      date,
      duree_minutes: dureeParam,
      serializeTerrain,
    });
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

// Créneaux disponibles (durées variables + chevauchements)
app.get('/api/terrains/:id/creneaux', async (req, res) => {
  try {
    const db = await getDb();
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'Date requise' });
    const dateStr = String(date).slice(0, 10);
    const terrainId = Number(req.params.id);
    const dureeParam = req.query.duree_minutes != null ? Number(req.query.duree_minutes) : null;
    const inclurePasses =
      req.query.inclure_passes === '1' ||
      req.query.inclure_passes === 'true' ||
      req.query.vue === 'gerant';

    const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });

    const payload = await creneauService.getDisponibilitesPourJoueur(db, terrainId, dateStr, {
      duree_minutes: Number.isFinite(dureeParam) && dureeParam > 0 ? dureeParam : null,
      inclure_passes: inclurePasses,
    });

    const bookingAvail = require('./services/terrainBookingAvailability');
    let availability = {
      en_ligne_indisponible: false,
      booking_online_available: true,
      whatsapp_status: null,
      gerant_telephone: null,
      gerant_tel_href: null,
      gerant_nom: null,
      message: null,
    };
    try {
      availability = await bookingAvail.getTerrainBookingAvailability(terrainId);
    } catch (availErr) {
      console.warn('[bookingAvail] creneaux', availErr?.message || availErr);
    }

    if (payload.ferme) {
      return res.json({
        date: dateStr,
        creneaux: [],
        ferme: true,
        motif: payload.motif || 'Terrain temporairement fermé',
        is_active: 0,
        en_ligne_indisponible: availability.en_ligne_indisponible,
        booking_online_available: availability.booking_online_available,
        gerant_tel_href: availability.gerant_tel_href,
        booking_message: availability.message,
      });
    }

    const maintenant = new Date();

    // Joueur : masquer les heures déjà passées. Gérant (inclure_passes) : journée complète.
    let creneaux = inclurePasses
      ? payload.creneaux || []
      : creneauService.exclureCreneauxHorairesPasses(payload.creneaux || [], dateStr, maintenant);

    // Flag WA down sans griser les libres (visibilité semaine intacte)
    if (availability.en_ligne_indisponible) {
      creneaux = creneaux.map((c) => ({
        ...c,
        en_ligne_indisponible: true,
        booking_online_blocked: Boolean(c.disponible),
      }));
    }

    res.json({
      date: dateStr,
      terrain_id: terrainId,
      creneaux,
      horaire: payload.horaire || null,
      calendrier: payload.calendrier || 'senegal',
      note_minuit: payload.note_minuit,
      message: payload.message,
      prix_entier_base: payload.prix_entier_base,
      prix_moitie_base: payload.prix_moitie_base,
      pourcentage_avance: payload.pourcentage_avance,
      heure_serveur: maintenant.toISOString(),
      en_ligne_indisponible: availability.en_ligne_indisponible,
      booking_online_available: availability.booking_online_available,
      whatsapp_gerant_status: availability.whatsapp_status,
      gerant_telephone: availability.gerant_telephone,
      gerant_tel_href: availability.gerant_tel_href,
      gerant_nom: availability.gerant_nom,
      booking_message: availability.message,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Vérification disponibilité avant paiement (chevauchements durée variable)
app.post('/api/reservations/verifier-disponibilite', async (req, res) => {
  try {
    const db = await getDb();
    const { terrain_id, date, heure_debut, heure_fin, exclure_reservation_id } = req.body || {};
    if (!terrain_id || !date || !heure_debut || !heure_fin) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }
    const debut = normalizeHourString(heure_debut);
    const fin = normalizeHourString(heure_fin);
    const conflits = await creneauService.getConflits(
      db,
      Number(terrain_id),
      String(date).slice(0, 10),
      debut,
      fin,
      exclure_reservation_id ? Number(exclure_reservation_id) : null,
    );
    if (conflits.length > 0) {
      return res.json({
        disponible: false,
        conflits: conflits.map((c) => ({
          heure_debut: c.heure_debut,
          heure_fin: c.heure_fin,
          duree_minutes: c.duree_minutes || creneauService.dureeMinutesOf(c.heure_debut, c.heure_fin),
          joueur_nom: c.joueur_nom || null,
        })),
      });
    }
    const bookingAvail = require('./services/terrainBookingAvailability');
    const availability = await bookingAvail.getTerrainBookingAvailability(Number(terrain_id));
    // Créneau libre ≠ réservation en ligne possible : on sépare les deux signaux
    if (availability.en_ligne_indisponible) {
      return res.json({
        disponible: true,
        en_ligne_indisponible: true,
        booking_online_available: false,
        code: 'EN_LIGNE_INDISPONIBLE',
        message: availability.message,
        gerant_tel_href: availability.gerant_tel_href,
        gerant_telephone: availability.gerant_telephone,
        duree_minutes: creneauService.dureeMinutesOf(debut, fin),
        duree_label: creneauService.formatDuree(creneauService.dureeMinutesOf(debut, fin)),
      });
    }
    res.json({
      disponible: true,
      duree_minutes: creneauService.dureeMinutesOf(debut, fin),
      duree_label: creneauService.formatDuree(creneauService.dureeMinutesOf(debut, fin)),
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
    const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(req.params.id)]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });
    const date = String(req.query.date || '');
    const heure_debut = normalizeHourString(req.query.heure_debut || req.query.debut || '');
    const heure_fin = normalizeHourString(req.query.heure_fin || req.query.fin || '');
    const format_terrain = String(req.query.format || 'entier').trim() || 'entier';
    if (!date || !heure_debut || !heure_fin) {
      return res.status(400).json({ error: 'date, heure_debut et heure_fin requis' });
    }
    const devis = await calculerDevis(db, terrain, { date, heure_debut, heure_fin, format_terrain });
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
    const result = await runSql(db, `INSERT INTO terrains
      (proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_moitie, prix_entier, montant_acompte, acompte, pourcentage_avance, modele_revenus, commission_pourcentage, abonnement_montant, achat_definitif_montant, latitude, longitude, description, telephone, commodites)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, nom, adresse, ville, sport || 'foot', type || '11v11', prixEntier, prixMoitie, prixEntier, avanceTerrain, avanceTerrain, pourcentageAvance, 'commission', 0, 0, 0, Number.isFinite(Number(latitude)) ? Number(latitude) : null, Number.isFinite(Number(longitude)) ? Number(longitude) : null, description, telephone, serializeCommodites(commodites)]);
    
    const openStart = String(heure_debut || '06:00').slice(0, 5);
    const openEnd = String(heure_fin || '00:00').slice(0, 5); // 00:00 = jusqu'à minuit par défaut élargi
    const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    for (const jour of jours) {
      await runSql(db, 'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, 1)', [result.lastInsertRowid, jour, openStart, openEnd]);
    }
    const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(serializeTerrain(terrain));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/terrains/:id', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ? AND proprietaire_id = ?', [Number(req.params.id), req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });

    const { nom, adresse, ville, sport, type, prix_heure, prix_moitie, prix_entier, montant_acompte, acompte, pourcentage_avance, latitude, longitude, description, telephone, is_active, commodites } = req.body;
    const prixEntier = Number(prix_entier || prix_heure || terrain.prix_entier || terrain.prix_heure);
    const pourcentageAvance = Number(pourcentage_avance || (montant_acompte || acompte ? (Number(montant_acompte || acompte) * 100) / prixEntier : terrain.pourcentage_avance || 8));
    const avanceTerrain = Math.round((prixEntier * pourcentageAvance) / 100);
    const commoditesJson =
      commodites !== undefined ? serializeCommodites(commodites) : (terrain.commodites || '[]');
    await runSql(db, `UPDATE terrains SET nom=?, adresse=?, ville=?, sport=?, type=?, prix_heure=?, prix_moitie=?, prix_entier=?,
      montant_acompte=?, acompte=?, pourcentage_avance=?, latitude=?, longitude=?, description=?, telephone=?, is_active=?, commodites=? WHERE id=?`,
      [nom || terrain.nom, adresse || terrain.adresse, ville || terrain.ville, sport || terrain.sport, type || terrain.type, prixEntier, Number(prix_moitie || terrain.prix_moitie || prixEntier * 0.6), prixEntier, avanceTerrain, avanceTerrain, pourcentageAvance, latitude === '' || latitude == null ? terrain.latitude : (Number.isFinite(Number(latitude)) ? Number(latitude) : null), longitude === '' || longitude == null ? terrain.longitude : (Number.isFinite(Number(longitude)) ? Number(longitude) : null), description || terrain.description, telephone || terrain.telephone, is_active !== undefined ? is_active : terrain.is_active, commoditesJson, terrain.id]);
    
    const updated = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrain.id]);
    const prevActive = Number(terrain.is_active);
    const nextActive = Number(updated?.is_active);
    if (prevActive !== nextActive) {
      notifyTerrain(terrain.id, 'statut', {
        action: nextActive === 1 ? 'ouvert' : 'ferme',
        is_active: nextActive,
      });
    } else {
      notifyTerrain(terrain.id, 'horaires', { action: 'updated' });
    }
    res.json((await attachPhotosToTerrains(db, [updated]))[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/terrains/:id/photos', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = await queryOne(db, 'SELECT id FROM terrains WHERE id = ? AND proprietaire_id = ?', [terrainId, req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouve' });
    res.json(await listTerrainPhotos(db, terrainId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/terrains/:id/photos', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = await queryOne(db, 'SELECT id FROM terrains WHERE id = ? AND proprietaire_id = ?', [terrainId, req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouve' });
    const photo = await createTerrainPhoto(db, terrainId, req.body || {});
    saveDb();
    syncApresModificationTerrain(terrainId, 'photos');
    res.status(201).json(photo);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.patch('/api/terrains/:id/photos/ordre', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = await queryOne(db, 'SELECT id FROM terrains WHERE id = ? AND proprietaire_id = ?', [terrainId, req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouve' });
    const photos = await transaction(db, async () => await reorderTerrainPhotos(db, terrainId, req.body?.ordre || []));
    syncApresModificationTerrain(terrainId, 'photos');
    res.json(photos);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.patch('/api/terrains/:id/photos/:photoId/principale', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = await queryOne(db, 'SELECT id FROM terrains WHERE id = ? AND proprietaire_id = ?', [terrainId, req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouve' });
    const photo = await transaction(db, async () => await setPhotoPrincipale(db, terrainId, Number(req.params.photoId)));
    syncApresModificationTerrain(terrainId, 'photos');
    res.json(photo);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.patch('/api/terrains/:id/photos/:photoId', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.id);
    const terrain = await queryOne(db, 'SELECT id FROM terrains WHERE id = ? AND proprietaire_id = ?', [terrainId, req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouve' });
    const photo = await transaction(db, async () => await updateTerrainPhoto(db, terrainId, Number(req.params.photoId), req.body || {}));
    syncApresModificationTerrain(terrainId, 'photos');
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
    const terrain = await queryOne(db, 'SELECT id FROM terrains WHERE id = ? AND proprietaire_id = ?', [terrainId, req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouve' });
    const result = await transaction(db, async () => await deleteTerrainPhoto(db, terrainId, Number(req.params.photoId)));
    syncApresModificationTerrain(terrainId, 'photos');
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.delete('/api/terrains/:id', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ? AND proprietaire_id = ?', [Number(req.params.id), req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });
    await runSql(db, 'DELETE FROM terrains WHERE id = ?', [terrain.id]);
    res.json({ message: 'Terrain supprimé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// RESERVATIONS
// ============================================================

async function creerReservationAvecPaiement(req, res, creePar, terrainIdForce = null) {
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
      joueur_prenom: joueurPrenomBody,
      mode: modeBody,
      anonyme: anonymeBody,
    } = req.body;
    /** 'paiement' = lien PayTech + WA | 'bloquer' = hold sur place sans lien | 'manuel' = avance déjà reçue hors plateforme */
    const mode = modeBody === 'bloquer' ? 'bloquer' : modeBody === 'manuel' ? 'manuel' : 'paiement';
    const anonyme = Boolean(anonymeBody);
    const terrainId = terrainIdForce || Number(terrain_id);
    if (!joueur_nom || (!anonyme && !joueur_telephone)) {
      return res.status(400).json({ error: 'Nom et téléphone du joueur requis' });
    }
    if ((mode === 'paiement' || mode === 'manuel') && anonyme) {
      return res.status(400).json({ error: 'Impossible d’envoyer un lien de paiement à un joueur anonyme' });
    }
    if ((mode === 'paiement' || mode === 'manuel') && !joueur_telephone) {
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

    const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });
    if (Number(terrain.is_active) === 0) {
      return res.status(409).json({ error: 'Terrain temporairement fermé — réservation impossible' });
    }

    if (creePar === 'joueur') {
      const featuresService = require('./services/terrainFeaturesService');
      const flags = await featuresService.featuresFlags(db, terrain.id);
      if (!featuresService.isFeatureEnabled(flags, 'reservations_en_ligne', true)) {
        return res.status(403).json({
          error: 'Les réservations en ligne sont désactivées pour ce terrain. Contacte le gérant.',
          code: 'FEATURE_DISABLED',
        });
      }
      const bookingAvail = require('./services/terrainBookingAvailability');
      const availability = await bookingAvail.getTerrainBookingAvailability(terrain.id, { force: true });
      if (availability.en_ligne_indisponible) {
        return res.status(503).json({
          error:
            availability.message ||
            'Réservation en ligne temporairement indisponible. Appelez le gérant pour réserver.',
          code: 'EN_LIGNE_INDISPONIBLE',
          en_ligne_indisponible: true,
          gerant_telephone: availability.gerant_telephone,
          gerant_tel_href: availability.gerant_tel_href,
          gerant_nom: availability.gerant_nom,
          whatsapp_gerant_status: availability.whatsapp_status,
        });
      }
    }

    if (!date || !heure_debut || !heure_fin) return res.status(400).json({ error: 'Créneau invalide' });
    const heureDebutNorm = normalizeHourString(heure_debut);
    const heureFinNorm = normalizeHourString(heure_fin);
    const dureeMin = creneauService.dureeMinutesOf(heureDebutNorm, heureFinNorm);
    if (!(dureeMin > 0)) return res.status(400).json({ error: 'Créneau invalide' });
    const formatsService = require('./services/formatsTerrainService');
    const formatRow = await formatsService.getFormatByCle(db, terrain.id, format_terrain);
    if (!formatRow) return res.status(400).json({ error: 'Format de terrain invalide' });
    const montant = await calculerPrixReservation(db, terrain, date, heureDebutNorm, heureFinNorm, formatRow.cle);
    const politiqueSansAvance =
      creePar === 'joueur' &&
      mode === 'paiement' &&
      String(terrain.politique_paiement || 'avance') === 'sans_avance';
    // Bloquer sur place : tout encaissé au match (avance 0). Sans avance : confirmé sans PayTech.
    // Paiement lien : avance calculée.
    const montantAvance = mode === 'bloquer' || politiqueSansAvance ? 0 : calculerMontantAvance(terrain, montant);
    const montantRestant = Math.max(0, montant - montantAvance);
    const delaiVerrouMin = normaliserDelaiVerrouPaiementMin(terrain.delai_verrou_paiement_min);
    const lockMs = delaiVerrouMs(delaiVerrouMin);
    const verrouExpireAt = mode === 'bloquer' || politiqueSansAvance ? null : Date.now() + lockMs;
    const statutInitial = mode === 'bloquer' || politiqueSansAvance ? 'confirme' : 'en_attente';
    // Paiement / manuel : hold en_attente_paiement. Bloquer / sans_avance : on occupe puis on confirme.
    const occupySlot = true;

    // Lier au compte joueur pour que la résa apparaisse dans Mes réservations + push.
    let resolvedJoueurId = null;
    if (creePar === 'joueur' && req.user?.id) {
      resolvedJoueurId = Number(req.user.id);
    } else if (joueurIdBody) {
      const explicit = await queryOne(
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
        const byPhone = await queryOne(
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
      const fullName = String(joueur_nom || '').trim();
      const prenomSaisi = String(joueurPrenomBody || '').trim();
      let prenomStore = prenomSaisi;
      let nomStore = fullName;
      if (prenomSaisi) {
        nomStore = fullName.startsWith(prenomSaisi)
          ? (fullName.slice(prenomSaisi.length).trim() || prenomSaisi)
          : fullName;
      } else {
        const parts = fullName.split(/\s+/).filter(Boolean);
        prenomStore = parts[0] || fullName;
        nomStore = parts.slice(1).join(' ') || fullName;
      }
      const walkinInsert = await runSql(
        db,
        `INSERT INTO users (nom, prenom, email, telephone, role, is_active, telephone_verified)
         VALUES (?, ?, ?, ?, 'joueur', 1, 0)`,
        [nomStore, prenomStore || null, email, telephoneNorm],
      );
      resolvedJoueurId = walkinInsert.lastInsertRowid || null;
    }

    // Transaction ACID : en attente de paiement = créneau verrouillé (indisponible) jusqu'à confirmation / expiration.
    const reservationId = await transaction(db, async () => {
      const creneauId = await lockCreneauxAtomique(db, terrainId, date, heureDebutNorm, heureFinNorm, {
        occupy: occupySlot,
      });
      const insertResult = await runSql(db, `INSERT INTO reservations
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
      return insertResult.lastInsertRowid;
    });

    let reservation = await queryOne(db, `
      SELECT r.*, t.nom as terrain_nom, t.ville as terrain_ville, t.type as terrain_type
      FROM reservations r JOIN terrains t ON t.id = r.terrain_id WHERE r.id = ?
    `, [reservationId]);

    // Code + payload QR dès la création (scan / validation manuelle / WhatsApp)
    if (!reservation.code_reservation) {
      const code = await genererCodeReservation(db);
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
      await runSql(db, 'UPDATE reservations SET code_reservation = ?, qr_code_payload = ? WHERE id = ?', [
        code,
        qrPayload,
        reservation.id,
      ]);
      reservation = { ...reservation, code_reservation: code, qr_code_payload: qrPayload };
    }

    if (mode === 'bloquer' || politiqueSansAvance) {
      await transaction(db, async () => {
        await confirmerCreneauxReservation(db, reservation);
      });
    }

    if (politiqueSansAvance) {
      try {
        const detteService = require('./services/detteCommissionService');
        const { calculerCommissionPrelevee } = require('./pricingService');
        const avanceTheorique = calculerMontantAvance(terrain, montant);
        const commission = calculerCommissionPrelevee(terrain, avanceTheorique);
        const periode = detteService.periodeCivile();
        const delaiJours = Math.max(7, Math.min(90, Number(terrain.delai_paiement_dette_jours) || 30));
        const dateEcheance = detteService.calculerDateEcheance(periode, delaiJours);
        const gerantId = await detteService.resoudreGerantTerrain(db, terrainId);
        if (gerantId) {
          await detteService.enregistrerDetteCommission(db, {
            terrainId,
            gerantId,
            reservationId: reservation.id,
            montantCommission: commission,
            montantAvanceManuelle: 0,
            periode,
            dateEcheance,
            note: 'Réservation sans avance — politique terrain',
            faitPar: resolvedJoueurId || null,
            roleFaitPar: 'joueur',
            detailAudit: `Sans avance. Avance théorique ${avanceTheorique} FCFA → commission ${commission} FCFA`,
          });
        }
        await runSql(
          db,
          "UPDATE reservations SET mode_paiement = 'sans_avance', confirme_at = COALESCE(confirme_at, CURRENT_TIMESTAMP) WHERE id = ?",
          [reservation.id],
        );
        reservation = { ...reservation, mode_paiement: 'sans_avance', sans_avance: true };
        await notificationService.envoyerConfirmationSansAvance(reservation.id).catch((err) => {
          logger.error('index.js', 'WhatsApp confirmation sans avance', err);
        });
      } catch (detteErr) {
        logger.error('index.js', 'Dette commission sans avance', detteErr);
      }
    }

    if (mode === 'paiement' && !politiqueSansAvance) {
      try {
        const payment = await paytechService.creerLienPaiement(reservation);
        await runSql(db, 'UPDATE reservations SET lien_paiement = ?, reference_paytech = ? WHERE id = ?', [
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
        await transaction(db, async () => {
          await libererCreneauxReservation(db, reservation, ['en_attente_paiement']);
          await runSql(db, "UPDATE reservations SET statut = 'annule' WHERE id = ?", [reservation.id]);
        });
        throw error;
      }
    }

    // Notif in-app / push joueur (lien paiement en attente)
    if (resolvedJoueurId && mode === 'paiement' && !politiqueSansAvance) {
      try {
        await runSql(
          db,
          `INSERT INTO notifications (destinataire_type, destinataire_id, type, canal, contenu, lu)
           VALUES ('user', ?, 'paiement', 'app', ?, 0)`,
          [
            resolvedJoueurId,
            `Nouvelle réservation au ${reservation.terrain_nom} le ${date} à ${heureDebutNorm} — avance à payer : ${montantAvance} FCFA`,
          ],
        );
        await pushService.envoyerPush(
          resolvedJoueurId,
          'RESA_EN_ATTENTE',
          {
            corps: `${reservation.terrain_nom} le ${date} à ${heureDebutNorm}. Ouvre Mes réservations pour payer.`,
            url: '/reservations',
            data: { reservation_id: reservation.id },
          },
          'user',
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
          whatsapp_error = require('./whatsappClient').USER_INFRA_ERROR ||
            "Y'a un problème avec WhatsApp. Contactez le développeur immédiatement.";
          logger.error('index.js', 'Envoi lien paiement WhatsApp impossible', error);
        }
      }

      notifyTerrain(terrainId, 'reservation', { date, action: 'created', reservation_id: reservation.id });
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
        verrou_expire_at: verrouExpireAt,
        delai_verrou_paiement_min: delaiVerrouMin,
        whatsapp_sent,
        whatsapp_error,
        lien_paiement: reservation.lien_paiement || null,
      });
    }

    notifyTerrain(terrainId, 'reservation', { date, action: 'created', reservation_id: reservation.id });
    res.status(201).json({
      ...reservation,
      sans_avance: Boolean(politiqueSansAvance),
      mode_paiement: politiqueSansAvance ? 'sans_avance' : reservation.mode_paiement,
      verrou_expire_at: verrouExpireAt,
      delai_verrou_paiement_min: delaiVerrouMin,
    });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
}

app.post('/api/reservations', authMiddleware, requireRole('joueur'), (req, res) => creerReservationAvecPaiement(req, res, 'joueur'));

app.post('/api/reservations/gerant', authMiddleware, requireRole('gerant'), async (req, res) => {
  if (Number(req.body.terrain_id || req.user.terrain_id) !== Number(req.user.terrain_id)) {
    return res.status(403).json({ error: 'Ce terrain ne vous est pas attribué' });
  }
  return creerReservationAvecPaiement(req, res, 'gerant', Number(req.user.terrain_id));
});

app.post('/api/gerant/reservations', authMiddleware, requireRole('gerant'), async (req, res) => {
  if (Number(req.body.terrain_id || req.user.terrain_id) !== Number(req.user.terrain_id)) return res.status(403).json({ error: 'Accès refusé' });
  return creerReservationAvecPaiement(req, res, 'gerant', Number(req.user.terrain_id));
});

app.get('/api/whatsapp/health', async (req, res) => {
  const whatsappClient = require('./whatsappClient');
  if (typeof whatsappClient.getHealth === 'function') {
    return res.json(await whatsappClient.getHealth());
  }
  res.json({
    ok: false,
    message: whatsappClient.USER_INFRA_ERROR || "Y'a un problème avec WhatsApp. Contactez le développeur immédiatement.",
  });
});

/**
 * Envoi interne depuis la session WhatsApp d'un gérant (ou plateforme).
 * Body: { telephone, message, gerant_id?, reservation_id? }
 */
app.post('/api/whatsapp/send-message', authMiddleware, requireRole('gerant', 'super_admin'), async (req, res) => {
  try {
    const whatsappClient = require('./whatsappClient');
    const telephone = req.body?.telephone;
    const message = req.body?.message;
    if (!telephone || !message) {
      return res.status(400).json({ error: 'telephone et message sont requis' });
    }

    let sessionKey = 'platform';
    if (req.user.role === 'gerant') {
      sessionKey = whatsappClient.gerantSessionKey(req.user.id) || 'platform';
    } else if (req.body?.gerant_id) {
      sessionKey = whatsappClient.gerantSessionKey(req.body.gerant_id) || 'platform';
    }

    if (req.body?.reservation_id) {
      const db = await getDb();
      const reservation = await queryOne(
        db,
        `SELECT r.*, e.id AS gerant_id FROM reservations r
         LEFT JOIN employes e ON e.id = r.gerant_id
         WHERE r.id = ?`,
        [Number(req.body.reservation_id)],
      );
      if (reservation?.gerant_id) {
        sessionKey = whatsappClient.gerantSessionKey(reservation.gerant_id) || sessionKey;
      }
    }

    await notificationService.envoyerMessage(telephone, message, sessionKey);
    const st = await whatsappClient.getStatus(sessionKey);
    res.json({
      success: true,
      session: sessionKey,
      status: st.status || (st.connected ? 'CONNECTED' : 'DISCONNECTED'),
      phone: st.phone || null,
    });
  } catch (error) {
    res.status(error.statusCode || 503).json({
      success: false,
      error: error.message || require('./whatsappClient').USER_INFRA_ERROR,
    });
  }
});

app.get('/api/whatsapp/status', async (req, res) => {
  const whatsappClient = require('./whatsappClient');
  if (typeof whatsappClient.getStatus === 'function') {
    return res.json(await whatsappClient.getStatus());
  }
  res.json({
    connected: Boolean(whatsappClient.isReady),
    mock: String(process.env.WHATSAPP_MOCK).toLowerCase() === 'true',
    provider: 'openwa',
  });
});

app.get('/api/whatsapp/qr', async (req, res) => {
  const whatsappClient = require('./whatsappClient');
  if (typeof whatsappClient.ensureStarted === 'function') {
    await whatsappClient.ensureStarted('platform').catch(() => {});
  }
  const payload = typeof whatsappClient.getQrPayload === 'function'
    ? await whatsappClient.getQrPayload()
    : { connected: Boolean(whatsappClient.isReady), mock: false, provider: 'openwa' };
  res.json(payload);
});

app.get('/whatsapp-qr', async (req, res) => {
  const whatsappClient = require('./whatsappClient');
  if (typeof whatsappClient.ensureStarted === 'function') {
    await whatsappClient.ensureStarted('platform').catch(() => {});
  }
  const payload = typeof whatsappClient.getQrPayload === 'function'
    ? await whatsappClient.getQrPayload()
    : { connected: Boolean(whatsappClient.isReady) };
  const status = typeof whatsappClient.getStatus === 'function' ? await whatsappClient.getStatus() : {};
  const img = payload.dataUrl
    ? `<img src="${payload.dataUrl}" alt="QR WhatsApp" width="320" height="320" />`
    : payload.connected
      ? `<p style="color:#0A5C36;font-size:1.25rem">WhatsApp deja connecte (OpenWA)</p>`
      : status.mock
        ? `<p>Mode MOCK actif (WHATSAPP_MOCK=true)</p>`
        : `<p>En attente du QR OpenWA… rafraîchissement auto</p><script>setTimeout(()=>location.reload(),2500)</script>`;
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
<p style="font-size:.8rem;color:#888">Via OpenWA · ${process.env.OPENWA_BASE_URL || 'https://mywa.tickets-place.net'}</p>
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
    res.status(503).json({ error: require('./whatsappClient').USER_INFRA_ERROR });
  }
});

app.post('/api/reservations/:id/renvoyer-lien', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const reservation = await queryOne(db, 'SELECT id FROM reservations WHERE id = ? AND terrain_id = ? AND statut = ?', [Number(req.params.id), req.user.terrain_id, 'en_attente']);
    if (!reservation) return res.status(404).json({ error: 'Réservation en attente introuvable pour ce terrain' });
    await notificationService.envoyerLienPaiement(reservation.id);
    res.json({ message: 'Lien WhatsApp renvoyé' });
  } catch (error) {
    console.error('Renvoi WhatsApp:', error);
    res.status(503).json({ error: require('./whatsappClient').USER_INFRA_ERROR });
  }
});

/** Renvoi confirmation + QR au joueur (sans re-notifier le gérant) */
app.post('/api/reservations/:id(\\d+)/renvoyer-confirmation', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const reservation = await queryOne(
      db,
      `SELECT id, statut, code_reservation, joueur_telephone, terrain_id
       FROM reservations WHERE id = ?`,
      [Number(req.params.id)],
    );
    if (!reservation) return res.status(404).json({ error: 'Réservation introuvable' });
    if (!verifierTerrainGerant(reservation.terrain_id, req)) {
      return res.status(403).json({ error: 'Réservation hors de votre terrain' });
    }
    if (reservation.statut !== 'confirme' && reservation.statut !== 'acceptee') {
      return res.status(400).json({
        error: `La réservation doit être confirmée (statut actuel: ${reservation.statut})`,
      });
    }
    if (!reservation.code_reservation) {
      return res.status(400).json({ error: 'Pas de code_reservation — impossible de générer le QR' });
    }
    if (!reservation.joueur_telephone) {
      return res.status(400).json({ error: 'Aucun numéro WhatsApp joueur sur cette réservation' });
    }
    // Renvoi joueur uniquement (pas de notif « paiement reçu » au gérant)
    await notificationService.envoyerConfirmationManuelle(reservation.id);
    res.json({
      ok: true,
      reservation_id: reservation.id,
      code_reservation: reservation.code_reservation,
      telephone: reservation.joueur_telephone,
      message: 'Confirmation WhatsApp + QR envoyés',
    });
  } catch (error) {
    console.error('Renvoi confirmation WhatsApp:', error);
    const msg = error?.message || require('./whatsappClient').USER_INFRA_ERROR;
    res.status(error?.statusCode || 503).json({ error: msg });
  }
});

// Recharger une réservation (utile pour refresh / accès direct)
app.get('/api/reservations/:id(\\d+)', optionalAuth, async (req, res) => {
  try {
    const db = await getDb();
    const reservation = await queryOne(db, `
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
    const reservation = await queryOne(
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
    const reservations = await queryAll(db, `
      SELECT r.*, t.nom as terrain_nom, t.ville as terrain_ville, t.type as terrain_type, t.prix_heure,
             t.delai_remboursement_heures
      FROM reservations r JOIN terrains t ON t.id = r.terrain_id
      WHERE r.joueur_id = ?
        AND r.statut <> 'expire'
      ORDER BY r.created_at DESC
    `, [req.user.id]);
    res.json(
      reservations.map((row) => ({
        ...row,
        politique_remboursement: evaluerRemboursement({
          terrain: { delai_remboursement_heures: row.delai_remboursement_heures },
          reservation: row,
        }),
      })),
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** Aperçu politique d'annulation (avec / sans remboursement) avant confirmation. */
app.get('/api/reservations/:id(\\d+)/politique-annulation', optionalAuth, async (req, res) => {
  try {
    const db = await getDb();
    let reservation;
    const isGerantSide = Boolean(req.user?.terrain_id) && (
      req.user?.role === 'gerant' ||
      req.user?.accountType === 'employe' ||
      req.user?.role === 'employe'
    );
    if (isGerantSide) {
      reservation = await queryOne(
        db,
        `SELECT r.*, t.delai_remboursement_heures
         FROM reservations r JOIN terrains t ON t.id = r.terrain_id
         WHERE r.id = ? AND r.terrain_id = ?`,
        [Number(req.params.id), req.user.terrain_id],
      );
    } else if (req.user) {
      reservation = await queryOne(
        db,
        `SELECT r.*, t.delai_remboursement_heures
         FROM reservations r JOIN terrains t ON t.id = r.terrain_id
         WHERE r.id = ? AND r.joueur_id = ?`,
        [Number(req.params.id), req.user.id],
      );
    } else {
      reservation = await queryOne(
        db,
        `SELECT r.*, t.delai_remboursement_heures
         FROM reservations r JOIN terrains t ON t.id = r.terrain_id
         WHERE r.id = ?`,
        [Number(req.params.id)],
      );
    }
    if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });
    const payment = await queryOne(
      db,
      `SELECT created_at FROM paiements WHERE reservation_id = ? AND statut = 'paye' ORDER BY id DESC LIMIT 1`,
      [reservation.id],
    );
    const politique = evaluerRemboursement({
      terrain: { delai_remboursement_heures: reservation.delai_remboursement_heures },
      reservation,
      confirmeAt: reservation.confirme_at || payment?.created_at,
    });
    res.json({
      reservation_id: reservation.id,
      statut: reservation.statut,
      politique_remboursement: politique,
    });
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
      reservation = await queryOne(db, 'SELECT * FROM reservations WHERE id = ? AND joueur_id = ?', [Number(req.params.id), req.user.id]);
    } else {
      reservation = await queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [Number(req.params.id)]);
    }
    if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });
    if (!['en_attente', 'confirme', 'acceptee'].includes(reservation.statut)) {
      return res.status(400).json({ error: 'Réservation ne peut pas être annulée' });
    }
    const result = await executerAnnulation(db, reservation);
    notifyTerrain(reservation.terrain_id, 'reservation', {
      date: reservation.date,
      action: 'cancelled',
      reservation_id: reservation.id,
    });
    res.json({
      message: result.rembourse ? 'Réservation annulée — remboursement lancé' : 'Réservation annulée',
      rembourse: result.rembourse,
      politique: result.politique,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.patch('/api/gerant/reservations/:id/annuler', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const reservation = await queryOne(db, 'SELECT * FROM reservations WHERE id = ? AND terrain_id = ?', [Number(req.params.id), req.user.terrain_id]);
    if (!reservation) return res.status(404).json({ error: 'Reservation non trouvee pour ce terrain' });
    if (!['en_attente', 'confirme', 'acceptee'].includes(reservation.statut)) {
      return res.status(400).json({ error: 'Reservation ne peut pas etre annulee' });
    }
    const result = await executerAnnulation(db, reservation, { traitePar: req.user.id });
    notifyTerrain(reservation.terrain_id, 'reservation', {
      date: reservation.date,
      action: 'cancelled',
      reservation_id: reservation.id,
    });
    await logActivite({
      gerant_id: req.user.id,
      terrain_id: reservation.terrain_id,
      action: 'reservation_annulee',
      reservation_id: reservation.id,
      details: { statut_avant: reservation.statut, rembourse: result.rembourse },
    }).catch((error) => logger.error('index.js', 'Log activite reservation_annulee', error));
    await scoreService.recalculerScore(req.user.id, reservation.terrain_id).catch((error) => logger.error('index.js', 'Recalcul score annulation', error));
    res.json({
      message: result.rembourse ? 'Reservation annulee — remboursement lance' : 'Reservation annulee',
      rembourse: result.rembourse,
      politique: result.politique,
    });
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
    const reservation = await queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [Number(req.params.id)]);
    if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });
    await transaction(db, async () => {
      await runSql(db, "UPDATE reservations SET statut = 'annule', traite_par = ? WHERE id = ? AND statut IN ('en_attente', 'confirme', 'acceptee')", [req.user.id, reservation.id]);
      await libererCreneauxReservation(db, reservation, ['en_attente_paiement', 'reserve']);
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
    const reservations = await queryAll(db, `
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
    res.json(await computeOwnerDashboard(db, req.user.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/proprietaire/profile', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const propId = req.user.id;
    const account = await queryOne(db, `SELECT id, nom, email, telephone, plan, statut, created_at
      FROM proprietaires WHERE id = ?`, [propId]);
    if (!account) return res.status(404).json({ error: 'Profil proprietaire introuvable' });

    const terrains = await queryAll(db, `SELECT id, nom, ville, adresse, type, is_active, modele_revenus,
      pourcentage_avance, commission_pourcentage, abonnement_montant, achat_definitif_montant, achat_definitif_paye
      FROM terrains WHERE proprietaire_id = ? ORDER BY created_at DESC`, [propId]);
    const revenueRows = await queryAll(db, ownerRevenueRowsSql({ ownerWhere: 't.proprietaire_id = ?', dateWhere: '' }), [propId]);
    const revenue = summarizeOwnerRevenue(revenueRows);
    const pendingReservations = (await queryOne(db, `SELECT COUNT(*) AS total
      FROM reservations r
      JOIN terrains t ON t.id = r.terrain_id
      WHERE t.proprietaire_id = ? AND r.statut = 'en_attente'`, [propId])).total;
    const playedMatches = await queryAll(db, `SELECT r.id, r.joueur_nom, r.date, r.heure_debut, r.heure_fin,
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
    const terrains = await queryAll(db, `
      SELECT t.*, COALESCE(ROUND(AVG(a.note), 1), 0) as note, COUNT(a.id) as avis_count
      FROM terrains t LEFT JOIN avis a ON a.terrain_id = t.id
      WHERE t.proprietaire_id = ? GROUP BY t.id
    `, [req.user.id]);
    res.json(await attachPhotosToTerrains(db, terrains));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/proprietaire/reservations', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const reservations = await queryAll(db, `
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

/** Confirmation manuelle d'une avance en attente (espèces / hors PayTech) par le propriétaire. */
app.post('/api/proprietaire/reservations/:id/confirmer-avance', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const reservationId = Number(req.params.id);
    const reservation = await queryOne(db, `
      SELECT r.*, t.proprietaire_id,
             t.acompte AS terrain_acompte, t.montant_acompte AS terrain_montant_acompte,
             t.commission, t.pourcentage_avance, t.modele_revenus, t.commission_pourcentage
      FROM reservations r
      JOIN terrains t ON t.id = r.terrain_id
      WHERE r.id = ? AND t.proprietaire_id = ?
    `, [reservationId, req.user.id]);
    if (!reservation) return res.status(404).json({ error: 'Réservation introuvable' });
    if (reservation.statut !== 'en_attente') {
      return res.status(400).json({ error: "Cette réservation n'est plus en attente d'avance" });
    }

    const { calculerCommissionPrelevee } = require('./pricingService');
    const { crediterPortefeuilleGerant } = require('./services/portefeuilleService');

    let confirmOk = false;
    await transaction(db, async () => {
      const current = await queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
      if (!current || current.statut !== 'en_attente') return;

      await runSql(db, 
        "UPDATE reservations SET statut = 'confirme', confirme_at = COALESCE(confirme_at, CURRENT_TIMESTAMP) WHERE id = ? AND statut = 'en_attente'",
        [reservationId],
      );
      if (rowsModified(db) !== 1) return;

      const confirmedCount = await confirmerCreneauxReservation(db, current);
      if (confirmedCount < 1) {
        await runSql(db, "UPDATE reservations SET statut = 'en_attente' WHERE id = ?", [reservationId]);
        return;
      }

      await annulerReservationsConcurrentes(db, { ...current, id: reservationId });

      const montantAvance = Number(
        current.montant_avance || current.acompte || calculerMontantAvance(reservation, current.prix_total || current.montant),
      );
      const montantCommission = calculerCommissionPrelevee(reservation, montantAvance);
      const montantReverse = Math.max(0, montantAvance - montantCommission);
      const code = current.code_reservation || await genererCodeReservation(db);
      const retardRow = current.creneau_id
        ? await queryOne(db, 'SELECT fenetre_retard FROM creneaux WHERE id = ?', [current.creneau_id])
        : null;
      const fenetre = calculerFenetreCheckIn({
        date: current.date,
        heure_debut: current.heure_debut,
        heure_fin: current.heure_fin,
        fenetre_retard: retardRow?.fenetre_retard,
      });
      const qrPayload = serializeQrPayload({
        reservation_id: reservationId,
        code,
        creneau_id: current.creneau_id,
        terrain_id: current.terrain_id,
        expire_at: Math.floor(fenetre.finFenetre / 1000),
      });

      await runSql(db, 
        `UPDATE reservations SET code_reservation = ?, qr_code_payload = ?, acompte = ?, montant_avance = ?,
          reste_a_payer = GREATEST(0, COALESCE(prix_total, montant, 0) - ?),
          montant_restant = GREATEST(0, COALESCE(prix_total, montant, 0) - ?)
         WHERE id = ?`,
        [code, qrPayload, montantAvance, montantAvance, montantAvance, montantAvance, reservationId],
      );

      const ref = `MANUEL-OWNER-${reservationId}-${Date.now()}`;
      await runSql(db, 
        `INSERT INTO paiements
          (reservation_id, montant, methode, statut, reference_externe, montant_acompte, montant_commission, montant_reverse, statut_reversement)
          VALUES (?, ?, 'manuel', 'paye', ?, ?, ?, ?, 'en_attente')`,
        [reservationId, montantAvance, ref, montantAvance, montantCommission, montantReverse],
      );

      const gerant = await queryOne(db, 'SELECT id FROM employes WHERE terrain_id = ? AND is_active = 1 ORDER BY id ASC LIMIT 1', [current.terrain_id]);
      if (gerant?.id) {
        await crediterPortefeuilleGerant(db, {
          gerantId: gerant.id,
          terrainId: current.terrain_id,
          reservationId,
          montantEncaisse: montantAvance,
          montantCommission,
        });
      }
      confirmOk = true;
    });

    if (!confirmOk) {
      return res.status(409).json({ error: 'Confirmation impossible (créneau indisponible)' });
    }

    notifyTerrain(reservation.terrain_id, 'reservation', {
      date: reservation.date,
      action: 'confirmed',
      reservation_id: reservationId,
      source: 'owner_manual',
    });
    notifyTerrain(reservation.terrain_id, 'sante', { action: 'avance_confirmee', reservation_id: reservationId });

    await notificationService.envoyerConfirmation(reservationId).catch((error) => {
      logger.error('index.js', 'Notif confirmation avance proprio', error);
    });

    const updated = await queryOne(db, `
      SELECT r.*, t.nom as terrain_nom
      FROM reservations r JOIN terrains t ON t.id = r.terrain_id
      WHERE r.id = ?
    `, [reservationId]);
    res.json({ ok: true, reservation: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.get('/api/proprietaire/sante/:terrain_id', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = Number(req.params.terrain_id);
    const terrain = await queryOne(db, 'SELECT id FROM terrains WHERE id = ? AND proprietaire_id = ?', [terrainId, req.user.id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
    const featuresService = require('./services/terrainFeaturesService');
    const features = await featuresService.featuresFlags(db, terrainId);
    const sante = await scoreService.getSanteTerrain(db, terrainId);
    res.json({
      ...sante,
      features,
      score_sante_enabled: featuresService.isFeatureEnabled(features, 'score_sante', true),
    });
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
    const employes = await queryAll(db, `
      SELECT e.*, t.nom as terrain_nom,
        (SELECT MAX(a.created_at) FROM activite_gerant a WHERE a.gerant_id = e.id) AS derniere_activite
      FROM employes e
      LEFT JOIN terrains t ON t.id = e.terrain_id
      WHERE e.proprietaire_id = ?
      ORDER BY e.nom ASC
    `, [req.user.id]);
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
    const result = await runSql(db, 'INSERT INTO employes (proprietaire_id, terrain_id, nom, email, password_hash, telephone, whatsapp_number) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, terrain_id || null, nom, email, password_hash, telephone, whatsapp_number]);

    if (terrain_id) {
      const hasPrincipal = await queryOne(db, `
        SELECT id FROM gerants_terrains WHERE terrain_id = ? AND est_principal = 1 AND actif = 1
      `, [Number(terrain_id)]);
      await runSql(db, `INSERT INTO gerants_terrains
        (gerant_id, terrain_id, est_principal, actif, date_debut, note)
        VALUES (?, ?, ?, 1, CURRENT_DATE, 'Création par propriétaire')
        ON CONFLICT (gerant_id, terrain_id) DO NOTHING`,
        [result.lastInsertRowid, Number(terrain_id), hasPrincipal ? 0 : 1]);
    }

    const employe = await queryOne(db, 'SELECT e.*, t.nom as terrain_nom FROM employes e LEFT JOIN terrains t ON t.id = e.terrain_id WHERE e.id = ?', [result.lastInsertRowid]);
    res.status(201).json(employe);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/employes/:id', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  try {
    const db = await getDb();
    const emp = await queryOne(db, 'SELECT * FROM employes WHERE id = ? AND proprietaire_id = ?', [Number(req.params.id), req.user.id]);
    if (!emp) return res.status(404).json({ error: 'Employé non trouvé' });
    await runSql(db, 'DELETE FROM employes WHERE id = ?', [emp.id]);
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
    const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
    
    // Fenêtre large pour calendrier / anti-conflit UI (pas LIMIT 20 qui masquait des résas)
    const reservations = await queryAll(db, `
      SELECT r.*, COALESCE(r.joueur_nom, u.nom) as joueur_nom, COALESCE(r.joueur_telephone, u.telephone) as joueur_telephone
      FROM reservations r LEFT JOIN users u ON u.id = r.joueur_id
      WHERE r.terrain_id = ?
        AND r.date >= CURRENT_DATE - INTERVAL '7 days'
        AND r.date <= CURRENT_DATE + INTERVAL '60 days'
        AND r.statut IN ('en_attente', 'confirme', 'acceptee', 'joue', 'match_joue')
      ORDER BY r.date ASC, r.heure_debut ASC
    `, [terrainId]);

    const horaires = await queryAll(db, "SELECT * FROM horaires WHERE terrain_id = ? ORDER BY CASE jour WHEN 'lundi' THEN 1 WHEN 'mardi' THEN 2 WHEN 'mercredi' THEN 3 WHEN 'jeudi' THEN 4 WHEN 'vendredi' THEN 5 WHEN 'samedi' THEN 6 WHEN 'dimanche' THEN 7 END", [terrainId]);
    const blocages = await queryAll(db, 'SELECT * FROM blocages_creneaux WHERE terrain_id = ? ORDER BY date DESC', [terrainId]);
    const pendingCount = await queryOne(db, "SELECT COUNT(*) as count FROM reservations WHERE terrain_id = ? AND statut = 'en_attente'", [terrainId]);
    const monthCount = await queryOne(db, "SELECT COUNT(*) as count FROM reservations WHERE terrain_id = ?", [terrainId]);
    const featuresService = require('./services/terrainFeaturesService');
    const features = await featuresService.featuresFlags(db, terrainId);

    res.json({
      terrain,
      reservations,
      horaires,
      blocages,
      pendingCount: pendingCount.count,
      monthReservations: monthCount.count,
      features,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** Créneaux du jour pour la file gérant (journée complète, heures passées incluses). */
app.get('/api/gerant/disponibilites', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = req.user.terrain_id;
    if (!terrainId) return res.status(400).json({ error: 'Aucun terrain associé à ce gérant' });

    const dateParam = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
    const dureeParam = req.query.duree_minutes != null ? Number(req.query.duree_minutes) : null;

    const payload = await creneauService.getDisponibilitesPourJoueur(db, terrainId, dateStr, {
      duree_minutes: Number.isFinite(dureeParam) && dureeParam > 0 ? dureeParam : null,
      inclure_passes: true,
    });

    res.json({
      date: dateStr,
      terrain_id: terrainId,
      ...payload,
      heure_serveur: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
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
      const existing = await queryOne(db, 'SELECT id FROM horaires WHERE terrain_id = ? AND jour = ?', [
        terrainId,
        h.jour,
      ]);
      if (existing) {
        await runSql(
          db,
          'UPDATE horaires SET heure_debut = ?, heure_fin = ?, est_ouvert = ? WHERE terrain_id = ? AND jour = ?',
          [h.heure_debut, h.heure_fin, h.est_ouvert ? 1 : 0, terrainId, h.jour],
        );
      } else {
        await runSql(
          db,
          'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, ?)',
          [terrainId, h.jour, h.heure_debut, h.heure_fin, h.est_ouvert ? 1 : 0],
        );
      }
    }
    notifyTerrain(terrainId, 'horaires');
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
    const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ? AND proprietaire_id = ?', [
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
      const existing = await queryOne(db, 'SELECT id FROM horaires WHERE terrain_id = ? AND jour = ?', [terrain.id, h.jour]);
      if (existing) {
        await runSql(db, 'UPDATE horaires SET heure_debut = ?, heure_fin = ?, est_ouvert = ? WHERE terrain_id = ? AND jour = ?',
          [h.heure_debut, h.heure_fin, h.est_ouvert ? 1 : 0, terrain.id, h.jour]);
      } else {
        await runSql(db, 'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, ?)',
          [terrain.id, h.jour, h.heure_debut, h.heure_fin, h.est_ouvert ? 1 : 0]);
      }
    }
    res.json({ message: 'Horaires mis à jour' });
    notifyTerrain(terrain.id, 'horaires');
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
    const chevauchementResa = await queryAll(
      db,
      `SELECT id, joueur_nom, heure_debut, heure_fin FROM reservations
        WHERE terrain_id = ? AND date = ?
          AND statut IN ('confirme', 'acceptee')
          AND heure_debut < ? AND heure_fin > ?`,
      [terrainId, date, heure_fin, heure_debut],
    );
    if (chevauchementResa.length) {
      return res.status(409).json({
        error: 'Impossible de bloquer : une réservation existe déjà sur ce créneau',
        code: 'CRENEAU_CONFLIT',
      });
    }

    const chevauchementBlocage = await queryAll(
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

    const result = await insertSlot(db, {
      terrain_id: terrainId,
      employe_id: req.user.id,
      date,
      heure_debut,
      heure_fin,
      motif: motif || null,
      type_blocage: 'MANUEL',
    });
    if (!result.ok) {
      return res.status(409).json({
        error: result.error === 'Réservation existante'
          ? 'Impossible de bloquer : une réservation existe déjà sur ce créneau'
          : result.error || 'Ce créneau est déjà bloqué',
        code: 'CRENEAU_CONFLIT',
      });
    }
    for (const loserId of result.loserIds || []) {
      notificationService.envoyerCreneauPris(loserId).catch((error) => {
        logger.error('index.js', 'WhatsApp créneau pris (blocage)', error);
      });
    }
    notifyTerrain(terrainId, 'blocage', { date, action: 'created' });
    res.status(201).json(result.blocage);
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

      const result = await insertSlot(db, {
        terrain_id: terrainId,
        employe_id: req.user.id,
        date,
        heure_debut,
        heure_fin,
        motif,
        type_blocage: 'MANUEL',
      });
      if (!result.ok) {
        errors.push({ heure_debut, error: result.error || 'Créneau non bloqué' });
        continue;
      }
      if (result.blocage) created.push(result.blocage);
      for (const loserId of result.loserIds || []) {
        notificationService.envoyerCreneauPris(loserId).catch((error) => {
          logger.error('index.js', 'WhatsApp créneau pris (blocage batch)', error);
        });
      }
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
    notifyTerrain(terrainId, 'blocage', { date, action: 'created', count: created.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/gerant/blocages/:id', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const terrainId = req.user.terrain_id;
    const blocage = await queryOne(db, 'SELECT * FROM blocages_creneaux WHERE id = ? AND terrain_id = ?', [
      Number(req.params.id),
      terrainId,
    ]);
    if (!blocage) return res.status(404).json({ error: 'Blocage introuvable' });

    await runSql(db, 'DELETE FROM blocages_creneaux WHERE id = ? AND terrain_id = ?', [
      Number(req.params.id),
      terrainId,
    ]);
    await runSql(
      db,
      `UPDATE creneaux SET statut = 'libre'
        WHERE terrain_id = ? AND date = ?
          AND heure_debut >= ? AND heure_debut < ?
          AND statut = 'bloque'`,
      [terrainId, blocage.date, blocage.heure_debut, blocage.heure_fin],
    );
    res.json({ message: 'Créneau débloqué' });
    notifyTerrain(terrainId, 'blocage', { date: blocage.date, action: 'deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/gerant/blocages/debloquer', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const result = await deleteMany(db, req.user.terrain_id, ids);
    if (!result.count) return res.status(404).json({ error: 'Aucun créneau à débloquer' });
    notifyTerrain(req.user.terrain_id, 'blocage', { action: 'deleted', count: result.count });
    res.json({ message: `${result.count} créneau(x) débloqué(s)`, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

function notifyBlocageLosers(loserIds, context) {
  for (const loserId of loserIds || []) {
    notificationService.envoyerCreneauPris(loserId).catch((error) => {
      logger.error('index.js', `WhatsApp créneau pris (${context})`, error);
    });
  }
}

app.post('/api/gerant/blocages/abonnement', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const featuresService = require('./services/terrainFeaturesService');
    const flags = await featuresService.featuresFlags(db, req.user.terrain_id);
    if (!featuresService.isFeatureEnabled(flags, 'abonnements', false)) {
      return res.status(403).json({
        error: 'Les abonnements sont désactivés pour ce terrain.',
        code: 'FEATURE_DISABLED',
      });
    }
    const result = await createPeriode(db, {
      ...req.body,
      terrain_id: req.user.terrain_id,
      employe_id: req.user.id,
      type_blocage: 'ABONNEMENT',
      montant: req.body?.montant_mensuel_abonnement ?? req.body?.montant,
    });
    notifyBlocageLosers(result.loserIds, 'abonnement');
    notifyTerrain(req.user.terrain_id, 'blocage', { action: 'abonnement' });
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Erreur serveur',
      code: err.code,
      errors: err.errors,
    });
  }
});

app.post('/api/gerant/blocages/tournoi', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const featuresService = require('./services/terrainFeaturesService');
    const flags = await featuresService.featuresFlags(db, req.user.terrain_id);
    if (!featuresService.isFeatureEnabled(flags, 'tournois', true)) {
      return res.status(403).json({
        error: 'Les tournois sont désactivés pour ce terrain.',
        code: 'FEATURE_DISABLED',
      });
    }
    const result = await createPeriode(db, {
      ...req.body,
      terrain_id: req.user.terrain_id,
      employe_id: req.user.id,
      type_blocage: 'TOURNOI',
      montant: req.body?.montant_tournoi ?? req.body?.montant,
    });
    notifyBlocageLosers(result.loserIds, 'tournoi');
    notifyTerrain(req.user.terrain_id, 'blocage', { action: 'tournoi' });
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Erreur serveur',
      code: err.code,
      errors: err.errors,
    });
  }
});

app.get('/api/gerant/blocages/groupes', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const type = req.query.type === 'ABONNEMENT' || req.query.type === 'TOURNOI' ? req.query.type : undefined;
    res.json({ groupes: await listGroupes(db, req.user.terrain_id, { type }) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/gerant/blocages/groupes/:id', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    res.json({ groupe: await getGroupe(db, req.user.terrain_id, req.params.id) });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.post('/api/gerant/blocages/groupes/:id/encaisser', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const result = await encaisserGroupe(db, req.user.terrain_id, req.params.id, req.body, req.user.id);
    notifyTerrain(req.user.terrain_id, 'encaissement', {
      action: 'blocage',
      groupe_id: req.params.id,
    });
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

app.delete('/api/gerant/blocages/groupes/:id', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const result = await deleteGroupe(db, req.user.terrain_id, req.params.id);
    notifyTerrain(req.user.terrain_id, 'blocage', { action: 'deleted', groupe_id: req.params.id });
    res.json({ message: `${result.count} créneau(x) débloqué(s)`, ...result });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
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
    const result = await runSql(db, 'INSERT INTO avis (reservation_id, joueur_id, terrain_id, note, commentaire) VALUES (?, ?, ?, ?, ?)',
      [reservation_id || null, joueur_id, terrain_id, note, commentaire]);
    const avis = await queryOne(db, 'SELECT a.*, COALESCE(u.nom, "Joueur anonyme") as joueur_nom FROM avis a LEFT JOIN users u ON u.id = a.joueur_id WHERE a.id = ?', [result.lastInsertRowid]);
    res.status(201).json(avis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/avis/terrain/:terrainId', async (req, res) => {
  try {
    const db = await getDb();
    const avis = await queryAll(db, 'SELECT a.*, u.nom as joueur_nom FROM avis a JOIN users u ON u.id = a.joueur_id WHERE a.terrain_id = ? ORDER BY a.created_at DESC', [Number(req.params.terrainId)]);
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
    const notifs = await queryAll(db, 'SELECT * FROM notifications WHERE destinataire_type = ? AND destinataire_id = ? ORDER BY created_at DESC', [destType, req.user.id]);
    res.json(notifs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/notifications/:id/lire', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    await runSql(db, 'UPDATE notifications SET lu = 1 WHERE id = ?', [Number(req.params.id)]);
    res.json({ message: 'Notification lue' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// WEB PUSH
// ============================================================
function pushActor(req) {
  return {
    userId: req.user.id,
    accountType: pushService.accountTypeFromUser(req.user),
  };
}

app.get('/api/push/vapid-public-key', (req, res) => {
  const publicKey = pushService.getPublicKey();
  if (!publicKey) {
    return res.status(503).json({ error: 'Web Push non configuré sur ce serveur' });
  }
  res.json({ publicKey });
});
app.get('/api/push/vapid-key', (req, res) => {
  const publicKey = pushService.getPublicKey();
  if (!publicKey) {
    return res.status(503).json({ error: 'Web Push non configuré sur ce serveur' });
  }
  res.json({ publicKey });
});

app.get('/api/push/preferences', authMiddleware, async (req, res) => {
  try {
    const { userId, accountType } = pushActor(req);
    const prefs = await pushService.getPreferences(userId, accountType, { withPolicy: true });
    res.json(prefs);
  } catch (err) {
    logger.error('index.js', 'GET push preferences', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

async function savePushPreferences(req, res) {
  try {
    const { userId, accountType } = pushActor(req);
    await pushService.updatePreferences(userId, req.body || {}, accountType);
    const prefs = await pushService.getPreferences(userId, accountType, { withPolicy: true });
    res.json(prefs);
  } catch (err) {
    logger.error('index.js', 'save push preferences', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
}
app.put('/api/push/preferences', authMiddleware, savePushPreferences);
app.patch('/api/push/preferences', authMiddleware, savePushPreferences);

app.post('/api/push/subscribe', authMiddleware, async (req, res) => {
  try {
    const raw = req.body?.subscription || req.body || {};
    if (!raw.endpoint && !raw.keys) {
      return res.status(400).json({ error: 'Subscription manquante' });
    }
    const { userId, accountType } = pushActor(req);
    await pushService.upsertSubscription(userId, raw, req.headers['user-agent'] || '', accountType);
    res.json({ message: 'Abonnement push enregistré' });
  } catch (err) {
    logger.error('index.js', 'POST push subscribe', err);
    res.status(400).json({ error: err.message || 'Erreur abonnement push' });
  }
});

app.delete('/api/push/unsubscribe', authMiddleware, async (req, res) => {
  try {
    const endpoint = req.body?.endpoint;
    if (!endpoint) return res.status(400).json({ error: 'Endpoint manquant' });
    const { userId, accountType } = pushActor(req);
    await pushService.removeSubscription(userId, endpoint, accountType);
    res.json({ message: 'Désabonnement effectué' });
  } catch (err) {
    logger.error('index.js', 'DELETE push unsubscribe', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/push/logs', authMiddleware, requireRole('super_admin'), async (req, res) => {
  try {
    const logs = await pushService.listPushLogs({
      userId: req.query.user_id,
      type: req.query.type,
      statut: req.query.statut,
      depuis: req.query.depuis,
      jusqua: req.query.jusqua,
      limit: req.query.limit,
    });
    res.json(logs);
  } catch (err) {
    logger.error('index.js', 'GET push logs', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// SUPER ADMIN
// ============================================================
app.get('/api/admin/stats', authMiddleware, requireRole('super_admin'), async (req, res) => {
  try {
    const db = await getDb();
    const totalTerrains = await queryOne(db, 'SELECT COUNT(*) as count FROM terrains');
    const totalUsers = await queryOne(db, "SELECT COUNT(*) as count FROM users WHERE role = 'joueur'");
    const totalProprietaires = await queryOne(db, 'SELECT COUNT(*) as count FROM proprietaires');
    const totalReservations = await queryOne(db, 'SELECT COUNT(*) as count FROM reservations');
    const totalRevenue = await queryOne(db, "SELECT COALESCE(SUM(prix_total), 0) as total FROM reservations WHERE statut = 'joue'");
    const proprietaires = await queryAll(db, 'SELECT id, nom, email, telephone, plan, statut, created_at FROM proprietaires ORDER BY created_at DESC');
    
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
    await runSql(db, 'UPDATE proprietaires SET statut = ? WHERE id = ?', [statut, Number(req.params.id)]);
    res.json({ message: 'Propriétaire mis à jour' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/admin/audit', authMiddleware, requireRole('super_admin'), async (req, res) => {
  try {
    const db = await getDb();
    const logs = await queryAll(db, 'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100');
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
    const account = await selectProfileAccount(db, req.user);
    if (!account) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const role = req.user.role === 'superadmin' ? 'super_admin' : req.user.role;
    const name = splitDisplayName(account);
    const computed = await buildProfileStats(db, { ...req.user, role });

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
    const account = await selectProfileAccount(db, req.user);
    if (!account) return res.status(404).json({ error: 'Profil joueur introuvable' });

    const reservationsTotales = await queryOne(db, 'SELECT COUNT(*) AS total FROM reservations WHERE joueur_id = ?', [req.user.id]) || { total: 0 };
    const matchsJoues = await queryOne(db, `SELECT COUNT(*) AS total FROM reservations
      WHERE joueur_id = ? AND ${playedStatusSql('reservations')}`, [req.user.id]) || { total: 0 };
    const terrainPrefere = await queryOne(db, `SELECT t.nom, COUNT(*) AS total
      FROM reservations r
      JOIN terrains t ON t.id = r.terrain_id
      WHERE r.joueur_id = ?
      GROUP BY t.id, t.nom
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
    const account = await selectProfileAccount(db, req.user);
    if (!account) return res.status(404).json({ error: 'Profil gerant introuvable' });

    const terrain = await queryOne(db, 'SELECT id, nom, adresse, ville FROM terrains WHERE id = ?', [req.user.terrain_id]);
    const from = currentMonthStart();
    const matchs = await queryOne(db, `SELECT COUNT(*) AS total FROM matchs
      WHERE gerant_id = ? AND date(joue_at) >= date(?)`, [req.user.id, from]) || { total: 0 };
    const creneaux = await queryOne(db, `SELECT COUNT(*) AS total FROM creneaux
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
    const account = await selectProfileAccount(db, req.user);
    if (!account) return res.status(404).json({ error: 'Profil proprietaire introuvable' });

    const terrains = await queryAll(db, `SELECT id, nom, adresse, ville, type, is_active
      FROM terrains WHERE proprietaire_id = ?
      ORDER BY nom ASC`, [req.user.id]);
    const from = currentMonthStart();
    const terrainIds = terrains.map((terrain) => Number(terrain.id));
    let matchs = { total: 0 };
    if (terrainIds.length) {
      const placeholders = terrainIds.map(() => '?').join(',');
      matchs = await queryOne(db, `SELECT COUNT(*) AS total FROM matchs
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
    const account = await selectProfileAccount(db, req.user);
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

    await runSql(db, `UPDATE ${table}
      SET prenom = ?, nom = ?, quartier = ?, date_naissance = ?, bio = ?
      WHERE id = ?`, [prenom, nom, quartier, dateNaissance, bio, req.user.id]);

    const account = await selectProfileAccount(db, req.user);
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
    await runSql(db, `UPDATE ${table} SET photo_url = ? WHERE id = ?`, [photoUrl, req.user.id]);
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
    await runSql(db, `UPDATE ${table} SET photo_url = ? WHERE id = ?`, [photoUrl, req.user.id]);
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
    const account = await queryOne(db, `SELECT password_hash FROM ${table} WHERE id = ?`, [req.user.id]);
    if (!account) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const role = req.user.role === 'superadmin' ? 'super_admin' : req.user.role;
    if (role === 'super_admin' && !bcrypt.compareSync(String(old_password || ''), account.password_hash || '')) {
      return res.status(400).json({ error: 'Ancien mot de passe incorrect' });
    }

    const hash = bcrypt.hashSync(new_password, 12);
    await runSql(db, `UPDATE ${table} SET password_hash = ?, must_change_password = 0 WHERE id = ?`, [hash, req.user.id]);
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
    await runSql(db, `UPDATE users SET prenom = ?, nom = ?, quartier = ?, date_naissance = ? WHERE id = ?`,
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
    const duplicate = await queryOne(db, 'SELECT id FROM users WHERE email = ? AND id != ?', [email, req.user.id]);
    if (duplicate) return res.status(409).json({ error: 'Email deja utilise' });
    await runSql(db, 'UPDATE users SET prenom = ?, nom = ?, email = ? WHERE id = ?', [prenom, nom, email, req.user.id]);
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

// Middleware d’erreurs non gérées (alertes dev)
app.use(bugAlertService.expressErrorMiddleware);

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
      const rows = await queryAll(db, `SELECT e.id AS gerant_id, e.nom AS gerant_nom,
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
  await transaction(db, async () => {
    await appliquerSuspensionsAbonnementsDb(db);
  });
}

function programmerRappelsReservations() {
  if (!cron) {
    logger.warn('index.js', 'node-cron non installe: rappels push inactifs');
    return;
  }

  const run = (name, fn) => async () => {
    try {
      const result = await fn();
      if (result?.processed > 0) {
        logger.info('index.js', `${name}: ${result.processed}`);
      }
    } catch (error) {
      logger.error('index.js', name, error);
    }
  };

  cron.schedule('*/15 * * * *', run('push match imminent', () => pushService.cronMatchImminent()));
  cron.schedule('*/30 * * * *', run('push rappel H-2', () => pushService.cronRappelH2()));
  cron.schedule('0 20 * * *', run('push rappel J-1', () => pushService.cronRappelJ1()));
  cron.schedule('0 9 * * *', run('push rappels dettes', () => pushService.cronRappelsDettes()));
  cron.schedule('0 9 * * *', run('push rappels abonnements', () => pushService.cronRappelsAbonnements()));
  cron.schedule('0 9 * * *', run('push rappels essai', () => pushService.cronRappelsEssai()));
}

async function ensureSeedData(db) {
  const count = await queryOne(db, 'SELECT COUNT(*) AS total FROM terrains');
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
    cron.schedule('*/5 * * * *', async () => {
      try {
        await bugAlertService.checkWhatsappHealthAndAlert();
      } catch (error) {
        logger.error('index.js', 'Surveillance WhatsApp alertes', error);
      }
    });
  } else {
    setInterval(() => {
      bugAlertService.checkWhatsappHealthAndAlert().catch(() => {});
    }, 5 * 60 * 1000);
  }
  setInterval(async () => {
    try {
      const dbInterval = await getDb();
      const liberated = await transaction(dbInterval, async () => libererVerrousPaiementExpires(dbInterval));
      for (const row of liberated) {
        notifyTerrain(row.terrain_id, 'reservation', {
          date: row.date,
          action: 'verrou_expire',
          reservation_id: row.id,
        });
      }
    } catch (error) {
      logger.error('index.js', 'Nettoyage des verrous', error);
    }
  }, 60 * 1000);
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
