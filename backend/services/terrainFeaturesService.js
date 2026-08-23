const { queryAll, queryOne, runSql } = require('../database');

const FEATURES = [
  { cle: 'reservations_en_ligne', label: 'Réservations en ligne', description: 'Les joueurs peuvent réserver et payer en ligne', icone: 'Globe', defaut: true, impact: 'joueur' },
  { cle: 'confirmations_manuelles', label: 'Confirmations manuelles gérant', description: 'Le gérant peut confirmer des réservations hors PayTech', icone: 'HandMetal', defaut: true, impact: 'gerant' },
  { cle: 'abonnements', label: 'Abonnements récurrents', description: 'Créneaux hebdomadaires réservés pour des abonnés', icone: 'Repeat', defaut: false, impact: 'gerant' },
  { cle: 'tournois', label: 'Tournois', description: 'Blocage de créneaux pour des événements compétitifs', icone: 'Trophy', defaut: true, impact: 'gerant' },
  { cle: 'geolocalisation', label: 'Géolocalisation sur carte', description: "Afficher la carte et l'itinéraire côté joueur", icone: 'MapPin', defaut: true, impact: 'joueur' },
  { cle: 'score_sante', label: 'Score de santé gérant', description: 'Calcul et affichage du score de confiance pour le proprio', icone: 'ShieldCheck', defaut: true, impact: 'proprio' },
  { cle: 'dette_commission', label: 'Système de dette commission', description: 'Comptabilisation des commissions hors PayTech', icone: 'Receipt', defaut: true, impact: 'gerant' },
];

async function listFeatures(database, terrainId) {
  const rows = await queryAll(database, 'SELECT feature_cle, actif FROM terrain_features WHERE terrain_id = ?', [Number(terrainId)]);
  const map = new Map(rows.map((r) => [r.feature_cle, Number(r.actif) === 1]));
  return FEATURES.map((f) => ({
    ...f,
    actif: map.has(f.cle) ? map.get(f.cle) : f.defaut,
  }));
}

/** Map { cle: boolean } pour les écrans cibles. */
async function featuresFlags(database, terrainId) {
  const list = await listFeatures(database, terrainId);
  const out = {};
  for (const f of list) out[f.cle] = Boolean(f.actif);
  return out;
}

function isFeatureEnabled(flags, cle, fallback = true) {
  if (!flags || typeof flags !== 'object') return fallback;
  if (!(cle in flags)) {
    const def = FEATURES.find((f) => f.cle === cle);
    return def ? Boolean(def.defaut) : fallback;
  }
  return Boolean(flags[cle]);
}

async function saveFeatures(database, terrainId, items, actorId) {
  const wanted = Array.isArray(items) ? items : [];
  for (const item of wanted) {
    const def = FEATURES.find((f) => f.cle === item.cle);
    if (!def) continue;
    const actif = item.actif ? 1 : 0;
    const existing = await queryOne(database, 'SELECT id FROM terrain_features WHERE terrain_id = ? AND feature_cle = ?', [Number(terrainId), def.cle]);
    if (existing) {
      await runSql(database, 'UPDATE terrain_features SET actif = ?, configure_par = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [actif, actorId || null, existing.id]);
    } else {
      await runSql(
        database,
        'INSERT INTO terrain_features (terrain_id, feature_cle, actif, configure_par) VALUES (?, ?, ?, ?)',
        [Number(terrainId), def.cle, actif, actorId || null],
      );
    }
  }
  return listFeatures(database, terrainId);
}

module.exports = { FEATURES, listFeatures, featuresFlags, isFeatureEnabled, saveFeatures };
