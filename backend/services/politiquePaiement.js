/**
 * Politique de paiement terrain : 'avance' | 'sans_avance'.
 * Sans avance = confirmation sans PayTech joueur ; commission en dette ;
 * paiement en ligne réservé aux dettes gérant (et cas IPN spécifiques).
 */

function estSansAvance(terrainOrPolitique) {
  const raw = typeof terrainOrPolitique === 'string'
    ? terrainOrPolitique
    : terrainOrPolitique?.politique_paiement;
  return ['sans_avance', 'sans_acompte'].includes(String(raw || '').trim().toLowerCase());
}

function normaliserPolitiquePaiement(value) {
  return estSansAvance(value) ? 'sans_avance' : 'avance';
}

function delaiPaiementDetteJours(terrain) {
  const n = Number(terrain?.delai_paiement_dette_jours);
  if (!Number.isFinite(n) || n < 7) return 30;
  if (n > 90) return 90;
  return Math.round(n);
}

function dateEcheanceDette(terrain, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + delaiPaiementDetteJours(terrain));
  return d.toISOString().slice(0, 10);
}

module.exports = {
  estSansAvance,
  normaliserPolitiquePaiement,
  delaiPaiementDetteJours,
  dateEcheanceDette,
};
