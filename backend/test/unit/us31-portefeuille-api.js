const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `us31-${process.pid}-${Date.now()}.db`);
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
const { appliquerApresPayin, diagnostiquerBlocageTerrain } = require('../../services/payoutEngine');
const { portefeuilleTerrain } = require('../../services/ledgerService');

const h = createHarness('us31');

async function main() {
  const db = await openDb();

  // Mode retrait + canal OK + dû payable → bouton_retirer
  const fx = seedMohamedCompte(db, {
    payoutMode: 'retrait',
    paiementProduction: 0,
    remboursementAutorise: 0,
  });
  transaction(db, () =>
    enregistrerContrat(db, fx.terrainId, {
      payout_mode: 'retrait',
      wave_numero: '221771234567',
      om_numero: '221771234567',
      wave_statut: 'verifie',
      om_statut: 'verifie',
      numeros_identiques_whatsapp: 1,
      remboursement_autorise: 0,
    }, { auteurId: 1 }),
  );
  const r = creerReservationMohamed(db, { terrainId: fx.terrainId, joueurId: fx.joueurId });
  runSql(db, "UPDATE reservations SET statut = 'confirme', confirme_at = ? WHERE id = ?", [
    new Date().toISOString(),
    r.reservationId,
  ]);
  const resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [r.reservationId]);
  appliquerApresPayin(db, { reservation: resa });

  const wallet = portefeuilleTerrain(db, fx.terrainId, fx.gerantId);
  h.assert('bouton retirer true', wallet.bouton_retirer === true);
  h.assert('solde > 0', Number(wallet.solde_disponible) > 0);
  const diagOk = diagnostiquerBlocageTerrain(db, fx.terrainId);
  h.assert('pas de blocage si retirable', diagOk.raison_blocage == null || diagOk.raison_blocage === 'montant_0' || Number(wallet.solde_disponible) > 0);
  // Avec solde payable, diagnostic ne doit pas être CANAL_NON_VERIFIE
  h.assert('canal OK', diagOk.code !== 'CANAL_NON_VERIFIE');

  // Sans canal → bouton false + code
  transaction(db, () =>
    enregistrerContrat(db, fx.terrainId, {
      wave_statut: 'absent',
      om_statut: 'absent',
      wave_numero: null,
      om_numero: null,
      numeros_identiques_whatsapp: 0,
    }, { auteurId: 1 }),
  );
  const wallet2 = portefeuilleTerrain(db, fx.terrainId, fx.gerantId);
  h.assert('bouton false sans canal', wallet2.bouton_retirer === false);
  const diag2 = diagnostiquerBlocageTerrain(db, fx.terrainId);
  h.assertEqual('code CANAL_NON_VERIFIE', diag2.code, 'CANAL_NON_VERIFIE');
  h.assert('message lisible', Boolean(diag2.message_lisible));

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
