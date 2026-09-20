/**
 * Tests liens de paiement (payin) — création, persistance, relance, envoi WhatsApp.
 * Usage : node scripts/test-liens-paiement.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `terrainsn-liens-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.PAYMENT_MODE = 'simulation';
process.env.PAYTECH_MOCK = 'true';
process.env.WHATSAPP_MOCK = 'true';
process.env.APP_DOMAIN = 'http://localhost:8080';
process.env.WHATSAPP_DEV_NUMBER = '778261225';

const { createHarness } = require('../test/helpers/harness');
const { seedMohamedCompte, creerReservationMohamed } = require('../test/helpers/dbFixtures');
const { creerWhatsappDouble } = require('../test/mocks/whatsappClient');
const { MOHAMED } = require('../test/helpers/mohamed');

const { getDb, queryOne, queryAll, runSql } = require('../database');
const paytechService = require('../paytechService');
const notificationService = require('../notificationService');
const whatsappClient = require('../whatsappClient');

const h = createHarness('liens-paiement');

async function main() {
  const db = await getDb();
  const fx = seedMohamedCompte(db, { payoutMode: 'retrait', paiementProduction: 0 });
  const wa = creerWhatsappDouble();
  wa.installerSur(whatsappClient);

  const resa = creerReservationMohamed(db, {
    terrainId: fx.terrainId,
    joueurId: fx.joueurId,
    date: '2026-12-01',
    heure: '18:00',
  });

  // ========== Création lien simulation ==========
  const payment1 = await paytechService.creerLienPaiement(
    {
      id: resa.reservationId,
      terrain_id: fx.terrainId,
      prix_total: MOHAMED.montants.prixTotal,
      montant: MOHAMED.montants.prixTotal,
      joueur_nom: MOHAMED.nom,
      joueur_telephone: MOHAMED.telephoneLocal9,
    },
    { preferredChannel: 'wave' },
  );

  h.assert('création : success', payment1.success === true);
  h.assert('création : redirectUrl présent', Boolean(payment1.redirectUrl || payment1.redirect_url));
  h.assert('création : référence TF-', String(payment1.reference).startsWith(`TF-${resa.reservationId}`));
  h.assertEqual('création : montant avance 5000', payment1.montantAvance, MOHAMED.montants.avancePayin);
  h.assertEqual('création : provider simulation', payment1.provider, 'simulation');
  h.assert('création : URL contient montant', String(payment1.redirectUrl).includes('montant=5000'));

  const pending1 = queryOne(
    db,
    `SELECT * FROM paiements WHERE reservation_id = ? AND statut = 'en_attente' ORDER BY id DESC LIMIT 1`,
    [resa.reservationId],
  );
  h.assert('création : paiement pending en BDD', Boolean(pending1));
  h.assertEqual('création : montant pending 5000', Number(pending1.montant), 5000);
  h.assertEqual('création : canal wave', pending1.canal_paiement, 'wave');

  // Persistance sur réservation (comme index.js)
  runSql(db, 'UPDATE reservations SET lien_paiement = ?, reference_paytech = ? WHERE id = ?', [
    payment1.redirectUrl,
    payment1.reference,
    resa.reservationId,
  ]);

  const resaAvecLien = queryOne(db, 'SELECT lien_paiement, reference_paytech FROM reservations WHERE id = ?', [
    resa.reservationId,
  ]);
  h.assert('persistance : lien_paiement stocké', Boolean(resaAvecLien.lien_paiement));
  h.assertEqual('persistance : reference_paytech', resaAvecLien.reference_paytech, payment1.reference);

  // ========== Envoi WhatsApp lien paiement ==========
  const notifsAvant = queryAll(db, `SELECT id FROM notifications WHERE canal = 'whatsapp'`).length;
  await notificationService.envoyerLienPaiement(resa.reservationId);
  const notifsApres = queryAll(
    db,
    `SELECT * FROM notifications WHERE canal = 'whatsapp' ORDER BY id DESC LIMIT 3`,
  );
  h.assert('WA lien : notification loguée en BDD', notifsApres.length > notifsAvant);
  const contenuWa = String(notifsApres[0]?.contenu || '');
  h.assert('WA lien : contient URL', contenuWa.includes(resaAvecLien.lien_paiement));
  h.assert('WA lien : contient montant avance', contenuWa.includes('5') && contenuWa.includes('000'));
  h.assert('WA lien : contient terrain', contenuWa.includes('Arena Mohamed'));
  h.assert('WA lien : mentionne 2 heures', contenuWa.includes('2 heures'));

  // ========== Relance : annule pending précédent ==========
  const payment2 = await paytechService.creerLienPaiement(
    {
      id: resa.reservationId,
      terrain_id: fx.terrainId,
      prix_total: MOHAMED.montants.prixTotal,
      joueur_nom: MOHAMED.nom,
      joueur_telephone: MOHAMED.telephoneLocal9,
    },
    { preferredChannel: 'orange_money' },
  );
  h.assert('relance : nouveau lien', Boolean(payment2.redirectUrl));
  h.assert('relance : nouvelle référence', payment2.reference !== payment1.reference);

  const pendingRows = queryAll(
    db,
    `SELECT statut FROM paiements WHERE reservation_id = ? ORDER BY id ASC`,
    [resa.reservationId],
  );
  const annules = pendingRows.filter((r) => r.statut === 'annule').length;
  const actifs = pendingRows.filter((r) => r.statut === 'en_attente').length;
  h.assertEqual('relance : 1 pending actif', actifs, 1);
  h.assert('relance : ancien pending annulé', annules >= 1);

  // ========== Réutilisation lien existant (logique POST /api/paiements) ==========
  runSql(db, 'UPDATE reservations SET lien_paiement = ?, reference_paytech = ? WHERE id = ?', [
    payment1.redirectUrl,
    payment1.reference,
    resa.reservationId,
  ]);
  const resaReuse = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [resa.reservationId]);
  const reused =
    resaReuse.lien_paiement && resaReuse.reference_paytech
      ? {
          redirect_url: resaReuse.lien_paiement,
          lien_paiement: resaReuse.lien_paiement,
          reference_paytech: resaReuse.reference_paytech,
          reused: true,
        }
      : null;
  h.assert('réutilisation : lien existant détecté', Boolean(reused));
  h.assertEqual('réutilisation : même URL', reused.redirect_url, payment1.redirectUrl);
  h.assertEqual('réutilisation : flag reused', reused.reused, true);

  // ========== Renvoi lien gérant (2e envoi WhatsApp) ==========
  const countAvantRenvoi = Number(
    queryOne(db, `SELECT COUNT(*) AS n FROM notifications WHERE canal = 'whatsapp'`)?.n || 0,
  );
  await notificationService.envoyerLienPaiement(resa.reservationId);
  const countApresRenvoi = Number(
    queryOne(db, `SELECT COUNT(*) AS n FROM notifications WHERE canal = 'whatsapp'`)?.n || 0,
  );
  h.assert('renvoi : nouvelle notification WA', countApresRenvoi > countAvantRenvoi);
  const notifRenvoi = queryOne(
    db,
    `SELECT contenu FROM notifications WHERE canal = 'whatsapp' ORDER BY id DESC LIMIT 1`,
  );
  h.assert('renvoi : lien dans contenu', String(notifRenvoi?.contenu || '').includes(payment1.redirectUrl));

  // ========== Réservation confirmée : pas de nouveau lien ==========
  runSql(db, "UPDATE reservations SET statut = 'confirme' WHERE id = ?", [resa.reservationId]);
  const resaConfirmee = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [resa.reservationId]);
  h.assertEqual('confirmée : statut', resaConfirmee.statut, 'confirme');
  // Logique route : statut !== en_attente → 400
  h.assert('confirmée : plus en attente', resaConfirmee.statut !== 'en_attente');

  // ========== PayDunya sandbox (mock HTTP) ==========
  process.env.PAYMENT_MODE = 'production';
  process.env.PAYMENT_PROVIDER = 'paydunya';
  process.env.PAYDUNYA_MODE = 'test';
  process.env.PAYDUNYA_MASTER_KEY = 'test-master-lien';
  process.env.PAYDUNYA_PRIVATE_KEY = 'test_private_lien';
  process.env.PAYDUNYA_TOKEN = 'test_token_lien';

  process.env.PAYDUNYA_CALLBACK_URL = 'https://tunnel.example.test/webhook/paydunya';
  process.env.PAYDUNYA_RETURN_URL = 'https://tunnel.example.test/paydunya/success';
  process.env.PAYDUNYA_CANCEL_URL = 'https://tunnel.example.test/paydunya/cancel';

  const resa2 = creerReservationMohamed(db, {
    terrainId: fx.terrainId,
    joueurId: fx.joueurId,
    date: '2026-12-02',
    heure: '17:00',
  });

  const { installerFetchMock } = require('../test/mocks/paydunyaHttp');
  const fetchMock = installerFetchMock({
    reservationId: resa2.reservationId,
    totalAmount: MOHAMED.montants.avancePayin,
  });

  const paymentSandbox = await paytechService.creerLienPaiement(
    {
      id: resa2.reservationId,
      terrain_id: fx.terrainId,
      prix_total: MOHAMED.montants.prixTotal,
      joueur_nom: MOHAMED.nom,
      joueur_telephone: MOHAMED.telephoneLocal9,
    },
    { preferredChannel: 'wave' },
  );
  h.assert('sandbox : checkout OK', paymentSandbox.success === true);
  h.assertEqual('sandbox : provider paydunya', paymentSandbox.provider, 'paydunya');
  h.assert('sandbox : redirect URL sandbox', String(paymentSandbox.redirectUrl).includes('paydunya'));
  h.assert('sandbox : appel API effectué', fetchMock.calls.length >= 1);

  const pendingSandbox = queryOne(
    db,
    `SELECT methode, statut FROM paiements WHERE reservation_id = ? AND statut = 'en_attente'`,
    [resa2.reservationId],
  );
  h.assertEqual('sandbox : methode paydunya', pendingSandbox.methode, 'paydunya');

  // Restaurer mode simulation
  process.env.PAYMENT_MODE = 'simulation';
  process.env.PAYMENT_PROVIDER = '';

  h.exitIfFailed();
  console.log('\nTous les tests liens de paiement OK\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
