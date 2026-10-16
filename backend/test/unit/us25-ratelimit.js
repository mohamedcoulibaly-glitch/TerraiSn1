process.env.AUTH_RATE_LIMIT = '1';
process.env.NODE_ENV = 'test';

const { createHarness } = require('../helpers/harness');
const { evaluer, delaiApresBlocage } = require('../../domain/rateLimitPolicy');
const { rateLimit, _resetRateLimitBuckets } = require('../../middleware/rateLimit');
const { validateRegisterBody } = require('../../middleware/validate');

const h = createHarness('us25');

const now = 1_000_000;
let bucket = null;
for (let i = 0; i < 5; i += 1) {
  const step = evaluer(bucket, { now, windowMs: 1000, max: 5, increment: true });
  bucket = step.bucket;
  h.assert(`sous plafond ${i + 1}`, step.limited === false);
}
const blocked = evaluer(bucket, { now: now + 1, windowMs: 1000, max: 5, increment: true });
h.assert('6e bloqué', blocked.limited);
h.assert('fenêtre doublée', delaiApresBlocage(1000, 1) === 2000);
h.assert('second blocage plus long', delaiApresBlocage(1000, 2) > delaiApresBlocage(1000, 1));

_resetRateLimitBuckets();
const mw = rateLimit({ windowMs: 60_000, max: 2, keyPrefix: 'us25' });
function fakeRes() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json() { return this; },
    on() { return this; },
  };
}
async function hit() {
  const res = fakeRes();
  await new Promise((resolve) => {
    mw({ ip: '9.9.9.9', body: {} }, res, () => resolve());
    if (res.statusCode === 429) resolve();
  });
  return res.statusCode;
}

async function main() {
  h.assertEqual('1', await hit(), 200);
  h.assertEqual('2', await hit(), 200);
  h.assertEqual('3', await hit(), 429);

  h.assertThrows(
    'mot de passe court',
    () => validateRegisterBody({ nom: 'A', telephone: '771234567', password: '12' }),
    'Mot de passe',
  );
  h.exitIfFailed();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
