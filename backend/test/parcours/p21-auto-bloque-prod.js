const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p21-${process.pid}-${Date.now()}.db`);
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
const {
  appliquerApresPayin,
  traiterFenetresExpirees,
  raisonsBlocagePayout,
} = require('../../services/payoutEngine');

const h = createHarness('p21');

async function main() {
  const db = await openDb();
  const fx = seedMohamedCompte(db, {
    payoutMode: 'auto',
    paiementProduction: 0,
    remboursementAutorise: 0,
  });
  transaction(db, () =>
    enregistrerContrat(db, fx.terrainId, {
      payout_mode: 'auto',
      paiement_production: 0,
      remboursement_autorise: 0,
      wave_numero: '221771234567',
      om_numero: '221771234567',
      wave_statut: 'verifie',
      om_statut: 'verifie',
    }, { auteurId: 1 }),
  );

  const r = creerReservationMohamed(db, { terrainId: fx.terrainId, joueurId: fx.joueurId });
  runSql(db, "UPDATE reservations SET statut = 'confirme', confirme_at = ? WHERE id = ?", [
    new Date().toISOString(),
    r.reservationId,
  ]);
  const resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [r.reservationId]);
  const { du, contrat } = appliquerApresPayin(db, { reservation: resa });
  h.assertEqual('payable immédiat', du.statut, 'payable');
  h.assertEqual('raison', raisonsBlocagePayout(db, du, contrat), 'pas_en_production');

  await traiterFenetresExpirees(db, Date.now());
  const payout = queryOne(
    db,
    "SELECT * FROM payouts WHERE reservation_id = ? AND statut = 'envoye'",
    [r.reservationId],
  );
  h.assert('aucun payout', !payout);
  const du2 = queryOne(db, 'SELECT * FROM dus WHERE id = ?', [du.id]);
  h.assertEqual('reste payable', du2.statut, 'payable');

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
