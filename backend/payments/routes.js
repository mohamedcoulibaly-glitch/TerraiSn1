const crypto = require('crypto');
const paytechService = require('../paytechService');
const { getDb, queryOne, runSql, transaction } = require('../database');
const { libererCreneauxReservation } = require('../reservationLockService');
const logger = require('../logger');
const {
  reservationIdDepuisReference,
  confirmerPaiementEtNotifier,
  handlePaytechIpn,
} = require('./flow');

function appDomain() {
  return (process.env.APP_DOMAIN || 'http://localhost:8080').replace(/\/$/, '');
}

function localPort() {
  return Number(process.env.PORT || 3001);
}

/**
 * Routes paiement isolées : aucun effet de bord sur le dashboard gérant.
 * Webhook IPN public + simulations (mode mock uniquement).
 */
function mountPaymentRoutes(app) {
  app.post('/webhook/paytech', async (req, res) => {
    try {
      const result = await handlePaytechIpn(req.body || {}, req.headers);
      return res.status(200).json(result);
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({ error: error.message });
      }
      logger.error('payments/routes.js', 'Webhook PayTech', error);
      return res.status(200).json({ received: true, processing_error: true });
    }
  });

  async function simulerPaytech(req, res) {
    if (!paytechService.estModeMock()) return res.status(404).json({ error: 'Simulation PayTech desactivee' });
    try {
      const refCommand = String(req.body.ref_command || req.body.ref || '');
      const reservationId = Number(req.body.reservation_id || reservationIdDepuisReference(refCommand));
      const action = req.body.action || 'success';
      if (!reservationId || !refCommand.startsWith(`TF-${reservationId}-`) || !['success', 'cancel', 'failed'].includes(action)) {
        return res.status(400).json({ error: 'Paiement simule invalide' });
      }

      const db = await getDb();
      const reservation = await queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
      if (!reservation) return res.status(404).json({ error: 'Reservation non trouvee' });
      const domain = appDomain();

      if (action !== 'success') {
        await transaction(db, async () => {
          await runSql(db, "UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut = 'en_attente'", [reservationId]);
          await libererCreneauxReservation(db, reservation, ['en_attente_paiement']);
        });
        return res.json({ redirect_url: `${domain}/reservation/annule?terrain_id=${reservation.terrain_id}` });
      }

      await confirmerPaiementEtNotifier(reservationId, refCommand);
      const confirmed = await queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [reservationId]);
      if (confirmed?.statut !== 'confirme') throw new Error('La confirmation simulee a echoue');
      return res.json({ redirect_url: `${domain}/reservation/succes?id=${reservationId}` });
    } catch (error) {
      logger.error('payments/routes.js', 'Simulation PayTech', error);
      return res.status(500).json({ error: 'Le paiement n a pas pu etre confirme. Veuillez reessayer.' });
    }
  }

  app.post('/webhook/paytech/simulate', simulerPaytech);
  app.post('/api/webhook/paytech/simulate', simulerPaytech);
  app.post('/api/payments/simulate', simulerPaytech);

  app.post('/api/paytech/mock/complete', async (req, res) => {
    if (!paytechService.estModeMock()) return res.status(404).json({ error: 'Mode PayTech mock désactivé' });
    try {
      const reservationId = Number(req.body.reservation_id);
      const refCommand = String(req.body.ref_command || '');
      const action = req.body.action;
      if (!reservationId || !refCommand.startsWith(`TF-${reservationId}-`) || !['success', 'cancel'].includes(action)) {
        return res.status(400).json({ error: 'Paiement simulé invalide' });
      }

      const db = await getDb();
      const reservation = await queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
      if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });
      const domain = appDomain();

      if (action === 'cancel') {
        await transaction(db, async () => {
          await runSql(db, "UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut = 'en_attente'", [reservationId]);
          await libererCreneauxReservation(db, reservation, ['en_attente_paiement']);
        });
        return res.json({ redirect_url: `${domain}/reservation/annule?terrain_id=${reservation.terrain_id}` });
      }

      const webhookResponse = await fetch(`http://127.0.0.1:${localPort()}/webhook/paytech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-PayTech-Signature': paytechService.signerReference(refCommand) },
        body: JSON.stringify({
          type_event: 'sale_complete',
          ref_command: refCommand,
          item_price: paytechService.montantLienPaiement(reservation),
          final_item_price: paytechService.montantLienPaiement(reservation),
          custom_field: Buffer.from(JSON.stringify({ reservation_id: reservationId }), 'utf8').toString('base64'),
          api_key_sha256: crypto.createHash('sha256').update(process.env.PAYTECH_API_KEY || 'mock').digest('hex'),
          api_secret_sha256: crypto.createHash('sha256').update(process.env.PAYTECH_API_SECRET || 'mock').digest('hex'),
        }),
      });
      if (!webhookResponse.ok) throw new Error('Le webhook simulé a été rejeté');
      const confirmed = await queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [reservationId]);
      if (confirmed?.statut !== 'confirme') throw new Error('La confirmation simulée a échoué');
      return res.json({ redirect_url: `${domain}/reservation/succes?id=${reservationId}` });
    } catch (error) {
      logger.error('payments/routes.js', 'PayTech mock legacy', error);
      return res.status(500).json({ error: error.message || 'Erreur du paiement simulé' });
    }
  });

  app.post('/api/paiements', async (_req, res) => {
    res.status(410).json({ error: 'Le paiement direct est désactivé. Utilisez le lien PayTech de la réservation.' });
  });
}

module.exports = { mountPaymentRoutes };
