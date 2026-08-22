const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'terrainsn_secret_key_2026';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || `${JWT_SECRET}_refresh`;

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function genererAccessToken(user) {
  const payload = {
    id: user.id,
    role: user.role,
    terrain_id: user.terrain_id,
    email: user.email,
    telephone: user.telephone,
    accountType: user.accountType || 'user',
    must_change_password: Boolean(user.must_change_password),
  };
  if (user.proprietaire_id != null) payload.proprietaire_id = user.proprietaire_id;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
}

function genererRefreshToken(user) {
  return jwt.sign(
    { id: user.id, accountType: user.accountType || 'user' },
    JWT_REFRESH_SECRET,
    { expiresIn: '30d' }
  );
}

function profileTableFor(accountType) {
  if (accountType === 'proprietaire') return 'proprietaires';
  if (accountType === 'employe') return 'employes';
  return 'users';
}

function isBlockedStatut(statut) {
  const s = String(statut || '').toLowerCase();
  return s === 'bloque' || s === 'suspendu';
}

function isPasswordChangeAllowedPath(req) {
  const path = String(req.path || req.originalUrl || '');
  return (
    path.endsWith('/auth/change-password') ||
    path.endsWith('/auth/me') ||
    path.endsWith('/profil/password') ||
    (path.includes('/profil/') && (req.method === 'GET' || path.endsWith('/profil/photo')))
  );
}

function isGerantUser(user) {
  if (!user) return false;
  const role = user.role === 'superadmin' ? 'super_admin' : user.role;
  return role === 'gerant' || user.accountType === 'employe';
}

/**
 * Enrichit req.user pour les gérants multi-terrains.
 * - terrains_ids : terrains accessibles
 * - terrain_id_principal : premier / défaut
 * - terrain_id : terrain actif (header X-Terrain-Id ou JWT si valide)
 */
async function enrichirGerant(req) {
  if (!isGerantUser(req.user)) return;

  const { getDb, queryAll, queryOne } = require('../database');
  const db = await getDb();
  const gerantId = Number(req.user.id);

  let terrains = await queryAll(db, `
    SELECT terrain_id FROM gerants_terrains
    WHERE gerant_id = ? AND actif = 1
    ORDER BY est_principal DESC, id ASC
  `, [gerantId]);

  if (!terrains.length && req.user.terrain_id) {
    terrains = [{ terrain_id: req.user.terrain_id }];
  }
  if (!terrains.length) {
    const emp = await queryOne(db, 'SELECT terrain_id FROM employes WHERE id = ?', [gerantId]);
    if (emp?.terrain_id) terrains = [{ terrain_id: emp.terrain_id }];
  }

  req.user.terrains_ids = terrains.map((t) => Number(t.terrain_id)).filter(Boolean);
  req.user.terrain_id_principal = req.user.terrains_ids[0] || null;

  const headerRaw = req.headers['x-terrain-id'] || req.query?.terrain_id;
  const requested = headerRaw != null && headerRaw !== '' ? Number(headerRaw) : null;

  if (requested && req.user.terrains_ids.includes(requested)) {
    req.user.terrain_id = requested;
  } else if (req.user.terrain_id && req.user.terrains_ids.includes(Number(req.user.terrain_id))) {
    req.user.terrain_id = Number(req.user.terrain_id);
  } else {
    req.user.terrain_id = req.user.terrain_id_principal;
  }
}

function verifierTerrainGerant(terrain_id, req) {
  const tid = Number(terrain_id);
  if (!Number.isFinite(tid)) return false;
  if (Array.isArray(req.user?.terrains_ids) && req.user.terrains_ids.length) {
    return req.user.terrains_ids.includes(tid);
  }
  return Number(req.user?.terrain_id) === tid;
}

/** Résout le terrain actif pour une route gérant (params / body / principal). */
function resolveTerrainGerant(req, explicitTerrainId = null) {
  const candidate = explicitTerrainId
    ?? req.params?.terrain_id
    ?? req.body?.terrain_id
    ?? req.query?.terrain_id
    ?? req.user?.terrain_id
    ?? req.user?.terrain_id_principal;
  const tid = Number(candidate);
  if (!Number.isFinite(tid) || !verifierTerrainGerant(tid, req)) {
    return null;
  }
  return tid;
}

async function middlewareAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    if (req.user.must_change_password && !isPasswordChangeAllowedPath(req)) {
      return res.status(403).json({
        error: 'Changement de mot de passe requis',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    const { getDb, queryOne } = require('../database');
    const db = await getDb();
    const table = profileTableFor(req.user.accountType || 'user');

    if (table === 'users') {
      const user = await queryOne(db, 'SELECT statut, is_active FROM users WHERE id = ?', [req.user.id]);
      if (!user || Number(user.is_active) === 0 || isBlockedStatut(user.statut)) {
        return res.status(403).json({
          error: 'Ton compte a été suspendu. Contacte le support.',
        });
      }
    } else if (table === 'proprietaires') {
      const user = await queryOne(db, 'SELECT statut FROM proprietaires WHERE id = ?', [req.user.id]);
      if (!user || isBlockedStatut(user.statut) || String(user.statut || '').toLowerCase() === 'inactif') {
        return res.status(403).json({
          error: 'Ton compte a été suspendu. Contacte le support.',
        });
      }
    } else if (table === 'employes') {
      const user = await queryOne(db, 'SELECT is_active FROM employes WHERE id = ?', [req.user.id]);
      if (!user || Number(user.is_active) === 0) {
        return res.status(403).json({
          error: 'Ton compte a été suspendu. Contacte le support.',
        });
      }
    }

    await enrichirGerant(req);
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'TOKEN_EXPIRE' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }
}

/** Alias historique — même middleware. */
const authMiddleware = middlewareAuth;

function requireRole(...roles) {
  return (req, res, next) => {
    const normalized = req.user?.role === 'superadmin' ? 'super_admin' : req.user?.role;
    if (!req.user || !roles.includes(normalized)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  };
}

module.exports = {
  authMiddleware,
  middlewareAuth,
  requireRole,
  genererAccessToken,
  genererRefreshToken,
  hashRefreshToken,
  profileTableFor,
  isBlockedStatut,
  enrichirGerant,
  verifierTerrainGerant,
  resolveTerrainGerant,
  isGerantUser,
  JWT_SECRET,
  JWT_REFRESH_SECRET,
};
