const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `us30-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.PAYMENT_MODE = 'production';
process.env.PAYTECH_MOCK = 'false';
process.env.PAYTECH_ENABLED = 'true';
process.env.PAYTECH_ENV = 'test';
process.env.PAYTECH_API_KEY = 'test-key';
process.env.PAYTECH_API_SECRET = 'test-secret';
process.env.APP_DOMAIN = 'https://terraisn1-1.onrender.com';
process.env.PAYTECH_IPN_URL = 'https://terraisn1-1.onrender.com/webhook/paytech';
process.env.PAYTECH_SUCCESS_URL = 'https://terraisn1-1.onrender.com/paytech/success';
process.env.PAYTECH_CANCEL_URL = 'https://terraisn1-1.onrender.com/paytech/cancel';
process.env.WHATSAPP_MOCK = 'true';

const { createHarness } = require('../helpers/harness');
const { openDb, queryOne, runSql } = require('../helpers/fixtureDb');
const { seedMonde, poserReservation } = require('../helpers/fixtureDb');
const { installerPaytechFetchMock } = require('../mocks/paytechHttp');
const paytechService = require('../../paytechService');

const h = createHarness('us30');

async function main() {
  const mock = installerPaytechFetchMock({ mode: 'success' });
  const db = await openDb();
  const monde = await seedMonde(db);

  // Checkout OK
  const { reservationId } = poserReservation(db, { terrainId: monde.terrainAvance, joueurId: monde.joueurA });
  const resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  const payment = await paytechService.creerLienPaiement(resa, { preferredChannel: 'wave' });
  h.assert('redirect https', /^https:\/\//i.test(payment.redirectUrl || ''));
  h.assert('reference', Boolean(payment.reference));
  const pending = queryOne(
    db,
    "SELECT * FROM paiements WHERE reservation_id = ? AND statut = 'en_attente'",
    [reservationId],
  );
  h.assert('ligne pending', Boolean(pending));

  // Checkout échec → code PAYTECH_CHECKOUT_FAILED
  mock.setMode('auth_fail_401');
  const { reservationId: id2 } = poserReservation(db, {
    terrainId: monde.terrainAvance,
    joueurId: monde.joueurB,
    date: '2026-11-03',
    heureDebut: '19:00',
    heureFin: '20:00',
  });
  const resa2 = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [id2]);
  let errCode = null;
  try {
    await paytechService.creerLienPaiement(resa2, { preferredChannel: 'om' });
  } catch (e) {
    errCode = e.code;
  }
  h.assertEqual('code checkout fail', errCode, 'PAYTECH_CHECKOUT_FAILED');

  mock.restore();
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
