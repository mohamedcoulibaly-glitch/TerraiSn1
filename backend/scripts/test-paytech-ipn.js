require('dotenv').config();
const crypto = require('crypto');
const paytech = require('../paytechService');

const apiKey = process.env.PAYTECH_API_KEY;
const apiSecret = process.env.PAYTECH_API_SECRET;
const ref = 'TF-42-123';
const amount = 5000;
let failed = 0;

function assert(name, cond) {
  if (!cond) {
    console.error('FAIL', name);
    failed += 1;
  } else {
    console.log('OK', name);
  }
}

const message = `${amount}|${ref}|${apiKey}`;
const hmac = crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
assert('hmac_valid', paytech.verifierIpnPaytech({
  hmac_compute: hmac,
  item_price: amount,
  final_item_price: amount,
  ref_command: ref,
}));
assert('hmac_invalid', !paytech.verifierIpnPaytech({
  hmac_compute: '00'.repeat(32),
  item_price: amount,
  ref_command: ref,
}));

const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
const secretHash = crypto.createHash('sha256').update(apiSecret).digest('hex');
assert('sha256_keys', paytech.verifierIpnPaytech({
  api_key_sha256: keyHash,
  api_secret_sha256: secretHash,
}));
assert('sha256_keys_bad', !paytech.verifierIpnPaytech({
  api_key_sha256: keyHash,
  api_secret_sha256: '11'.repeat(32),
}));

const encoded = Buffer.from(JSON.stringify({ reservation_id: 42 }), 'utf8').toString('base64');
assert('custom_b64', paytech.decoderCustomField(encoded).reservation_id === 42);
assert('custom_json', paytech.decoderCustomField('{"reservation_id":7}').reservation_id === 7);

(async () => {
  try {
    const r = await paytech.creerLienPaiement({
      id: 999010,
      terrain_nom: 'Test IPN',
      terrain_id: 1,
      acompte: 1000,
      montant_avance: 1000,
      montant: 5000,
    });
    assert('lien_paytech', String(r.redirectUrl).includes('paytech.sn/payment/checkout/'));
    console.log('URL', r.redirectUrl);
  } catch (e) {
    console.error('FAIL lien', e.message);
    failed += 1;
  }
  if (failed) {
    console.error(`\n${failed} test(s) en échec`);
    process.exit(1);
  }
  console.log('\nTous les tests IPN OK');
})();
