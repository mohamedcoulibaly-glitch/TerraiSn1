const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p20-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.PAYMENT_MODE = 'simulation';
process.env.PAYTECH_MOCK = 'true';
process.env.PAYTECH_PAYOUT_ENABLED = 'true';
process.env.WHATSAPP_MOCK = 'true';

const { createHarness } = require('../helpers/harness');
const { openDb, queryOne, runSql, transaction } = require('../helpers/fixtureDb');
const { seedMohamedCompte, creerReservationMohamed } = require('../helpers/dbFixtures');
const { enregistrerContrat } = require('../../services/contratService');
const { appliquerApresPayin, traiterFenetresExpirees } = require('../../services/payoutEngine');
const { installerPaytechFetchMock } = require('../mocks/paytechHttp');

const h = createHarness('p20');

async function main() {
  const mock = installerPaytechFetchMock({ mode: 'success' });
  const db = await openDb();
  const fx = seedMohamedCompte(db, {
    payoutMode: 'auto',
    paiementProduction: 1,
    remboursementAutorise: 1,
    delaiRemboursementHeures: 1,
  });
  transaction(db, () =>
    enregistrerContrat(db, fx.terrainId, {
      payout_mode: 'auto',
      paiement_production: 1,
      remboursement_autorise: 1,
      delai_remboursement_heures: 1,
      wave_numero: '221771234567',
      om_numero: '221771234567',
      wave_statut: 'verifie',
      om_statut: 'verifie',
      numeros_identiques_whatsapp: 1,
    }, { auteurId: 1 }),
  );

  const r = creerReservationMohamed(db, { terrainId: fx.terrainId, joueurId: fx.joueurId });
  const confirmeAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  runSql(db, "UPDATE reservations SET statut = 'confirme', confirme_at = ? WHERE id = ?", [
    confirmeAt,
    r.reservationId,
  ]);
  const resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [r.reservationId]);
  // Abonde la caisse plateforme (payin reçu) pour autoriser le payout auto
  runSql(
    db,
    `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_paytech, montant_acompte)
     VALUES (?, 5000, 'paytech', 'paye', ?, 5000)`,
    [r.reservationId, `TF-${r.reservationId}-P20-CAISSE`],
  );
  const { du } = appliquerApresPayin(db, { reservation: resa, now: Date.parse(confirmeAt) });
  h.assertEqual('depart en_fenetre', du.statut, 'en_fenetre');

  // Force fenetre expiree
  runSql(db, 'UPDATE dus SET fenetre_expire_at = ? WHERE id = ?', [
    new Date(Date.now() - 1000).toISOString(),
    du.id,
  ]);

  const results = await traiterFenetresExpirees(db, Date.now());
  h.assert('job a tourne', results.length >= 1);

  const du2 = queryOne(db, 'SELECT * FROM dus WHERE id = ?', [du.id]);
  const payout = queryOne(
    db,
    "SELECT * FROM payouts WHERE reservation_id = ? AND statut = 'envoye'",
    [r.reservationId],
  );
  h.assert('payout envoye ou du verse', Boolean(payout) || du2.statut === 'verse', JSON.stringify({
    du: du2?.statut,
    payout: payout?.statut,
    auto: results[0]?.auto,
  }));

  mock.restore();
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
