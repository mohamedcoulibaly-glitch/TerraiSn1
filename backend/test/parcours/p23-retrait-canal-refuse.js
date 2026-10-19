const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p23-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.PAYMENT_MODE = 'simulation';
process.env.WHATSAPP_MOCK = 'true';

const { createHarness } = require('../helpers/harness');
const { openDb, queryOne, runSql, transaction } = require('../helpers/fixtureDb');
const { seedMohamedCompte, creerReservationMohamed } = require('../helpers/dbFixtures');
const { enregistrerContrat } = require('../../services/contratService');
const { appliquerApresPayin } = require('../../services/payoutEngine');
const { demanderRetrait } = require('../../services/retraitService');
const { portefeuilleTerrain } = require('../../services/ledgerService');

const h = createHarness('p23');

async function main() {
  const db = await openDb();
  const fx = seedMohamedCompte(db, {
    payoutMode: 'retrait',
    paiementProduction: 0,
    remboursementAutorise: 0,
  });
  transaction(db, () =>
    enregistrerContrat(db, fx.terrainId, {
      payout_mode: 'retrait',
      remboursement_autorise: 0,
      wave_statut: 'absent',
      om_statut: 'absent',
      wave_numero: null,
      om_numero: null,
      numeros_identiques_whatsapp: 0,
    }, { auteurId: 1 }),
  );

  const r = creerReservationMohamed(db, { terrainId: fx.terrainId, joueurId: fx.joueurId });
  runSql(db, "UPDATE reservations SET statut = 'confirme', confirme_at = ? WHERE id = ?", [
    new Date().toISOString(),
    r.reservationId,
  ]);
  const resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [r.reservationId]);
  appliquerApresPayin(db, { reservation: resa });

  const wallet = portefeuilleTerrain(db, fx.terrainId);
  h.assert('bouton false', wallet.bouton_retirer === false);

  let code = null;
  let status = null;
  try {
    await demanderRetrait(db, { terrainId: fx.terrainId, gerantId: fx.gerantId });
  } catch (e) {
    code = e.code;
    status = e.statusCode;
  }
  h.assertEqual('HTTP 409', status, 409);
  h.assertEqual('code CANAL_NON_VERIFIE', code, 'CANAL_NON_VERIFIE');

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
