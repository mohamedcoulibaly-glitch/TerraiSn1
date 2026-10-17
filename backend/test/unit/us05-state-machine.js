const { createHarness } = require('../helpers/harness');
const { transition, decisionCreation, peutConfirmer } = require('../../domain/reservationState');

const h = createHarness('us05');

h.assert('en_attente_paiement confirmable', peutConfirmer('en_attente_paiement'));
h.assert('legacy en_attente confirmable', peutConfirmer('en_attente'));
h.assert('annule non confirmable', !peutConfirmer('annule'));

h.assert('paiement joueur sans QR', decisionCreation({ mode: 'paiement' }).genererQr === false);
h.assertEqual('statut création joueur', decisionCreation({ mode: 'paiement' }).statut, 'en_attente_paiement');
h.assert('pas de confirmation à la création', decisionCreation({ mode: 'paiement' }).envoyerConfirmation === false);
h.assert('lien seulement en paiement', decisionCreation({ mode: 'paiement' }).creerLienPaiement === true);

h.assertEqual('sans avance confirmé', decisionCreation({ sansAvance: true, mode: 'bloquer' }).statut, 'confirme');
h.assert('sans avance notifie', decisionCreation({ sansAvance: true }).envoyerConfirmation === true);
h.assert('sans avance sans lien', decisionCreation({ sansAvance: true }).creerLienPaiement === false);

h.assert('manuel sans lien', decisionCreation({ mode: 'manuel' }).creerLienPaiement === false);
h.assertEqual('manuel en attente', decisionCreation({ mode: 'manuel' }).statut, 'en_attente_paiement');
h.assert('bloquer confirme sans notif sans-avance', decisionCreation({ mode: 'bloquer' }).envoyerConfirmation === false);
h.assertEqual('bloquer statut', decisionCreation({ mode: 'bloquer' }).statut, 'confirme');

h.assert('transition vers confirme', transition('en_attente_paiement', 'confirme').ok);
h.assert('legacy vers confirme', transition('en_attente', 'confirme').ok);
h.assertEqual('annule vers confirme', transition('annule', 'confirme').code, 'TRANSITION_INTERDITE');
h.assertEqual('expire vers confirme', transition('expire', 'confirme').code, 'TRANSITION_INTERDITE');
h.assertEqual('match vers confirme', transition('match_joue', 'confirme').code, 'TRANSITION_INTERDITE');
h.assertEqual('double confirme', transition('confirme', 'confirme').code, 'ALREADY_CONFIRMED');
h.assert('confirme vers match', transition('confirme', 'match_joue').ok);

h.exitIfFailed();
