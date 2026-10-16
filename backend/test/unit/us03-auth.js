const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const tmp = path.join(os.tmpdir(), `us03-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.WHATSAPP_MOCK = 'true';
process.env.JWT_SECRET = 'test-jwt-secret-mohamed';

const { createHarness } = require('../helpers/harness');
const { openDb, queryOne, queryAll } = require('../helpers/fixtureDb');
const { registerJoueur, verifyOtpJoueur } = require('../../services/authAccountService');

const h = createHarness('us03');

async function main() {
  const db = await openDb();
  const registered = await registerJoueur(db, {
    prenom: 'Babacar',
    nom: 'Sène',
    telephone: '771234567',
    password: 'secret1',
  });
  h.assertEqual('register 201', registered.status, 201);
  const user = queryOne(db, 'SELECT * FROM users WHERE id = ?', [registered.userId]);
  h.assertEqual('nom', user.nom, 'Sène');
  h.assertEqual('prenom', user.prenom, 'Babacar');
  h.assertEqual('non vérifié', Number(user.telephone_verified), 0);

  const audit = queryOne(db, "SELECT * FROM auth_audit WHERE action = 'register' AND user_id = ?", [user.id]);
  h.assert('audit register', Boolean(audit));
  h.assert('pas de mot de passe dans audit', !String(audit.meta || '').includes('secret1'));

  const otp = queryOne(db, 'SELECT code FROM auth_otps WHERE user_id = ? AND used = 0 ORDER BY id DESC LIMIT 1', [user.id]);
  const bad = await verifyOtpJoueur(db, { telephone: '771234567', code: '000000' });
  h.assertEqual('otp faux', bad.status, 400);
  const still = queryOne(db, 'SELECT telephone_verified FROM users WHERE id = ?', [user.id]);
  h.assertEqual('toujours non vérifié', Number(still.telephone_verified), 0);

  const ok = await verifyOtpJoueur(db, { telephone: '771234567', code: otp.code });
  h.assertEqual('verify 200', ok.status, 200);
  h.assertEqual('token id', ok.tokenPayload.id, user.id);
  const token = jwt.sign(ok.tokenPayload, process.env.JWT_SECRET);
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  h.assertEqual('jwt sub id', decoded.id, user.id);
  const verified = queryOne(db, 'SELECT telephone_verified FROM users WHERE id = ?', [user.id]);
  h.assertEqual('vérifié', Number(verified.telephone_verified), 1);

  let conflict = false;
  try {
    await registerJoueur(db, { prenom: 'X', nom: 'Y', telephone: '771234567', password: 'secret1' });
  } catch (error) {
    conflict = error.statusCode === 409;
  }
  h.assert('téléphone déjà vérifié 409', conflict);

  const other = await registerJoueur(db, {
    prenom: 'Awa', nom: 'Ndiaye', telephone: '772223344', password: 'secret1',
  });
  h.assert('autre compte', other.userId !== user.id);
  const rows = queryAll(db, 'SELECT id FROM users');
  h.assert('deux users', rows.length >= 2);

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
