/**
 * Mini-app Express + client HTTP — équivalent Supertest sans dépendance externe.
 * Monte les vraies routes paiement + alias FinTech `/api/payments/*`.
 */
const http = require('http');
const express = require('express');
const { mountPaymentRoutes } = require('../../payments/routes');
const { handlePaytechIpn } = require('../../payments/flow');
const paytechService = require('../../paytechService');
const { getDb, queryOne, runSql } = require('../../database');
const logger = require('../../logger');

/**
 * @returns {{ app: import('express').Express, server: import('http').Server, baseUrl: string, close: Function, request: Function }}
 */
async function demarrerPaytechTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  mountPaymentRoutes(app);

  /**
   * Alias demandés par le cahier de tests FinTech :
   * - POST /api/payments/checkout  → même logique que POST /api/paiements
   * - POST /api/payments/webhook   → même logique que POST /webhook/paytech
   */
  app.post('/api/payments/checkout', async (req, res) => {
    try {
      const reservationId = Number(req.body?.reservation_id || 0);
      if (!reservationId) {
        return res.status(400).json({ error: 'reservation_id requis' });
      }
      const db = await getDb();
      const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
      if (!reservation) return res.status(404).json({ error: 'Réservation introuvable' });
      if (reservation.statut !== 'en_attente') {
        return res.status(400).json({ error: 'Cette réservation n’est plus en attente de paiement' });
      }
      if (reservation.lien_paiement && reservation.reference_paytech) {
        return res.status(200).json({
          redirect_url: reservation.lien_paiement,
          lien_paiement: reservation.lien_paiement,
          reference_paytech: reservation.reference_paytech,
          token: null,
          reused: true,
        });
      }
      const payment = await paytechService.creerLienPaiement(reservation, {
        preferredChannel: req.body?.methode || req.body?.canal_paiement,
      });
      runSql(db, 'UPDATE reservations SET lien_paiement = ?, reference_paytech = ? WHERE id = ?', [
        payment.redirectUrl,
        payment.reference,
        reservation.id,
      ]);
      return res.status(201).json({
        redirect_url: payment.redirectUrl,
        lien_paiement: payment.redirectUrl,
        reference_paytech: payment.reference,
        token: payment.token || null,
        canal_paiement: payment.canal_paiement || null,
        currency: 'XOF',
        provider: payment.provider || 'paytech',
      });
    } catch (error) {
      logger.error('paytechTestApp', 'POST /api/payments/checkout', error);
      return res.status(error.statusCode || 500).json({ error: error.message || 'Erreur paiement' });
    }
  });

  app.post('/api/payments/webhook', async (req, res) => {
    try {
      const result = await handlePaytechIpn(req.body || {}, req.headers);
      return res.status(200).json(result);
    } catch (error) {
      if (error.statusCode === 400) {
        logger.error('paytechTestApp', 'ALERTE SECURITE IPN PayTech — signature invalide', error);
        return res.status(400).json({ error: error.message });
      }
      logger.error('paytechTestApp', 'Webhook PayTech', error);
      return res.status(200).json({ received: true, processing_error: true });
    }
  });

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(method, pathName, { body, headers } = {}) {
    const url = `${baseUrl}${pathName}`;
    const init = {
      method: String(method || 'GET').toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
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
  }

  function close() {
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  return { app, server, baseUrl, close, request };
}

module.exports = { demarrerPaytechTestApp };
