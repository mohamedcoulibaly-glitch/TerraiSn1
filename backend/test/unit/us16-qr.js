const { createHarness } = require('../helpers/harness');
const { signQrPayload, verifyQrPayload, assertScanSignature } = require('../../domain/qrSignature');
const { assertQrMatchesReservation, parseQrPayload } = require('../../services/qrPayload');
const { assertFenetreScanQr } = require('../../services/checkInFenetre');
const { decisionCreation } = require('../../domain/reservationState');

process.env.QR_HMAC_SECRET = 'test-qr-secret';

const h = createHarness('us16');

h.assert('pas de QR avant paiement', decisionCreation({ mode: 'paiement' }).genererQr === false);

const raw = signQrPayload({
  reservation_id: 7,
  code: 'TF-100001',
  creneau_id: 3,
  terrain_id: 2,
  expire_at: 1893456000,
});
const ok = verifyQrPayload(raw);
h.assert('signature OK', ok.ok);
const reservation = {
  id: 7,
  code_reservation: 'TF-100001',
  creneau_id: 3,
  terrain_id: 2,
  statut: 'confirme',
};
assertScanSignature(raw);
assertQrMatchesReservation(ok, reservation);
h.assert('match', true);

const altered = raw.replace('TF-100001', 'TF-100002');
h.assert('altération refusée', verifyQrPayload(altered).ok === false);

h.assertThrows('scan non signé', () => assertScanSignature('TF-100001'), 'QR');

let wrong = false;
try {
  assertQrMatchesReservation(ok, { ...reservation, terrain_id: 99 });
} catch (error) {
  wrong = error.code === 'QR_WRONG_TERRAIN';
}
h.assert('mauvais terrain', wrong);

const legacy = parseQrPayload('TF-100001');
h.assert('parse legacy encore possible', legacy.ok && legacy.format === 'code');
h.assertThrows('scan legacy refusé', () => assertScanSignature('TF-100001'));

let early = false;
try {
  assertFenetreScanQr({
    date: '2026-08-10',
    heure_debut: '18:00',
    heure_fin: '19:00',
    fenetre_retard: 30,
  }, new Date('2026-08-10T10:00:00').getTime());
} catch (error) {
  early = error.code === 'QR_SCAN_TOO_EARLY';
}
h.assert('hors fenêtre', early);

h.exitIfFailed();
