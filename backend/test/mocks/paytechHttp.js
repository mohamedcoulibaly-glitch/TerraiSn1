/**
 * Mock HTTP PayTech (pay-in / refund / payout) — isolation totale, zéro appel réseau.
 */
const crypto = require('crypto');

function jsonResponse(status, payload, ok = status >= 200 && status < 300) {
  const body = JSON.stringify(payload);
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: { get: () => 'application/json' },
    async json() {
      return payload;
    },
    async text() {
      return body;
    },
  };
}

/**
 * Installe un mock strict de `global.fetch` pour les endpoints PayTech.
 * @param {object} [options]
 * @returns {{ calls: Array, restore: Function, setMode: Function, setNextError: Function, lastCheckoutBody: Function, lastCheckoutHeaders: Function }}
 */
function installerPaytechFetchMock(options = {}) {
  const calls = [];
  let mode = options.mode || 'success';
  let nextError = null;
  let tokenSeq = 0;
  const originalFetch = global.fetch;

  const defaultSuccess = {
    success: 1,
    token: options.token || 'pt_tok_unit_paytech_001',
    redirect_url:
      options.redirectUrl || 'https://paytech.sn/payment/checkout/pt_tok_unit_paytech_001',
    ref_command: options.refCommand || null,
  };

  global.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || 'GET').toUpperCase();
    let body = null;
    if (init.body) {
      try {
        body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      } catch {
        body = init.body;
      }
    }
    const headers = { ...(init.headers || {}) };
    calls.push({ url: u, method, body, headers });

    if (nextError) {
      const err = nextError;
      nextError = null;
      throw err;
    }

    const isPaytech =
      u.includes('paytech.sn') ||
      u.includes('/payment/request-payment') ||
      u.includes('/payment/refund-payment') ||
      u.includes('/payment/payout') ||
      (process.env.PAYTECH_API_URL && u.includes(String(process.env.PAYTECH_API_URL))) ||
      (process.env.PAYTECH_BASE_URL && u.includes(String(process.env.PAYTECH_BASE_URL).replace(/\/$/, '')));

    if (!isPaytech) {
      if (typeof originalFetch === 'function') {
        return originalFetch(url, init);
      }
      return jsonResponse(404, { message: `Unmocked URL (PayTech mock): ${u}` }, false);
    }

    if (u.includes('/payment/request-payment') || u === process.env.PAYTECH_API_URL) {
      if (mode === 'auth_fail_401') {
        return jsonResponse(401, { success: 0, message: 'Invalid API credentials', errors: ['api_key_invalid'] }, false);
      }
      if (mode === 'auth_fail_body') {
        return jsonResponse(200, { success: 0, errors: ['API_KEY invalide', 'API_SECRET invalide'] }, true);
      }
      if (mode === 'missing_params') {
        return jsonResponse(400, {
          success: 0,
          message: 'Paramètres manquants',
          errors: ['item_price_required', 'ref_command_required'],
        }, false);
      }
      if (mode === 'server_500') {
        return jsonResponse(500, { success: 0, message: 'Internal Server Error PayTech' }, false);
      }
      if (mode === 'malformed') {
        return {
          ok: true,
          status: 200,
          async json() {
            throw new SyntaxError('Unexpected token < in JSON');
          },
          async text() {
            return '<html>bad</html>';
          },
        };
      }
      if (mode === 'no_redirect') {
        return jsonResponse(200, { success: 1, token: 'pt_tok_orphan' }, true);
      }

      tokenSeq += 1;
      const token = `${defaultSuccess.token}_${tokenSeq}`;
      return jsonResponse(200, {
        success: 1,
        token,
        redirect_url: `https://paytech.sn/payment/checkout/${token}`,
        redirectUrl: `https://paytech.sn/payment/checkout/${token}`,
        ref_command: body?.ref_command || defaultSuccess.ref_command,
      });
    }

    if (u.includes('/payment/refund-payment')) {
      if (mode === 'refund_fail') {
        return jsonResponse(502, { message: 'Refund rejected' }, false);
      }
      return jsonResponse(200, { success: 1, ref_command: body?.ref_command });
    }

    if (u.includes('/payment/payout')) {
      if (mode === 'payout_fail') {
        return jsonResponse(502, { message: 'Payout rejected' }, false);
      }
      return jsonResponse(200, {
        success: 1,
        ref_command: body?.ref_command || `PO-${Date.now()}`,
        reference: body?.ref_command,
      });
    }

    return jsonResponse(404, { message: `Unmocked PayTech path: ${u}` }, false);
  };

  return {
    calls,
    restore() {
      global.fetch = originalFetch;
    },
    setMode(next) {
      mode = next;
    },
    setNextError(err) {
      nextError = err;
    },
    lastCheckoutCall() {
      return [...calls].reverse().find((c) => String(c.url).includes('request-payment') || c.url === process.env.PAYTECH_API_URL) || null;
    },
    lastCheckoutBody() {
      return this.lastCheckoutCall()?.body || null;
    },
    lastCheckoutHeaders() {
      return this.lastCheckoutCall()?.headers || null;
    },
    sha256(value) {
      return crypto.createHash('sha256').update(String(value)).digest('hex');
    },
  };
}

/**
 * Garde d'idempotence en mémoire pour tests défensifs (double soumission même ref_command).
 */
function creerGardeIdempotenceRefCommand() {
  const inflight = new Set();
  const completed = new Set();

  return {
    async executer(refCommand, fn) {
      const ref = String(refCommand || '');
      if (!ref) {
        const error = new Error('ref_command manquant pour garde idempotence');
        error.code = 'REF_COMMAND_MISSING';
        throw error;
      }
      if (inflight.has(ref) || completed.has(ref)) {
        const error = new Error(`Processus Pay-In déjà en cours ou terminé pour ref_command=${ref}`);
        error.code = 'REF_COMMAND_CONFLICT';
        error.statusCode = 409;
        throw error;
      }
      inflight.add(ref);
      try {
        const result = await fn();
        completed.add(ref);
        return result;
      } finally {
        inflight.delete(ref);
      }
    },
    reset() {
      inflight.clear();
      completed.clear();
    },
    hasCompleted(ref) {
      return completed.has(String(ref));
    },
  };
}

module.exports = {
  jsonResponse,
  installerPaytechFetchMock,
  creerGardeIdempotenceRefCommand,
};
