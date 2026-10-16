const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p06-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.PAYMENT_MODE = 'simulation';
process.env.WHATSAPP_MOCK = 'true';

const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde, poserReservation, queryOne, runSql } = require('../helpers/fixtureDb');
const { confirmerPaiementEtNotifier } = require('../../payments/flow');
const h = createHarness('p06');

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const { reservationId } = poserReservation(db, { terrainId: monde.terrainAvance, joueurId: monde.joueurA, telephone: '221771110099' });
  const ref = `TF-${reservationId}-P06`;
  runSql(db, `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_paytech) VALUES (?, 5000, 'paytech', 'en_attente', ?)`, [reservationId, ref]);
  const ports = {
    async confirmationJoueur() { throw new Error('wa down'); },
    async pushJoueur() {},
    async pushGerant() {},
    publish() {},
  };
  await confirmerPaiementEtNotifier(reservationId, ref, { ports });
  const row = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('reste confirme', row.statut, 'confirme');
  const job = queryOne(db, "SELECT id FROM notification_retry_queue WHERE type = 'confirmation'");
  h.assert('file retry', Boolean(job));
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
