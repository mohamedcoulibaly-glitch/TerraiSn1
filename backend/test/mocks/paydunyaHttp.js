/**
 * Mock HTTP PayDunya (sandbox) — isole la logique métier sans appel réseau.
 */
const crypto = require('crypto');
const { MOHAMED } = require('../helpers/mohamed');

function hashDepuisMasterKey(masterKey) {
  return crypto.createHash('sha512').update(String(masterKey || '')).digest('hex');
}

/**
 * Construit un payload IPN / confirm réaliste pour Mohamed.
 */
function fabriquerPayloadConfirme({
  token = 'pd_tok_mohamed_sandbox_001',
  reservationId,
  refCommand,
  totalAmount = MOHAMED.montants.avancePayin,
  status = 'completed',
  masterKey = process.env.PAYDUNYA_MASTER_KEY || 'test-master-key-mohamed',
} = {}) {
  const hash = hashDepuisMasterKey(masterKey);
  return {
    response_code: '00',
    response_text: 'Checkout Invoice confirmed successfully',
    hash,
    status,
    invoice: {
      token,
      total_amount: totalAmount,
      description: `Avance réservation — Arena Mohamed Parcelles (#${reservationId})`,
    },
    custom_data: {
      reservation_id: String(reservationId || ''),
      ref_command: refCommand || `TF-${reservationId}-MOH-PAYIN`,
    },
    customer: {
      name: MOHAMED.nom,
      phone: MOHAMED.telephoneLocal9,
    },
  };
}

function fabriquerBodyIpn(payload) {
  return { data: payload };
}

function jsonResponse(status, payload, ok = status >= 200 && status < 300) {
  const body = JSON.stringify(payload);
  return {
    ok,
    status,
    async json() {
      return payload;
    },
    async text() {
      return body;
    },
  };
}

/**
 * Installe un mock global de `fetch` pour les endpoints PayDunya.
 * @returns {{ calls: Array, restore: Function, setFailConfirm: Function, setFailPayout: Function }}
 */
function installerFetchMock(options = {}) {
  const calls = [];
  let failConfirm = false;
  let failPayout = false;
  let failCheckout = false;
  const originalFetch = global.fetch;

  global.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, method, body });

    if (u.includes('/checkout-invoice/create')) {
      if (failCheckout) {
        return jsonResponse(500, { response_code: '01', response_text: 'Sandbox unavailable' }, false);
      }
      return jsonResponse(200, {
        response_code: '00',
        response_text: 'https://paydunya.com/sandbox/checkout/mohamed-demo',
        token: options.token || 'pd_tok_mohamed_sandbox_001',
      });
    }

    if (u.includes('/checkout-invoice/confirm/')) {
      if (failConfirm) {
        return jsonResponse(500, { response_code: '01', response_text: 'Confirm failed' }, false);
      }
      const token = decodeURIComponent(u.split('/confirm/')[1] || '');
      return jsonResponse(
        200,
        fabriquerPayloadConfirme({
          token,
          reservationId: options.reservationId,
          refCommand: options.refCommand,
          totalAmount: options.totalAmount,
          status: options.status || 'completed',
        }),
      );
    }

    if (u.includes('/disburse/get-invoice') || u.includes('/direct-pay/credit-account')) {
      if (failPayout) {
        return jsonResponse(500, { response_code: '01', response_text: 'Payout failed' }, false);
      }
      if (u.includes('/disburse/get-invoice')) {
        return jsonResponse(200, {
          response_code: '00',
          disburse_token: options.disburseToken || 'pd_disburse_mohamed_001',
        });
      }
      return jsonResponse(200, {
        response_code: '00',
        response_text: 'Credit successful',
        transaction_id: `PO-PD-MOH-${Date.now()}`,
      });
    }

    if (u.includes('/disburse/submit-invoice')) {
      if (failPayout) {
        return jsonResponse(500, {
          response_code: '01',
          status: 'failed',
          response_text: 'Payout failed',
        }, false);
      }
      return jsonResponse(200, {
        response_code: '00',
        status: 'success',
        response_text: 'Transaction completed successfully',
        transaction_id: `TFA-TX-MOH-${Date.now()}`,
        provider_ref: `WAVE-${Date.now()}`,
      });
    }

    return jsonResponse(404, { response_text: `Unmocked URL: ${u}` }, false);
  };

  return {
    calls,
    restore() {
      global.fetch = originalFetch;
    },
    setFailConfirm(v) {
      failConfirm = Boolean(v);
    },
    setFailPayout(v) {
      failPayout = Boolean(v);
    },
    setFailCheckout(v) {
      failCheckout = Boolean(v);
    },
  };
}

/**
 * Stub direct des méthodes du module paydunyaService (sans fetch).
 */
function stubConfirmerFacture(paydunyaService, payloadFactory) {
  const original = paydunyaService.confirmerFacture;
  paydunyaService.confirmerFacture = async (token) => payloadFactory(token);
  return () => {
    paydunyaService.confirmerFacture = original;
  };
}

module.exports = {
  hashDepuisMasterKey,
  fabriquerPayloadConfirme,
  fabriquerBodyIpn,
  installerFetchMock,
  stubConfirmerFacture,
};
