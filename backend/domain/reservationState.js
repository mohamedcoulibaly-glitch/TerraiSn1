/**
 * Machine à états des réservations.
 * Les nouvelles créations joueur en ligne écrivent `en_attente_paiement`.
 * `en_attente` reste accepté en entrée (lignes déjà en base).
 */

const CONFIRMABLES = new Set(['en_attente', 'en_attente_paiement']);

const TRANSITIONS = {
  en_attente_paiement: new Set(['confirme', 'expire', 'annule']),
  en_attente: new Set(['confirme', 'expire', 'annule']),
  confirme: new Set(['match_joue', 'annule']),
  acceptee: new Set(['match_joue', 'annule']),
  match_joue: new Set(),
  joue: new Set(),
  annule: new Set(),
  expire: new Set(),
};

function peutConfirmer(statut) {
  return CONFIRMABLES.has(String(statut || ''));
}

/**
 * @returns {{ ok: true } | { ok: false, code: string }}
 */
function transition(from, to) {
  const source = String(from || '');
  const cible = String(to || '');
  if (source === 'confirme' && cible === 'confirme') {
    return { ok: false, code: 'ALREADY_CONFIRMED' };
  }
  const allowed = TRANSITIONS[source];
  if (!allowed || !allowed.has(cible)) {
    return { ok: false, code: 'TRANSITION_INTERDITE' };
  }
  return { ok: true };
}

/**
 * Décision unique à la création. Le paiement en ligne ne confirme pas.
 * @param {{ sansAvance?: boolean, mode?: string }} input
 */
function decisionCreation({ sansAvance = false, mode = 'paiement' } = {}) {
  if (sansAvance || mode === 'bloquer') {
    return {
      statut: 'confirme',
      genererQr: true,
      envoyerConfirmation: Boolean(sansAvance),
      creerLienPaiement: false,
      poserVerrou: false,
    };
  }
  return {
    statut: 'en_attente_paiement',
    genererQr: false,
    envoyerConfirmation: false,
    creerLienPaiement: mode === 'paiement',
    poserVerrou: true,
  };
}

module.exports = {
  CONFIRMABLES,
  TRANSITIONS,
  peutConfirmer,
  transition,
  decisionCreation,
};
