const { createHarness } = require('../helpers/harness');
const { decisionCreation } = require('../../domain/reservationState');
const h = createHarness('p10');

const decision = decisionCreation({ sansAvance: false, mode: 'paiement' });
h.assertEqual('attente', decision.statut, 'en_attente_paiement');
h.assert('lien', decision.creerLienPaiement);
h.assert('pas de confirmation', decision.envoyerConfirmation === false);
h.assert('pas de QR', decision.genererQr === false);
h.assert('pas de SSE de confirmation à la création', decision.envoyerConfirmation === false);
h.exitIfFailed();
