function nombreOuNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Prix affiché sur la carte d'accueil. Distinct du prix payé à la réservation.
 * @param {{ source?: string, prixDemi?: number, prixEntier?: number, prixHeure?: number }} input
 */
function resoudrePrixAffiche({ source, prixDemi, prixEntier, prixHeure } = {}) {
  const demande = source === 'entier' ? 'entier' : 'demi';
  const demi = nombreOuNull(prixDemi);
  const entier = nombreOuNull(prixEntier);
  const heure = nombreOuNull(prixHeure);

  if (demande === 'demi' && demi != null) {
    return { prix_affiche: demi, prix_carte_source: 'demi' };
  }
  if (demande === 'entier' && entier != null) {
    return { prix_affiche: entier, prix_carte_source: 'entier' };
  }
  if (demi != null) return { prix_affiche: demi, prix_carte_source: 'demi' };
  if (entier != null) return { prix_affiche: entier, prix_carte_source: 'entier' };
  if (heure != null) return { prix_affiche: heure, prix_carte_source: demande };
  return { prix_affiche: null, prix_carte_source: demande };
}

function normaliserSourcePrixCarte(value) {
  const source = String(value || '').trim().toLowerCase();
  if (source !== 'demi' && source !== 'entier') {
    const error = new Error("prix_carte_source doit être 'demi' ou 'entier'");
    error.statusCode = 400;
    throw error;
  }
  return source;
}

function etagConfig(version) {
  return `W/"${Number(version) || 0}"`;
}

function reponseCacheConfig(headers, version) {
  const etag = etagConfig(version);
  const inm = headers?.['if-none-match'] || headers?.['If-None-Match'] || '';
  if (inm === etag) return { status: 304, etag, body: null };
  return { status: 200, etag, body: true };
}

module.exports = {
  resoudrePrixAffiche,
  normaliserSourcePrixCarte,
  etagConfig,
  reponseCacheConfig,
};
