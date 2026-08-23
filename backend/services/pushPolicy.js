/**
 * Politiques push par terrain.
 * Chaque type NOTIF_CONFIG n'est envoyé que si le terrain
 * (modele_revenus, essai, politique_paiement, remboursements) l'autorise.
 */
const { resolveMode } = require('./modeRevenuService');

/** Modes stockés en DB (hors overlay essai). */
const MODE_COMMISSION = 'commission';
const MODE_ABONNEMENT = 'abonnement';
const MODE_ACHAT = 'achat_definitif';

/**
 * modesDb : modele_revenus stocké (commission | abonnement | achat_definitif)
 * modesOp : mode opérationnel resolveMode (commission | abonnement | achat | essai)
 * paiement : 'avance' | 'sans_avance' | null (pas de contrainte)
 * remboursable : true = exige delai_remboursement_heures > 0
 */
const TYPE_POLICY = {
  // ── Communs (tous modèles) ──
  RESA_CONFIRMEE: { modesOp: null },
  RESA_CONFIRMEE_SANS_AVANCE: { modesOp: null, paiement: 'sans_avance' },
  REMBOURSEMENT: { modesOp: null, remboursable: true },
  RESA_ANNULEE_CONFLIT: { modesOp: null },
  RAPPEL_MATCH_J1: { modesOp: null },
  RAPPEL_MATCH_H2: { modesOp: null },
  RESA_ANNULEE_GERANT: { modesOp: null },
  NOUVELLE_RESA: { modesOp: null },
  RESA_EN_ATTENTE: { modesOp: null, paiement: 'avance' },
  RESA_ANNULEE_JOUEUR: { modesOp: null },
  MATCH_IMMINENT: { modesOp: null },
  MATCH_CONFIRME_TERRAIN: { modesOp: null },
  SANTE_ORANGE: { modesOp: null },
  SANTE_ROUGE: { modesOp: null },
  SCORE_CRITIQUE_ADMIN: { modesOp: null },
  REVENUS_FIN_MOIS: { modesOp: null },

  // ── Commission uniquement ──
  REVERSEMENT_CREDITE: { modesDb: [MODE_COMMISSION] },
  DETTE_RAPPEL_J7: { modesDb: [MODE_COMMISSION] },
  DETTE_RAPPEL_J3: { modesDb: [MODE_COMMISSION] },
  DETTE_RAPPEL_J1: { modesDb: [MODE_COMMISSION] },
  DETTE_RETARD: { modesDb: [MODE_COMMISSION] },
  DETTE_RETARD_ADMIN: { modesDb: [MODE_COMMISSION] },

  // ── Abonnement uniquement ──
  ABONNEMENT_J7: { modesDb: [MODE_ABONNEMENT] },
  ABONNEMENT_RETARD: { modesDb: [MODE_ABONNEMENT] },
  ABONNEMENT_RETARD_ADMIN: { modesDb: [MODE_ABONNEMENT] },

  // ── Essai (overlay) ──
  ESSAI_EXPIRE_J7: { modesOp: ['essai'] },
  ESSAI_EXPIRE_J3: { modesOp: ['essai'] },
  ESSAI_EXPIRE_J1: { modesOp: ['essai'] },

  // ── Suspension / réactivation (abo ou essai) ──
  TERRAIN_SUSPENDU: { modesOp: ['abonnement', 'essai'] },
  TERRAIN_REACTIVE: { modesOp: ['abonnement', 'essai', 'commission', 'achat'] },

  // ── Plateforme / SA (pas de filtre terrain) ──
  RETRAIT_DEMANDE: { platform: true },
  PAYOUT_ECHEC: { platform: true },
};

/** Préférences UI → types / familles de modes concernés */
const PREF_POLICY = {
  push_resa_confirmee: { always: true },
  push_resa_annulee: { always: true },
  push_rappel_match: { always: true },
  push_remboursement: { remboursable: true },
  push_nouvelle_resa: { always: true },
  push_match_imminent: { always: true },
  push_reversement: { modesDb: [MODE_COMMISSION] },
  push_dette_rappel: { modesDb: [MODE_COMMISSION] },
  push_revenus: { always: true },
  push_sante_gerant: { always: true },
  push_abonnement: { modesDb: [MODE_ABONNEMENT], modesOp: ['essai'] },
  push_retrait_demande: { platform: true },
  push_payout_echec: { platform: true },
  push_alertes_terrain: { always: true },
};

