const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p02-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.PAYMENT_MODE = 'simulation';
process.env.WHATSAPP_MOCK = 'true';

const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde, poserReservation, spies, queryOne, runSql } = require('../helpers/fixtureDb');
const { confirmerPaiementEtNotifier } = require('../../payments/flow');
const { verifyQrPayload } = require('../../domain/qrSignature');
const h = createHarness('p02');

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const { reservationId } = poserReservation(db, { terrainId: monde.terrainAvance, joueurId: monde.joueurA });
  const ref = `TF-${reservationId}-P02`;
  runSql(db, `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_paytech) VALUES (?, 5000, 'paytech', 'en_attente', ?)`, [reservationId, ref]);
  const spy = spies();
  const result = await confirmerPaiementEtNotifier(reservationId, ref, { ports: spy.ports });
  h.assertEqual('confirm', result.action, 'confirm');
  const row = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('statut', row.statut, 'confirme');
  h.assert('QR', verifyQrPayload(row.qr_code_payload).ok);
  h.assertEqual('wa', spy.calls.filter((c) => c[0] === 'wa').length, 1);
  h.assertEqual('push', spy.calls.filter((c) => c[0] === 'push').length, 1);
  h.assertEqual('sse', spy.events.filter((e) => e.type === 'reservation_confirmee').length, 1);
  const dus = queryOne(db, 'SELECT COUNT(*) AS n FROM dus WHERE reservation_id = ?', [reservationId]);
  h.assert('un dû', Number(dus.n) >= 1);
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
