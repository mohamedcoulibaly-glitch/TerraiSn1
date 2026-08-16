process.env.WHATSAPP_MOCK = 'true';
require('dotenv').config();

const whatsappClient = require('../whatsappClient');
const { sessionKeyFromReservation } = require('../notificationService');
const { reservationIdDepuisReference, montantIpnCoherent } = require('../payments/flow');
const { mapReservationGerantRow, localDateYmd } = require('../gerantCheckin');
const { montantLienPaiement } = require('../paytechService');
const { REVENUE_STATUSES, revenueStatusSql } = require('../ownerRevenueService');
const { nextKanbanStage } = require('../services/kanbanRules');

let failed = 0;
function assert(name, cond) {
  if (!cond) {
    console.error('FAIL', name);
    failed += 1;
  } else {
    console.log('OK  ', name);
  }
}

assert('gerantSessionKey(7)', whatsappClient.gerantSessionKey(7) === 'gerant:7');
assert('gerantSessionKey invalid', whatsappClient.gerantSessionKey(0) == null);
assert('sessionKeyFromReservation', sessionKeyFromReservation({ gerant_id: 3 }) === 'gerant:3');
assert('sessionKey fallback platform', sessionKeyFromReservation({}) === 'platform');
assert('reservationIdDepuisReference', reservationIdDepuisReference('TF-88-171000') === 88);
assert('montant IPN coherent', montantIpnCoherent({ montant_avance: 5000 }, { final_item_price: 5000 }));
assert('montant IPN incoherent', !montantIpnCoherent({ montant_avance: 5000 }, { final_item_price: 1 }));
assert('PayTech ignore acompte 0 si montant_avance', montantLienPaiement({ acompte: 0, montant_avance: 8750 }) === 8750);
assert('PayTech fallback acompte', montantLienPaiement({ acompte: 5000 }) === 5000);
assert('revenus proprio incluent confirme', REVENUE_STATUSES.includes('confirme') && REVENUE_STATUSES.includes('match_joue'));
assert('SQL revenus confirme', revenueStatusSql('r').includes("'confirme'"));
assert('nextKanbanStage checkout', nextKanbanStage('checkout') === 'closed');
assert('nextKanbanStage closed', nextKanbanStage('closed') == null);

const mapped = mapReservationGerantRow({
  id: 1,
  date: localDateYmd(),
  heure_debut: '17:00',
  heure_fin: '18:00',
  statut: 'confirme',
  prix_total: 40000,
  montant_avance: 5000,
  montant_restant: 35000,
  cree_par: 'gerant',
  terrain_id: 2,
  terrain_nom: 'Test',
  fenetre_retard: 30,
});
assert('map statut', mapped.statut === 'confirme');
assert('map type manuelle', mapped.type_reservation === 'manuelle');
assert('map heures', mapped.heure_debut === '17:00' && mapped.heure_fin === '18:00');
assert('map stage default', mapped.operational_stage === 'reserved');
assert('map crm gate', mapped.crm && mapped.crm.bloqueReservation === false);
assert('localDateYmd format', /^\d{4}-\d{2}-\d{2}$/.test(localDateYmd()));

if (failed) {
  console.error(`\n${failed} test(s) en échec`);
  process.exit(1);
}
console.log('\nTous les tests module gérant OK');