function modeleDb(terrain) {
  const m = String(terrain?.modele_revenus || MODE_COMMISSION);
  if (m === 'abonnement') return MODE_ABONNEMENT;
  if (m === 'achat_definitif' || m === 'achat') return MODE_ACHAT;
  return MODE_COMMISSION;
}

function modeOperationnel(terrain) {
  try {
    return resolveMode(terrain);
  } catch {
    return modeleDb(terrain) === MODE_ACHAT ? 'achat' : modeleDb(terrain);
  }
}

function politiquePaiement(terrain) {
  return String(terrain?.politique_paiement || 'avance') === 'sans_avance' ? 'sans_avance' : 'avance';
}

function estRemboursable(terrain) {
  const delai = Number(terrain?.delai_remboursement_heures);
  if (!Number.isFinite(delai)) return true;
  return delai > 0;
}

/**
 * @returns {{ allowed: boolean, reason?: string }}
 */
function isTypeAllowedForTerrain(type, terrain) {
  const policy = TYPE_POLICY[type];
  if (!policy) return { allowed: true };
  if (policy.platform) return { allowed: true };
  if (!terrain) {
    // Sans contexte terrain : autoriser les types communs / plateforme uniquement
    if (policy.modesDb || policy.modesOp || policy.paiement || policy.remboursable) {
      return { allowed: false, reason: 'terrain_requis' };
    }
    return { allowed: true };
  }

  if (policy.modesDb?.length) {
    const db = modeleDb(terrain);
    if (!policy.modesDb.includes(db)) {
      return { allowed: false, reason: `modele_revenus=${db}` };
    }
  }

  if (policy.modesOp?.length) {
    const op = modeOperationnel(terrain);
    if (!policy.modesOp.includes(op)) {
      return { allowed: false, reason: `mode_op=${op}` };
    }
  }

  if (policy.paiement) {
    const p = politiquePaiement(terrain);
    if (p !== policy.paiement) {
      return { allowed: false, reason: `politique_paiement=${p}` };
    }
  }

  if (policy.remboursable && !estRemboursable(terrain)) {
    return { allowed: false, reason: 'remboursement_desactive' };
  }

  return { allowed: true };
}

/**
 * Agrège les politiques de plusieurs terrains (gérant / proprio multi).
 * Une préférence est visible si au moins un terrain la justifie.
 */
function allowedPreferencesForTerrains(terrains = [], { includePlatform = false } = {}) {
  const list = Array.isArray(terrains) ? terrains : [];
  const out = {};
  for (const [pref, policy] of Object.entries(PREF_POLICY)) {
    if (policy.always) {
      out[pref] = true;
      continue;
    }
    if (policy.platform) {
      out[pref] = Boolean(includePlatform);
      continue;
    }
    if (!list.length) {
      out[pref] = false;
      continue;
    }
    out[pref] = list.some((t) => {
      if (policy.remboursable) return estRemboursable(t);
      if (policy.modesDb?.length && policy.modesDb.includes(modeleDb(t))) return true;
      if (policy.modesOp?.length && policy.modesOp.includes(modeOperationnel(t))) return true;
      return false;
    });
  }
  return out;
}

/** Résumé des modes présents sur un lot de terrains (pour l’UI). */
function summarizeTerrainPolicies(terrains = []) {
  const modesDb = new Set();
  const modesOp = new Set();
  let hasSansAvance = false;
  let hasRemboursement = false;
  for (const t of terrains || []) {
    modesDb.add(modeleDb(t));
    modesOp.add(modeOperationnel(t));
    if (politiquePaiement(t) === 'sans_avance') hasSansAvance = true;
    if (estRemboursable(t)) hasRemboursement = true;
  }
  return {
    modes_db: [...modesDb],
    modes_op: [...modesOp],
    has_commission: modesDb.has(MODE_COMMISSION),
    has_abonnement: modesDb.has(MODE_ABONNEMENT),
    has_achat: modesDb.has(MODE_ACHAT),
    has_essai: modesOp.has('essai'),
    has_sans_avance: hasSansAvance,
    has_remboursement: hasRemboursement,
  };
}

module.exports = {
  TYPE_POLICY,
  PREF_POLICY,
  MODE_COMMISSION,
  MODE_ABONNEMENT,
  MODE_ACHAT,
  modeleDb,
  modeOperationnel,
  politiquePaiement,
  estRemboursable,
  isTypeAllowedForTerrain,
  allowedPreferencesForTerrains,
  summarizeTerrainPolicies,
};
