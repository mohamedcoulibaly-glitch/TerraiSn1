const paytechService = require('../paytechService');
const { getDb, queryOne, transaction } = require('../database');
const { libererCreneauxReservation } = require('../reservationLockService');
const logger = require('../logger');
const {
  reservationIdDepuisReference,
  confirmerPaiementEtNotifier,
  handlePaytechIpn,
  handlePaydunyaIpn,
  handlePaydunyaReturn,
} = require('./flow');

function appDomain() {
  return (process.env.APP_DOMAIN || 'http://localhost:8080').replace(/\/$/, '');
}

/**
 * Redirection navigateur depuis ngrok (HTTPS) vers le front local (HTTP).
 * Un Location: http://… depuis https://ngrok… est souvent bloqué par le navigateur.
 */
function redirectToFrontend(res, targetUrl) {
  const safe = String(targetUrl || '').replace(/"/g, '&quot;').replace(/</g, '');
  res.status(200).type('html').send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="0;url=${safe}" />
  <title>Redirection TerrainSN</title>
  <script>window.location.replace(${JSON.stringify(String(targetUrl || ''))});</script>
</head>
<body style="font-family:system-ui;padding:2rem;text-align:center">
  <p>Paiement traité — redirection…</p>
  <p><a href="${safe}">Continuer vers TerrainSN</a></p>
</body>
</html>`);
}

/**
 * Routes paiement isolées : aucun effet de bord sur le dashboard gérant.
 * Webhook IPN public + simulations (mode mock uniquement).
 */
function mountPaymentRoutes(app) {
  const frontend = () => (process.env.APP_DOMAIN || 'http://localhost:8080').replace(/\/$/, '');

  // Prestataire (PayDunya / PayTech) : HTTPS ngrok → page HTML → front local
  app.get('/paytech/success', (req, res) => {
    const id = Number(req.query.id || 0);
    const abonnementId = Number(req.query.abonnement_id || 0);
    const terrainId = Number(req.query.terrain_id || 0);
    const kind = String(req.query.kind || '');
    let target;
    if (abonnementId > 0 || kind === 'abonnement') {
      target = `${frontend()}/backoffice/superadmin/abonnements?paiement=ok${abonnementId ? `&abonnement_id=${abonnementId}` : ''}`;
    } else if (terrainId > 0 && kind === 'achat') {
      target = `${frontend()}/backoffice/superadmin/abonnements?paiement=ok&kind=achat&terrain_id=${terrainId}`;
    } else {
      target = id > 0
        ? `${frontend()}/reservation/succes?id=${id}`
        : `${frontend()}/reservation/succes`;
    }
    return redirectToFrontend(res, target);
  });

  app.get('/paytech/cancel', (req, res) => {
    const terrainId = req.query.terrain_id ? `?terrain_id=${encodeURIComponent(String(req.query.terrain_id))}` : '';
    return redirectToFrontend(res, `${frontend()}/reservation/annule${terrainId}`);
  });

  app.get('/paydunya/success', (req, res) => {
    const id = Number(req.query.id || 0);
    const abonnementId = Number(req.query.abonnement_id || 0);
    const terrainId = Number(req.query.terrain_id || 0);
    const kind = String(req.query.kind || '');
    const token = String(req.query.token || '');
    // Confirmation en arrière-plan (IPN reste la source de vérité) — ne bloque pas la redirection
    if (token) {
      handlePaydunyaReturn({ token, reservationId: id }).catch((error) => {
        logger.error('payments/routes.js', 'Retour PayDunya', error);
      });
    }
    let target;
    if (abonnementId > 0 || kind === 'abonnement') {
      target = `${frontend()}/backoffice/superadmin/abonnements?paiement=ok${abonnementId ? `&abonnement_id=${abonnementId}` : ''}`;
    } else if (terrainId > 0 && kind === 'achat') {
      target = `${frontend()}/backoffice/superadmin/abonnements?paiement=ok&kind=achat&terrain_id=${terrainId}`;
    } else {
      target = id > 0
        ? `${frontend()}/reservation/succes?id=${id}`
        : `${frontend()}/reservation/succes`;
    }
    return redirectToFrontend(res, target);
  });

  app.get('/paydunya/cancel', (req, res) => {
    const terrainId = req.query.terrain_id ? `?terrain_id=${encodeURIComponent(String(req.query.terrain_id))}` : '';
    return redirectToFrontend(res, `${frontend()}/reservation/annule${terrainId}`);
  });

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

  app.post('/webhook/paydunya', async (req, res) => {
    try {
      const result = await handlePaydunyaIpn(req.body || {});
      return res.status(200).json(result);
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({ error: error.message });
      }
      logger.error('payments/routes.js', 'Webhook PayDunya', error);
      return res.status(200).json({ received: true, processing_error: true });
    }
  });

  async function simulerPaytech(req, res) {
    if (!paytechService.estModeMock()) return res.status(404).json({ error: 'Simulation PayTech desactivee' });
    try {
      const refCommand = String(req.body.ref_command || req.body.ref || '');
      const action = req.body.action || 'success';
      const domain = appDomain();
      const {
        confirmerAbonnementDepuisIpn,
        confirmerAchatDepuisIpn,
      } = require('./flow');
      const { kindFromReference, abonnementIdDepuisReference, terrainIdDepuisReferenceAchat } = require('../lib/paymentChannels');

      if (!refCommand || !['success', 'cancel', 'failed'].includes(action)) {
        return res.status(400).json({ error: 'Paiement simule invalide' });
      }

      const kind = kindFromReference(refCommand);

      if (kind === 'abonnement') {
        const abonnementId = Number(req.body.abonnement_id || abonnementIdDepuisReference(refCommand));
        if (!abonnementId || !refCommand.startsWith(`ABO-${abonnementId}-`)) {
          return res.status(400).json({ error: 'Paiement abonnement simule invalide' });
        }
        if (action !== 'success') {
          return res.json({ redirect_url: `${domain}/backoffice/superadmin/abonnements?paiement=annule&abonnement_id=${abonnementId}` });
        }
        await confirmerAbonnementDepuisIpn(refCommand, { abonnementId });
        return res.json({ redirect_url: `${domain}/backoffice/superadmin/abonnements?paiement=ok&abonnement_id=${abonnementId}` });
      }

      if (kind === 'achat') {
        const terrainId = Number(req.body.terrain_id || terrainIdDepuisReferenceAchat(refCommand));
        if (!terrainId || !refCommand.startsWith(`ACHAT-${terrainId}-`)) {
          return res.status(400).json({ error: 'Paiement achat simule invalide' });
        }
        if (action !== 'success') {
          return res.json({ redirect_url: `${domain}/backoffice/superadmin/abonnements?paiement=annule&kind=achat&terrain_id=${terrainId}` });
        }
        await confirmerAchatDepuisIpn(refCommand, { terrainId, montant: req.body.montant });
        return res.json({ redirect_url: `${domain}/backoffice/superadmin/abonnements?paiement=ok&kind=achat&terrain_id=${terrainId}` });
      }

      const reservationId = Number(req.body.reservation_id || reservationIdDepuisReference(refCommand));
      if (!reservationId || !refCommand.startsWith(`TF-${reservationId}-`)) {
        return res.status(400).json({ error: 'Paiement simule invalide' });
      }

      const db = await getDb();
      const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
      if (!reservation) return res.status(404).json({ error: 'Reservation non trouvee' });

      if (action !== 'success') {
        transaction(db, () => {
          db.run("UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut = 'en_attente'", [reservationId]);
          libererCreneauxReservation(db, reservation, ['en_attente_paiement']);
          db.run(
            `UPDATE paiements SET statut = 'annule' WHERE reservation_id = ? AND statut = 'en_attente'`,
            [reservationId],
          );
        });
        return res.json({ redirect_url: `${domain}/reservation/annule?terrain_id=${reservation.terrain_id}` });
      }

      await confirmerPaiementEtNotifier(reservationId, refCommand);
      const confirmed = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [reservationId]);
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
    // Alias legacy → même handler que /webhook/paytech/simulate
    return simulerPaytech(req, res);
  });

  /** Relance / statut : crée ou renvoie le lien de la réservation (plus de 410 mort). */
  app.post('/api/paiements', async (req, res) => {
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
        return res.json({
          redirect_url: reservation.lien_paiement,
          lien_paiement: reservation.lien_paiement,
          reference_paytech: reservation.reference_paytech,
          reused: true,
        });
      }
      const payment = await paytechService.creerLienPaiement(reservation, {
        preferredChannel: req.body?.methode || req.body?.canal_paiement,
      });
      const { runSql } = require('../database');
      runSql(db, 'UPDATE reservations SET lien_paiement = ?, reference_paytech = ? WHERE id = ?', [
        payment.redirectUrl,
        payment.reference,
        reservation.id,
      ]);
      return res.status(201).json({
        redirect_url: payment.redirectUrl,
        lien_paiement: payment.redirectUrl,
        reference_paytech: payment.reference,
        canal_paiement: payment.canal_paiement || null,
      });
    } catch (error) {
      logger.error('payments/routes.js', 'POST /api/paiements', error);
      return res.status(error.statusCode || 500).json({ error: error.message || 'Erreur paiement' });
    }
  });
}
module.exports = { mountPaymentRoutes };
