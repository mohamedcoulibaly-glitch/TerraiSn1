const { createHarness } = require('../helpers/harness');
const { signQrPayload, assertScanSignature } = require('../../domain/qrSignature');
const { assertQrMatchesReservation } = require('../../services/qrPayload');
const { assertFenetreScanQr } = require('../../services/checkInFenetre');

process.env.QR_HMAC_SECRET = 'test-qr-secret';
const h = createHarness('p12');

const raw = signQrPayload({
  reservation_id: 1, code: 'TF-1', creneau_id: 1, terrain_id: 1, expire_at: 1,
});
const reservation = { id: 1, code_reservation: 'TF-1', creneau_id: 1, terrain_id: 1, statut: 'confirme' };

let early = false;
try {
  assertFenetreScanQr({ date: '2026-08-10', heure_debut: '18:00', heure_fin: '19:00' }, new Date('2026-08-10T08:00:00').getTime());
} catch (error) {
  early = error.code === 'QR_SCAN_TOO_EARLY';
}
h.assert('hors fenêtre', early);

h.assertThrows('altéré', () => assertScanSignature(raw.replace('TF-1', 'TF-9')));

let terrain = false;
try {
  assertQrMatchesReservation(assertScanSignature(raw), { ...reservation, terrain_id: 50 });
} catch (error) {
  terrain = error.code === 'QR_WRONG_TERRAIN';
}
h.assert('mauvais terrain', terrain);
h.assertEqual('statut inchangé côté domaine', reservation.statut, 'confirme');
h.exitIfFailed();
