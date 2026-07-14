const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'terrainsn_secret_key_2026');
    if (req.user.must_change_password && req.path !== '/auth/change-password' && req.path !== '/auth/me') {
      return res.status(403).json({ error: 'Changement de mot de passe requis', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    const normalized = req.user?.role === 'superadmin' ? 'super_admin' : req.user?.role;
    if (!req.user || !roles.includes(normalized)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
