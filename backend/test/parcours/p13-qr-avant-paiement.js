const { createHarness } = require('../helpers/harness');
const { decisionCreation } = require('../../domain/reservationState');
const { assertScanSignature } = require('../../domain/qrSignature');
process.env.QR_HMAC_SECRET = 'test-qr-secret';
const h = createHarness('p13');
const decision = decisionCreation({ mode: 'paiement' });
h.assert('pas de payload', decision.genererQr === false);
h.assertThrows('rien à scanner', () => assertScanSignature(''));
h.exitIfFailed();
