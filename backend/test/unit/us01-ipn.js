const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = path.join(os.tmpdir(), `us01-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.WHATSAPP_MOCK = 'true';
process.env.PAYMENT_MODE = 'simulation';

const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde, poserReservation, spies, queryOne } = require('../helpers/fixtureDb');
const { confirmerPaiementEtNotifier } = require('../../payments/flow');
const { verifyQrPayload } = require('../../domain/qrSignature');
const { executerReconciliation } = require('../../services/ipnReconciliation');
const { runSql } = require('../../database');

const h = createHarness('us01');

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const { reservationId } = poserReservation(db, {
    terrainId: monde.terrainAvance,
    joueurId: monde.joueurA,
    statut: 'en_attente_paiement',
  });
  const ref = `TF-${reservationId}-UNIT`;
  runSql(
    db,
    `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_paytech)
     VALUES (?, 5000, 'paytech', 'en_attente', ?)`,
    [reservationId, ref],
  );

  const spy = spies();
  const first = await confirmerPaiementEtNotifier(reservationId, ref, { ports: spy.ports });
  h.assertEqual('action confirm', first.action, 'confirm');
  const row = queryOne(db, 'SELECT statut, qr_code_payload, code_reservation FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('statut confirme', row.statut, 'confirme');
  h.assert('code présent', Boolean(row.code_reservation));
  h.assert('QR signé', verifyQrPayload(row.qr_code_payload).ok);
  h.assertEqual('un whatsapp', spy.calls.filter((c) => c[0] === 'wa').length, 1);
  h.assertEqual('un push', spy.calls.filter((c) => c[0] === 'push').length, 1);
  const paye = queryOne(db, "SELECT COUNT(*) AS n FROM paiements WHERE reservation_id = ? AND statut = 'paye'", [reservationId]);
  h.assertEqual('un paiement paye', Number(paye.n), 1);

  const second = await confirmerPaiementEtNotifier(reservationId, ref, { ports: spy.ports });
  h.assertEqual('second ipn', second.action, 'already_confirmed');
  h.assertEqual('whatsapp toujours 1', spy.calls.filter((c) => c[0] === 'wa').length, 1);

  const missing = await confirmerPaiementEtNotifier(999999, 'TF-0-X', { ports: spy.ports });
  h.assertEqual('resa absente', missing.action, 'missing');

  const { reservationId: id2 } = poserReservation(db, {
    terrainId: monde.terrainAvance,
    joueurId: monde.joueurB,
    date: '2026-11-03',
    heureDebut: '20:00',
    heureFin: '21:00',
  });
  const ref2 = `TF-${id2}-FAIL`;
  runSql(db, `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_paytech, created_at)
    VALUES (?, 5000, 'paytech', 'en_attente', ?, '2020-01-01 00:00:00')`, [id2, ref2]);
  const alertes = [];
  await executerReconciliation(db, {
    gateway: { async statutPaiement() { return 'failed'; } },
    confirmer: async () => { throw new Error('ne doit pas confirmer'); },
    alerter: async (code) => { alertes.push(code); },
    seuilMs: 0,
  });
  h.assert('alerte ipn_echec', alertes.includes('ipn_echec'));
  const still = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [id2]);
  h.assertEqual('reste en attente', still.statut, 'en_attente_paiement');

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
