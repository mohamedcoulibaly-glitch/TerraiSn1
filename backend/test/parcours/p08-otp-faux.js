const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p08-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.WHATSAPP_MOCK = 'true';

const { createHarness } = require('../helpers/harness');
const { openDb, queryOne } = require('../helpers/fixtureDb');
const { registerJoueur, verifyOtpJoueur } = require('../../services/authAccountService');
const h = createHarness('p08');

async function main() {
  const db = await openDb();
  const registered = await registerJoueur(db, { prenom: 'A', nom: 'B', telephone: '771110009', password: 'secret1' });
  const bad = await verifyOtpJoueur(db, { telephone: '771110009', code: '111111' });
  h.assertEqual('otp refusé', bad.status, 400);
  h.assert('pas de token', !bad.tokenPayload);
  const row = queryOne(db, 'SELECT telephone_verified FROM users WHERE id = ?', [registered.userId]);
  h.assertEqual('non vérifié', Number(row.telephone_verified), 0);
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
