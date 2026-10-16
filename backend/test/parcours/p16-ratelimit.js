process.env.AUTH_RATE_LIMIT = '1';
const { createHarness } = require('../helpers/harness');
const { rateLimit, _resetRateLimitBuckets } = require('../../middleware/rateLimit');
const h = createHarness('p16');

function fakeRes() {
  const handlers = {};
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    on(event, fn) { handlers[event] = fn; return this; },
    finish(code) { this.statusCode = code; if (handlers.finish) handlers.finish(); },
  };
}

async function main() {
  _resetRateLimitBuckets();
  const mw = rateLimit({ windowMs: 60_000, max: 5, keyPrefix: 'auth', countFailuresOnly: true });
  const req = { ip: '10.0.0.8', body: { telephone: '771234567' } };
  for (let i = 0; i < 5; i += 1) {
    const res = fakeRes();
    await new Promise((resolve) => mw(req, res, resolve));
    res.finish(401);
    h.assert(`essai ${i + 1} passe le middleware`, res.statusCode === 401);
  }
  const blocked = fakeRes();
  let called = false;
  await new Promise((resolve) => {
    mw(req, blocked, () => { called = true; resolve(); });
    if (blocked.statusCode === 429) resolve();
  });
  h.assert('6e 429', blocked.statusCode === 429 && !called);
  h.assert('message stable', blocked.body && blocked.body.error.includes('Trop de tentatives'));
  h.exitIfFailed();
}
main().catch((e) => { console.error(e); process.exit(1); });
