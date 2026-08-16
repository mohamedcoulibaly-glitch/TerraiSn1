/**
 * Tests règles Kanban (sans HTTP).
 * Usage: node scripts/test-kanban-rules.js
 */
const assert = require('assert');
const {
  playerGate,
  resolveOperationalStage,
  assertStageTransition,
} = require('../services/kanbanRules');

const slot = {
  date: '2026-08-10',
  heure_debut: '18:00',
  heure_fin: '19:00',
  fenetre_retard: 30,
};

function card(overrides = {}) {
  return {
    stage: 'reserved',
    statut: 'confirme',
    ...slot,
    checked_in_at: null,
    montant_restant: 35000,
    crm: { bloqueReservation: false },
    ...overrides,
  };
}

assert.strictEqual(playerGate({ is_banned: true }).bloqueReservation, true);
assert.strictEqual(playerGate({ solde_ouvert: 10 }).bloqueReservation, false);
assert.strictEqual(resolveOperationalStage({ operational_stage: 'match' }), 'match');
assert.strictEqual(resolveOperationalStage({ qr_code_scanne_at: 'x' }), 'checkin');

const inWindow = new Date('2026-08-10T17:30:00').getTime();
const duringMatch = new Date('2026-08-10T18:10:00').getTime();

assert.strictEqual(assertStageTransition(card(), 'checkin', inWindow), true);

let skip = false;
try {
  assertStageTransition(card(), 'match', inWindow);
} catch (e) {
  skip = e.code === 'ILLEGAL_TRANSITION';
}
assert.ok(skip, 'skip check-in interdit');

let noCheckin = false;
try {
  assertStageTransition(card({ stage: 'checkin' }), 'match', duringMatch);
} catch (e) {
  noCheckin = e.code === 'CHECKIN_REQUIRED';
}
assert.ok(noCheckin, 'match sans check-in interdit');

assert.strictEqual(
  assertStageTransition(card({ stage: 'checkin', checked_in_at: '2026-08-10T17:05:00' }), 'match', duringMatch),
  true,
);

let blocked = false;
try {
  assertStageTransition(card({ crm: { bloqueReservation: true } }), 'checkin', inWindow);
} catch (e) {
  blocked = e.code === 'PLAYER_BLOCKED' && e.statusCode === 409;
}
assert.ok(blocked, 'CRM gate → 409');

console.log('Tous les tests kanbanRules OK');
