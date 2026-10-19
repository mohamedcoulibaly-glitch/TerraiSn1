const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p22-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.PAYMENT_MODE = 'simulation';
process.env.PAYTECH_MOCK = 'true';
process.env.WHATSAPP_MOCK = 'true';
process.env.WHATSAPP_DEV_NUMBER = '221778261225';

const { createHarness } = require('../helpers/harness');
const { openDb, queryOne, runSql, transaction } = require('../helpers/fixtureDb');
const { seedMohamedCompte, creerReservationMohamed } = require('../helpers/dbFixtures');
const { enregistrerContrat } = require('../../services/contratService');
const { appliquerApresPayin } = require('../../services/payoutEngine');
const { demanderRetrait, marquerRetraitEnvoye } = require('../../services/retraitService');
const { portefeuilleTerrain } = require('../../services/ledgerService');

const h = createHarness('p22');

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
      wave_numero: '221771234567',
      om_numero: '221771234567',
      wave_statut: 'verifie',
      om_statut: 'verifie',
      numeros_identiques_whatsapp: 1,
    }, { auteurId: 1 }),
  );

  const r = creerReservationMohamed(db, { terrainId: fx.terrainId, joueurId: fx.joueurId });
  runSql(db, "UPDATE reservations SET statut = 'confirme', confirme_at = ? WHERE id = ?", [
    new Date().toISOString(),
    r.reservationId,
  ]);
  const resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [r.reservationId]);
  appliquerApresPayin(db, { reservation: resa });

  const avant = portefeuilleTerrain(db, fx.terrainId);
  h.assert('bouton retirer', avant.bouton_retirer === true);

  const demande = await demanderRetrait(db, { terrainId: fx.terrainId, gerantId: fx.gerantId });
  h.assert('demande creee', Number(demande.id) > 0);
  h.assertEqual('demande en_attente', demande.statut, 'en_attente');

  const envoyee = transaction(db, () =>
    marquerRetraitEnvoye(db, demande.id, { traitePar: fx.gerantId, refManuelle: 'P22-WAVE' }),
  );
  h.assertEqual('envoye', envoyee.statut, 'envoye');

  const du = queryOne(db, 'SELECT * FROM dus WHERE reservation_id = ?', [r.reservationId]);
  h.assertEqual('du verse', du.statut, 'verse');

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
