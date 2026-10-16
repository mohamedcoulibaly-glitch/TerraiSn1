const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const tmp = path.join(os.tmpdir(), `p17-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.WHATSAPP_MOCK = 'true';
process.env.PAYMENT_MODE = 'simulation';
process.env.E2E_MODE = '0';

const { createHarness } = require('../helpers/harness');
const { mountTestRoutes } = require('../../routes/testMode');
const { openDb, seedMonde, poserReservation, queryOne, runSql } = require('../helpers/fixtureDb');
const h = createHarness('p17');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function main() {
  const off = express();
  off.use(express.json());
  mountTestRoutes(off);
  off.use((_req, res) => res.status(404).end());
  const serverOff = await listen(off);
  const portOff = serverOff.address().port;
  const hidden = await fetch(`http://127.0.0.1:${portOff}/api/test/simulate-payment`, { method: 'POST' });
  h.assertEqual('404', hidden.status, 404);
  serverOff.close();

  process.env.E2E_MODE = '1';
  const db = await openDb();
  const monde = await seedMonde(db);
  const { reservationId } = poserReservation(db, { terrainId: monde.terrainAvance, joueurId: monde.joueurA });
  const ref = `TF-${reservationId}-E2E`;
  runSql(db, `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_paytech) VALUES (?, 5000, 'paytech', 'en_attente', ?)`, [reservationId, ref]);
  runSql(db, 'UPDATE reservations SET reference_paytech = ? WHERE id = ?', [ref, reservationId]);

  const on = express();
  on.use(express.json());
  mountTestRoutes(on);
  const serverOn = await listen(on);
  const port = serverOn.address().port;
  const sim = await fetch(`http://127.0.0.1:${port}/api/test/simulate-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reservation_id: reservationId }),
  });
  h.assertEqual('simulation 200', sim.status, 200);
  h.assertEqual('confirmé', queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [reservationId]).statut, 'confirme');
  serverOn.close();
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}
main().catch((e) => { console.error(e); process.exit(1); });
