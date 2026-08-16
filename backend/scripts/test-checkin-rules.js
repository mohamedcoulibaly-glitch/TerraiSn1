/**
 * Tests règles métier check-in / QR (sans WhatsApp).
 * Usage: node scripts/test-checkin-rules.js
 */
const assert = require('assert');
const {
  calculerFenetreCheckIn,
  estDansLaFenetreCheckIn,
  assertFenetreScanQr,
  DEFAULT_FENETRE_RETARD_MIN,
} = require('../services/checkInFenetre');
const {
  serializeQrPayload,
  parseQrPayload,
  assertQrMatchesReservation,
} = require('../services/qrPayload');

const base = {
  date: '2026-08-10',
  heure_debut: '18:00',
  heure_fin: '19:00',
  fenetre_retard: 30,
};

const { debutFenetre, finFenetre } = calculerFenetreCheckIn(base);
assert.strictEqual(new Date(debutFenetre).getHours(), 17, 'debut = 17h');
assert.strictEqual(new Date(finFenetre).getHours(), 21, 'fin heures = 21');
assert.strictEqual(new Date(finFenetre).getMinutes(), 30, 'fin minutes = 30');

assert.strictEqual(estDansLaFenetreCheckIn(base, new Date('2026-08-10T16:59:00').getTime()), false);
assert.strictEqual(estDansLaFenetreCheckIn(base, new Date('2026-08-10T17:00:00').getTime()), true);
assert.strictEqual(estDansLaFenetreCheckIn(base, new Date('2026-08-10T21:30:00').getTime()), true);
assert.strictEqual(estDansLaFenetreCheckIn(base, new Date('2026-08-10T21:31:00').getTime()), false);

let earlyOk = false;
try {
  assertFenetreScanQr(base, new Date('2026-08-10T16:00:00').getTime());
} catch (e) {
  earlyOk = e.code === 'QR_SCAN_TOO_EARLY';
}
assert.ok(earlyOk, 'trop tôt → QR_SCAN_TOO_EARLY');

let expiredOk = false;
try {
  assertFenetreScanQr(base, new Date('2026-08-10T22:00:00').getTime());
} catch (e) {
  expiredOk = e.code === 'QR_SCAN_EXPIRED';
}
assert.ok(expiredOk, 'trop tard → QR_SCAN_EXPIRED');

const json = serializeQrPayload({
  reservation_id: 42,
  code: 'TF-482910',
  creneau_id: 17,
  terrain_id: 3,
  expire_at: 1720000000,
});
const parsed = parseQrPayload(json);
assert.strictEqual(parsed.ok, true);
assert.strictEqual(parsed.reservation_id, 42);
assert.strictEqual(parsed.code, 'TF-482910');

assertQrMatchesReservation(parsed, {
  id: 42,
  code_reservation: 'TF-482910',
  terrain_id: 3,
  creneau_id: 17,
});

let mismatch = false;
try {
  assertQrMatchesReservation(parsed, {
    id: 99,
    code_reservation: 'TF-482910',
    terrain_id: 3,
    creneau_id: 17,
  });
} catch (e) {
  mismatch = e.code === 'QR_MISMATCH';
}
assert.ok(mismatch, 'mauvais reservation_id → QR_MISMATCH');

let wrongTerrain = false;
try {
  assertQrMatchesReservation(parsed, {
    id: 42,
    code_reservation: 'TF-482910',
    terrain_id: 9,
    creneau_id: 17,
  });
} catch (e) {
  wrongTerrain = e.code === 'QR_WRONG_TERRAIN';
}
assert.ok(wrongTerrain, 'mauvais terrain → QR_WRONG_TERRAIN');

const legacy = parseQrPayload('TF-MOH-2H');
assert.strictEqual(legacy.ok, true);
assert.strictEqual(legacy.format, 'code');

assert.strictEqual(DEFAULT_FENETRE_RETARD_MIN, 30);
console.log('OK — toutes les règles check-in / QR métier passent');
