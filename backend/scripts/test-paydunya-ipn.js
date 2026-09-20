/**
 * Tests unitaires PayDunya : hash IPN + parsing payload (sans appel réseau).
 * Usage : node scripts/test-paydunya-ipn.js
 */
process.env.PAYDUNYA_MASTER_KEY = process.env.PAYDUNYA_MASTER_KEY || 'test-master-key-for-hash';
process.env.PAYDUNYA_PRIVATE_KEY = process.env.PAYDUNYA_PRIVATE_KEY || 'test_private_placeholder';
process.env.PAYDUNYA_TOKEN = process.env.PAYDUNYA_TOKEN || 'token_placeholder';
process.env.PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || 'paydunya';
process.env.PAYMENT_GATEWAY = 'paydunya';
process.env.PAYMENT_MODE = 'production';
process.env.PAYTECH_MOCK = 'false';

const crypto = require('crypto');
const paydunya = require('../paydunyaService');
const { activeGateway, methodePaiement, targetProvider } = require('../lib/paymentGateway');
const paymentService = require('../services/payment');

let failed = 0;

function assert(name, cond) {
  if (!cond) {
    console.error('FAIL', name);
    failed += 1;
  } else {
    console.log('OK', name);
  }
}

const hash = crypto.createHash('sha512').update(process.env.PAYDUNYA_MASTER_KEY).digest('hex');
assert('hash_valid', paydunya.verifierHashPaydunya(hash));
assert('hash_invalid', !paydunya.verifierHashPaydunya('00'.repeat(64)));
assert('gateway_paydunya', activeGateway() === 'paydunya');
assert('provider_paydunya', targetProvider() === 'paydunya');
assert('methode_paydunya', methodePaiement() === 'paydunya');
assert('adapter_paydunya', paymentService.getAdapter().name === 'paydunya');

const nested = paydunya.extrairePayloadIpn({
  data: {
    hash,
    status: 'completed',
    invoice: { token: 'test_abc', total_amount: 4000 },
    custom_data: { reservation_id: '42', ref_command: 'TF-42-1' },
  },
});
assert('ipn_nested_status', nested.status === 'completed');
assert('ipn_nested_token', nested.invoice.token === 'test_abc');
assert('ipn_nested_resa', nested.custom_data.reservation_id === '42');

const asJson = paydunya.extrairePayloadIpn({
  data: JSON.stringify({
    hash,
    status: 'completed',
    invoice: { token: 'test_json' },
  }),
});
assert('ipn_json_string', asJson.invoice.token === 'test_json');

if (failed) {
  console.error(`\n${failed} test(s) en échec`);
  process.exit(1);
}
console.log('\nTous les tests PayDunya IPN OK');
