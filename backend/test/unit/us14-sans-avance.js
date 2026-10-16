const { createHarness } = require('../helpers/harness');
const { decisionCreation } = require('../../domain/reservationState');

const h = createHarness('us14');

const sans = decisionCreation({ sansAvance: true, mode: 'paiement' });
h.assertEqual('statut', sans.statut, 'confirme');
h.assertEqual('avance implicite 0 via pas de lien', sans.creerLienPaiement, false);
h.assert('confirmation', sans.envoyerConfirmation);
h.assert('QR', sans.genererQr);

const avance = decisionCreation({ sansAvance: false, mode: 'paiement' });
h.assertEqual('avance statut', avance.statut, 'en_attente_paiement');
h.assert('avance sans confirmation immédiate', avance.envoyerConfirmation === false);
h.assert('avance avec lien', avance.creerLienPaiement);

h.exitIfFailed();
