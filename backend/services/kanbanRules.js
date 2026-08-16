const { calculerFenetreCheckIn, estDansLaFenetreCheckIn } = require('./checkInFenetre');

const STAGES = ['reserved', 'checkin', 'match', 'checkout', 'closed'];

const ALLOWED = {
  reserved: ['checkin'],
  checkin: ['match'],
  match: ['checkout'],
  checkout: ['closed'],
  closed: [],
};

const STAGE_MESSAGES = {
  PLAYER_BLOCKED: 'Ce joueur est bloqué dans le CRM (banni ou impayé).',
  ILLEGAL_TRANSITION: 'Cette transition Kanban n’est pas autorisée.',
  INVALID_STAGE: 'Étape Kanban inconnue.',
  NOT_CONFIRMED: 'Seule une réservation confirmée peut passer en check-in.',
  OUT_OF_WINDOW: 'Check-in hors fenêtre horaire.',
  CHECKIN_REQUIRED: 'Le check-in doit être validé avant le match.',
  MATCH_NOT_STARTED: 'Le match n’a pas encore commencé.',
  BALANCE_OPEN: 'Le reste à payer doit être encaissé (ou un waiver gérant).',
};

function gateError(code, statusCode = 400) {
  const error = new Error(STAGE_MESSAGES[code] || code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isStage(value) {
  return STAGES.includes(String(value || ''));
}

function playerGate(player = {}) {
  if (player.is_banned) return { bloqueReservation: true, reason: 'Banni' };
  if (player.politiqueImpaye && Number(player.solde_ouvert || 0) > 0) {
    return { bloqueReservation: true, reason: 'Impayé' };
  }
  if (player.abonnement?.statut === 'en_retard') {
    return { bloqueReservation: true, reason: 'Abonnement en retard' };
  }
  return { bloqueReservation: false };
}

function nextKanbanStage(from) {
  return (ALLOWED[from] && ALLOWED[from][0]) || null;
}

function resolveOperationalStage(row = {}) {
  const raw = String(row.operational_stage || '').trim();
  if (isStage(raw)) return raw;
  if (row.checkout_at) return 'closed';
  if (row.statut === 'match_joue' || row.statut === 'joue') return 'match';
  if (row.checked_in_at || row.qr_code_scanne_at) return 'checkin';
  return 'reserved';
}

function assertStageTransition(card, to, maintenant = Date.now()) {
  if (!isStage(to)) throw gateError('INVALID_STAGE');

  if (card?.crm?.bloqueReservation) throw gateError('PLAYER_BLOCKED', 409);

  const from = isStage(card?.stage) ? card.stage : 'reserved';
  if (!ALLOWED[from].includes(to)) throw gateError('ILLEGAL_TRANSITION');

  if (to === 'checkin') {
    if (card.statut !== 'confirme') throw gateError('NOT_CONFIRMED');
    const creneau = {
      date: card.date,
      heure_debut: card.heure_debut,
      heure_fin: card.heure_fin,
      fenetre_retard: card.fenetre_retard,
    };
    if (!estDansLaFenetreCheckIn(creneau, maintenant)) throw gateError('OUT_OF_WINDOW');
  }

  if (to === 'match' && !card.checked_in_at) throw gateError('CHECKIN_REQUIRED');

  if (to === 'checkout') {
    const { heureDebutMs } = calculerFenetreCheckIn({
      date: card.date,
      heure_debut: card.heure_debut,
      heure_fin: card.heure_fin,
      fenetre_retard: card.fenetre_retard,
    });
    if (maintenant < heureDebutMs) throw gateError('MATCH_NOT_STARTED');
  }

  if (to === 'closed') {
    const restant = Number(card.montant_restant || 0);
    if (restant > 0 && !card.waiverEncaissement) throw gateError('BALANCE_OPEN');
  }

  return true;
}

module.exports = {
  STAGES,
  ALLOWED,
  playerGate,
  nextKanbanStage,
  resolveOperationalStage,
  assertStageTransition,
};
