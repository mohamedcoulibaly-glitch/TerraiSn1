/**
 * Tests unitaires — OTP téléphone + helpers JWT / rôles auth.
 * Usage: node scripts/test-otp-auth.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const tmpDb = path.join(os.tmpdir(), `terrainsn-otp-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.WHATSAPP_MOCK = 'true';
process.env.JWT_SECRET = 'test_jwt_secret_unit';
process.env.JWT_REFRESH_SECRET = 'test_jwt_refresh_unit';

const { createHarness } = require('../test/helpers/harness');
const {
  normalizeTelephone,
  isValidSenegalMobile,
  formatDisplayPhone,
  generateOtpCode,
  createAndSendOtp,
  findValidOtp,
  invalidateOtps,
} = require('../otpService');
const {
  genererAccessToken,
  genererRefreshToken,
  hashRefreshToken,
  profileTableFor,
  isBlockedStatut,
  requireRole,
  JWT_SECRET,
} = require('../middleware/auth');
const { getDb, runSql, queryOne } = require('../database');

const h = createHarness('unit-otp-auth');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function main() {
  // --- Téléphone ---
  h.assertEqual('normalize local 9', normalizeTelephone('77 123 45 67'), '221771234567');
  h.assertEqual('normalize +221', normalizeTelephone('+221771234567'), '221771234567');
  h.assertEqual('normalize 00221', normalizeTelephone('00221771234567'), '221771234567');
  h.assertEqual('normalize 0XXXXXXXXX', normalizeTelephone('0771234567'), '221771234567');
  h.assert('valid SN mobile', isValidSenegalMobile('778261225'));
  h.assert('invalid fixe', !isValidSenegalMobile('338211122'));
  h.assert('invalid court', !isValidSenegalMobile('77123'));
  h.assert(
    'format display',
    formatDisplayPhone('221778261225').includes('77') && formatDisplayPhone('221778261225').startsWith('+221'),
  );

  const code = generateOtpCode();
  h.assert('OTP 6 digits', /^\d{6}$/.test(code));

  // --- OTP en DB ---
  const db = await getDb();
  const userId = runSql(
    db,
    `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active)
     VALUES ('Test', 'OTP', 'otp@test.sn', 'x', '221778261225', 'joueur', 1)`,
  ).lastInsertRowid;

  const sent = await createAndSendOtp(db, {
    telephone: '77 826 12 25',
    userId,
    prenom: 'Test',
  });
  h.assertEqual('OTP telephone normalisé', sent.telephone, '221778261225');
  h.assert('OTP code présent', /^\d{6}$/.test(sent.code));

  const found = findValidOtp(db, '778261225', sent.code);
  h.assert('findValidOtp OK', Boolean(found.otp) && !found.error);

  const bad = findValidOtp(db, '778261225', '000000');
  h.assertEqual('code invalide', bad.error, 'Code invalide');

  await invalidateOtps(db, '221778261225');
  const used = findValidOtp(db, '778261225', sent.code);
  h.assertEqual('OTP invalidé', used.error, 'Code invalide');

  await h.assertThrowsAsync(
    'OTP numéro invalide',
    () => createAndSendOtp(db, { telephone: '123', prenom: 'X' }),
    'invalide',
  );

  // --- JWT ---
  const access = genererAccessToken({
    id: 1,
    role: 'joueur',
    email: 'a@b.c',
    telephone: '221771111111',
    accountType: 'user',
  });
  const decoded = jwt.verify(access, JWT_SECRET);
  h.assertEqual('access role', decoded.role, 'joueur');
  h.assertEqual('access id', decoded.id, 1);

  const refresh = genererRefreshToken({ id: 1, accountType: 'user' });
  h.assert('refresh token string', typeof refresh === 'string' && refresh.length > 20);
  const h1 = hashRefreshToken(refresh);
  const h2 = hashRefreshToken(refresh);
  h.assertEqual('hash refresh stable', h1, h2);
  h.assert('hash hex 64', /^[a-f0-9]{64}$/.test(h1));

  h.assertEqual('profileTable user', profileTableFor('user'), 'users');
  h.assertEqual('profileTable proprio', profileTableFor('proprietaire'), 'proprietaires');
  h.assertEqual('profileTable employe', profileTableFor('employe'), 'employes');

  h.assert('bloque', isBlockedStatut('bloque'));
  h.assert('suspendu', isBlockedStatut('suspendu'));
  h.assert('actif OK', !isBlockedStatut('actif'));

  // --- requireRole ---
  const guard = requireRole('gerant', 'super_admin');
  const resDeny = mockRes();
  let nextCalled = false;
  guard({ user: { role: 'joueur' } }, resDeny, () => {
    nextCalled = true;
  });
  h.assertEqual('requireRole refuse joueur', resDeny.statusCode, 403);
  h.assert('next non appelé', !nextCalled);

  const resOk = mockRes();
  nextCalled = false;
  guard({ user: { role: 'gerant' } }, resOk, () => {
    nextCalled = true;
  });
  h.assert('requireRole accepte gerant', nextCalled);

  const resSa = mockRes();
  nextCalled = false;
  guard({ user: { role: 'superadmin' } }, resSa, () => {
    nextCalled = true;
  });
  h.assert('requireRole normalise superadmin', nextCalled);

  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }
  h.exitIfFailed();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
