/**
 * Domaines front séparés (joueur / pro).
 * Mono-host Render : APP_DOMAIN_PRO = https://x.onrender.com/pro
 */

function stripSlash(url) {
  return String(url || '').replace(/\/$/, '');
}

function joueurDomain() {
  return stripSlash(
    process.env.APP_DOMAIN_JOUEUR
      || process.env.APP_DOMAIN
      || 'http://localhost:5173',
  );
}

function proDomain() {
  if (process.env.APP_DOMAIN_PRO) {
    return stripSlash(process.env.APP_DOMAIN_PRO);
  }
  const base = stripSlash(process.env.APP_DOMAIN || '');
  // Mono-host : pro servi sous /pro
  if (base && process.env.PRO_PUBLIC_DIR) {
    return `${base}/pro`;
  }
  if (base && process.env.NODE_ENV === 'production' && !process.env.APP_DOMAIN_JOUEUR) {
    // Heuristique Render mono-host sans APP_DOMAIN_PRO explicite
    return `${base}/pro`;
  }
  return stripSlash(base || 'http://localhost:5174');
}

/** Préfixe chemin relatif pour liens push / deep-links pro en mono-host */
function proPathPrefix() {
  const pro = proDomain();
  const joueur = joueurDomain();
  if (pro.startsWith(joueur + '/')) {
    return pro.slice(joueur.length) || '';
  }
  // Même host, chemin /pro
  try {
    const u = new URL(pro);
    if (u.pathname && u.pathname !== '/') {
      return u.pathname.replace(/\/$/, '');
    }
  } catch {
    /* ignore */
  }
  return '';
}

function withProPath(path) {
  const p = String(path || '/');
  const prefix = proPathPrefix();
  if (!prefix) return p.startsWith('/') ? p : `/${p}`;
  if (p.startsWith(prefix)) return p;
  return `${prefix}${p.startsWith('/') ? p : `/${p}`}`;
}

module.exports = {
  joueurDomain,
  proDomain,
  proPathPrefix,
  withProPath,
};
