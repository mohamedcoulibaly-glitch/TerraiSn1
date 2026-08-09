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
      const user = queryOne(db, 'SELECT statut, is_active FROM users WHERE id = ?', [req.user.id]);
      if (!user || Number(user.is_active) === 0 || isBlockedStatut(user.statut)) {
        return res.status(403).json({
          error: 'Ton compte a été suspendu. Contacte le support.',
        });
      }
    } else if (table === 'proprietaires') {
      const user = queryOne(db, 'SELECT statut FROM proprietaires WHERE id = ?', [req.user.id]);
      if (!user || isBlockedStatut(user.statut) || String(user.statut || '').toLowerCase() === 'inactif') {
        return res.status(403).json({
          error: 'Ton compte a été suspendu. Contacte le support.',
        });
      }
    } else if (table === 'employes') {
      const user = queryOne(db, 'SELECT is_active FROM employes WHERE id = ?', [req.user.id]);
      if (!user || Number(user.is_active) === 0) {
        return res.status(403).json({
          error: 'Ton compte a été suspendu. Contacte le support.',
        });
      }
    }

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
  JWT_SECRET,
  JWT_REFRESH_SECRET,
};
