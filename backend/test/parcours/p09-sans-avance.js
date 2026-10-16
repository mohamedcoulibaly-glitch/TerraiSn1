const { createHarness } = require('../helpers/harness');
const { decisionCreation } = require('../../domain/reservationState');
const h = createHarness('p09');

const decision = decisionCreation({ sansAvance: true, mode: 'paiement' });
h.assertEqual('confirmé', decision.statut, 'confirme');
h.assert('notifie', decision.envoyerConfirmation);
h.assert('QR', decision.genererQr);
h.assert('pas de lien', decision.creerLienPaiement === false);
h.assert('pas de verrou', decision.poserVerrou === false);
h.exitIfFailed();
