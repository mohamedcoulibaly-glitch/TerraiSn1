const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const tmp = path.join(os.tmpdir(), `p07-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.WHATSAPP_MOCK = 'true';
process.env.JWT_SECRET = 'test-jwt-secret-mohamed';

const { createHarness } = require('../helpers/harness');
const { openDb, queryOne } = require('../helpers/fixtureDb');
const { registerJoueur, verifyOtpJoueur } = require('../../services/authAccountService');
const h = createHarness('p07');

async function cycle(db, body) {
  const registered = await registerJoueur(db, body);
  const otp = queryOne(db, 'SELECT code FROM auth_otps WHERE user_id = ? AND used = 0 ORDER BY id DESC LIMIT 1', [registered.userId]);
  const verified = await verifyOtpJoueur(db, { telephone: body.telephone, code: otp.code });
  const token = jwt.sign(verified.tokenPayload, process.env.JWT_SECRET);
  const me = jwt.verify(token, process.env.JWT_SECRET);
  const row = queryOne(db, 'SELECT nom, prenom, telephone_verified FROM users WHERE id = ?', [me.id]);
  return { id: me.id, row };
}

async function main() {
  const db = await openDb();
  const babacar = await cycle(db, { prenom: 'Babacar', nom: 'Sène', telephone: '771110001', password: 'secret1' });
  const autre = await cycle(db, { prenom: 'Awa', nom: 'Ndiaye', telephone: '771110002', password: 'secret1' });
  h.assert('ids distincts', babacar.id !== autre.id);
  h.assertEqual('Babacar', babacar.row.nom, 'Sène');
  h.assertEqual('Awa', autre.row.nom, 'Ndiaye');
  h.assertEqual('vérifié', Number(babacar.row.telephone_verified), 1);
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
