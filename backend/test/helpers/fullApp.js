/**
 * Monte la vraie API Express (backend/index.js) sur un port éphémère.
 * Prérequis : fixer DB_PATH / INTEGRATION_TEST / WHATSAPP_MOCK / PAYTECH_MOCK
 * AVANT le premier require de ce module (ou de database/index).
 */
const http = require('http');
const path = require('path');

function applyIntegrationEnv(extra = {}) {
  const defaults = {
    INTEGRATION_TEST: '1',
    SKIP_SEED: '1',
    SKIP_LISTEN: '1',
    WHATSAPP_MOCK: 'true',
    PAYTECH_MOCK: 'true',
    PAYMENT_MODE: 'simulation',
    PAYMENT_PROVIDER: 'paytech',
    PAYMENT_GATEWAY: 'paytech',
    JWT_SECRET: 'integration_full_jwt_secret',
    JWT_REFRESH_SECRET: 'integration_full_jwt_refresh',
    QR_HMAC_SECRET: 'integration_full_qr_secret',
    APP_DOMAIN: 'http://127.0.0.1:9',
    NODE_ENV: 'test',
    ...extra,
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = String(value);
    }
  }
  process.env.INTEGRATION_TEST = '1';
  process.env.SKIP_LISTEN = '1';
  process.env.SKIP_SEED = '1';
}

/**
 * @param {{ body?: any, token?: string, headers?: Record<string,string> }} [opts]
 */
function createRequest(baseUrl) {
  return async function request(method, urlPath, { body, token, headers } = {}) {
    const url = `${baseUrl}${urlPath}`;
    const init = {
      method: String(method || 'GET').toUpperCase(),
      headers: {
        Accept: 'application/json',
        ...(body != null ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers || {}),
      },
    };
    if (body != null && init.method !== 'GET' && init.method !== 'HEAD') {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const response = await fetch(url, init);
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      body: json,
      text,
    };
  };
}

/**
 * @returns {Promise<{ app: import('express').Express, server: import('http').Server, baseUrl: string, request: Function, close: Function, db: any }>}
 */
async function demarrerFullApp() {
  applyIntegrationEnv();
  // Charge l'app après les env (database lit DB_PATH au 1er getDb).
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const { app, start } = require(path.join(__dirname, '..', '..', 'index.js'));
  const { db } = await start({ integration: true, listen: false });

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    app,
    server,
    baseUrl,
    db,
    request: createRequest(baseUrl),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

module.exports = {
  applyIntegrationEnv,
  createRequest,
  demarrerFullApp,
};
