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

const { joueurDomain, proDomain } = require('../lib/appDomains');

function appDomain() {
  return joueurDomain();
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
  const joueur = () => joueurDomain();
  const pro = () => proDomain();

  // Prestataire (PayDunya / PayTech) : HTTPS ngrok → page HTML → front local
  app.get('/paytech/success', (req, res) => {
    const id = Number(req.query.id || 0);
    const abonnementId = Number(req.query.abonnement_id || 0);
    const terrainId = Number(req.query.terrain_id || 0);
    const kind = String(req.query.kind || '');
    let target;
    if (abonnementId > 0 || kind === 'abonnement') {
      target = `${pro()}/backoffice/superadmin/abonnements?paiement=ok${abonnementId ? `&abonnement_id=${abonnementId}` : ''}`;
    } else if (terrainId > 0 && kind === 'achat') {
      target = `${pro()}/backoffice/superadmin/abonnements?paiement=ok&kind=achat&terrain_id=${terrainId}`;
    } else if (kind === 'dette') {
      target = `${pro()}/backoffice/gerant/finances?paiement_dette=ok`;
    } else {
      target = id > 0
        ? `${joueur()}/reservation/succes?id=${id}`
        : `${joueur()}/reservation/succes`;
    }
    return redirectToFrontend(res, target);
  });

  app.get('/paytech/cancel', async (req, res) => {
    const kind = String(req.query.kind || '');
    if (kind === 'dette') {
      return redirectToFrontend(res, `${pro()}/backoffice/gerant/finances?paiement_dette=annule`);
    }
    if (kind === 'abonnement') {
      const abonnementId = Number(req.query.abonnement_id || 0);
      return redirectToFrontend(
        res,
        `${pro()}/backoffice/superadmin/abonnements?paiement=annule${
          abonnementId ? `&abonnement_id=${abonnementId}` : ''
        }`,
      );
    }
    if (kind === 'achat') {
      const terrainIdAchat = Number(req.query.terrain_id || 0);
      return redirectToFrontend(
        res,
        `${pro()}/backoffice/superadmin/abonnements?paiement=annule&kind=achat${
          terrainIdAchat ? `&terrain_id=${terrainIdAchat}` : ''
        }`,
      );
    }

    // Annulation immédiate (ne pas attendre l'IPN sale_canceled) pour libérer le créneau
    const reservationId = Number(req.query.id || 0);
    let terrainId = req.query.terrain_id ? String(req.query.terrain_id) : '';
    if (reservationId > 0) {
      try {
        const db = await getDb();
        const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
        if (reservation?.statut === 'en_attente' || reservation?.statut === 'en_attente_paiement') {
          const { annulerReservationApresAnnulationPaytech } = require('./flow');
          await annulerReservationApresAnnulationPaytech(
            reservationId,
            reservation.reference_paytech || `TF-${reservationId}-CANCEL`,
          );
        }
        if (!terrainId && reservation?.terrain_id) terrainId = String(reservation.terrain_id);
      } catch (error) {
        logger.error('payments/routes.js', 'Annulation PayTech cancel URL', error);
      }
    }

    const qs = new URLSearchParams();
    if (terrainId) qs.set('terrain_id', terrainId);
    if (reservationId > 0) qs.set('id', String(reservationId));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return redirectToFrontend(res, `${joueur()}/reservation/annule${suffix}`);
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
      target = `${pro()}/backoffice/superadmin/abonnements?paiement=ok${abonnementId ? `&abonnement_id=${abonnementId}` : ''}`;
    } else if (terrainId > 0 && kind === 'achat') {
      target = `${pro()}/backoffice/superadmin/abonnements?paiement=ok&kind=achat&terrain_id=${terrainId}`;
    } else if (kind === 'dette') {
      target = `${pro()}/backoffice/gerant/finances?paiement_dette=ok`;
    } else {
      target = id > 0
        ? `${joueur()}/reservation/succes?id=${id}`
        : `${joueur()}/reservation/succes`;
    }
    return redirectToFrontend(res, target);
  });

  app.get('/paydunya/cancel', (req, res) => {
    if (String(req.query.kind || '') === 'dette') {
      return redirectToFrontend(res, `${pro()}/backoffice/gerant/finances?paiement_dette=annule`);
    }
    const terrainId = req.query.terrain_id ? `?terrain_id=${encodeURIComponent(String(req.query.terrain_id))}` : '';
    return redirectToFrontend(res, `${joueur()}/reservation/annule${terrainId}`);
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
      const joueur = joueurDomain();
      const pro = proDomain();
      const {
        confirmerAbonnementDepuisIpn,
        confirmerAchatDepuisIpn,
        confirmerDetteDepuisIpn,
      } = require('./flow');
      const {
        kindFromReference,
        abonnementIdDepuisReference,
        terrainIdDepuisReferenceAchat,
        gerantIdDepuisReferenceDette,
        periodeDepuisReferenceDette,
      } = require('../lib/paymentChannels');

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
          return res.json({ redirect_url: `${pro}/backoffice/superadmin/abonnements?paiement=annule&abonnement_id=${abonnementId}` });
        }
        await confirmerAbonnementDepuisIpn(refCommand, { abonnementId });
        return res.json({ redirect_url: `${pro}/backoffice/superadmin/abonnements?paiement=ok&abonnement_id=${abonnementId}` });
      }

      if (kind === 'achat') {
        const terrainId = Number(req.body.terrain_id || terrainIdDepuisReferenceAchat(refCommand));
        if (!terrainId || !refCommand.startsWith(`ACHAT-${terrainId}-`)) {
          return res.status(400).json({ error: 'Paiement achat simule invalide' });
        }
        if (action !== 'success') {
          return res.json({ redirect_url: `${pro}/backoffice/superadmin/abonnements?paiement=annule&kind=achat&terrain_id=${terrainId}` });
        }
        await confirmerAchatDepuisIpn(refCommand, { terrainId, montant: req.body.montant });
        return res.json({ redirect_url: `${pro}/backoffice/superadmin/abonnements?paiement=ok&kind=achat&terrain_id=${terrainId}` });
      }

      if (kind === 'dette') {
        const gerantId = Number(req.body.gerant_id || gerantIdDepuisReferenceDette(refCommand));
        const periode = String(req.body.periode || periodeDepuisReferenceDette(refCommand) || '');
        if (!gerantId || !refCommand.startsWith(`DETTE-${gerantId}-`)) {
          return res.status(400).json({ error: 'Paiement dette simule invalide' });
        }
        if (action !== 'success') {
          return res.json({ redirect_url: `${pro}/backoffice/gerant/finances?paiement_dette=annule` });
        }
        await confirmerDetteDepuisIpn(refCommand, {
          gerantId,
          periode,
          montant: req.body.montant,
        });
        return res.json({ redirect_url: `${pro}/backoffice/gerant/finances?paiement_dette=ok` });
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
          db.run("UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut IN ('en_attente', 'en_attente_paiement')", [reservationId]);
          libererCreneauxReservation(db, reservation, ['en_attente_paiement']);
          db.run(
            `UPDATE paiements SET statut = 'annule' WHERE reservation_id = ? AND statut = 'en_attente'`,
            [reservationId],
          );
        });
        return res.json({ redirect_url: `${joueur}/reservation/annule?terrain_id=${reservation.terrain_id}` });
      }

      await confirmerPaiementEtNotifier(reservationId, refCommand);
      const confirmed = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [reservationId]);
      if (confirmed?.statut !== 'confirme') throw new Error('La confirmation simulee a echoue');
      return res.json({ redirect_url: `${joueur}/reservation/succes?id=${reservationId}` });
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
      const reservation = queryOne(
        db,
        `SELECT r.*, t.politique_paiement
         FROM reservations r JOIN terrains t ON t.id = r.terrain_id
         WHERE r.id = ?`,
        [reservationId],
      );
      if (!reservation) return res.status(404).json({ error: 'Réservation introuvable' });
      const { estSansAvance } = require('../services/politiquePaiement');
      if (estSansAvance(reservation) || reservation.mode_paiement === 'sans_avance') {
        return res.status(400).json({
          error: 'Ce terrain est en mode sans avance — pas de paiement en ligne pour la réservation',
          code: 'SANS_AVANCE',
        });
      }
      if (!['en_attente', 'en_attente_paiement'].includes(String(reservation.statut))) {
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
