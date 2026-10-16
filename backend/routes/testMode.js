/**
 * Routes de test. Absentes tant que E2E_MODE n'est pas 1 :
 * le routeur n'est pas monté, Express répond 404.
 */
const { getDb, queryOne } = require('../database');
const { confirmerPaiementEtNotifier } = require('../payments/flow');

const STATUTS_REFUSES = new Set(['annule', 'expire', 'match_joue', 'joue']);

function mountTestRoutes(app) {
  if (String(process.env.E2E_MODE || '') !== '1') return;

  app.post('/api/test/reset', (_req, res) => {
    res.json({ ok: true, reset: true });
  });

  app.post('/api/test/simulate-payment', async (req, res) => {
    try {
      const reservationId = Number(req.body?.reservation_id);
      const db = await getDb();
      const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
      if (!reservation) return res.status(404).json({ error: 'Réservation introuvable' });
      if (STATUTS_REFUSES.has(String(reservation.statut))) {
        return res.status(409).json({ error: 'Simulation refusée pour ce statut', statut: reservation.statut });
      }
      const ref = reservation.reference_paytech || `TF-${reservationId}-E2E`;
      const result = await confirmerPaiementEtNotifier(reservationId, ref, { methode: 'paytech' });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message || 'Simulation impossible' });
    }
  });
}

module.exports = { mountTestRoutes, STATUTS_REFUSES };
