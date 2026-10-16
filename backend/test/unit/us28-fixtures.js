const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const tmp = path.join(os.tmpdir(), `us28-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.WHATSAPP_MOCK = 'true';
process.env.PAYMENT_MODE = 'simulation';
process.env.E2E_MODE = '0';

const { createHarness } = require('../helpers/harness');
const { seedE2E } = require('../../scripts/seed-e2e');
const { queryAll } = require('../../database');
const { mountTestRoutes } = require('../../routes/testMode');

const h = createHarness('us28');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function post(server, urlPath) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return res.status;
}

async function main() {
  await seedE2E();
  await seedE2E();
  const db = await require('../../database').getDb();
  const joueurs = queryAll(db, "SELECT id FROM users WHERE email = 'e2e.joueur@terrainsn.test'");
  h.assertEqual('seed idempotent', joueurs.length, 1);

  const off = express();
  off.use(express.json());
  mountTestRoutes(off);
  off.use((_req, res) => res.status(404).json({ error: 'absent' }));
  const serverOff = await listen(off);
  h.assertEqual('404 sans E2E_MODE', await post(serverOff, '/api/test/simulate-payment'), 404);
  serverOff.close();

  process.env.E2E_MODE = '1';
  const on = express();
  on.use(express.json());
  mountTestRoutes(on);
  const serverOn = await listen(on);
  const missing = await fetch(`http://127.0.0.1:${serverOn.address().port}/api/test/simulate-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reservation_id: 99999 }),
  });
  h.assertEqual('simulation résa absente', missing.status, 404);
  serverOn.close();

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
