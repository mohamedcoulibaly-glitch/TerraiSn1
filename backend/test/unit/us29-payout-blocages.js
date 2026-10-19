const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `us29-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.QR_HMAC_SECRET = 'test-qr-secret';
process.env.PAYMENT_MODE = 'simulation';
process.env.PAYTECH_MOCK = 'true';
process.env.PAYTECH_PAYOUT_ENABLED = 'false';
process.env.WHATSAPP_MOCK = 'true';

const { createHarness } = require('../helpers/harness');
const { openDb, runSql, queryOne, transaction } = require('../helpers/fixtureDb');
const { seedMohamedCompte, creerReservationMohamed } = require('../helpers/dbFixtures');
const { enregistrerContrat, chargerContrat } = require('../../services/contratService');
const { appliquerApresPayin, raisonsBlocagePayout, diagnostiquerBlocageTerrain } = require('../../services/payoutEngine');
const { marquerPayable } = require('../../services/ledgerService');

const h = createHarness('us29');

async function main() {
  const db = await openDb();

  // --- pas_en_production (auto) ---
  const fx = seedMohamedCompte(db, {
    payoutMode: 'auto',
    paiementProduction: 0,
    remboursementAutorise: 0,
  });
  transaction(db, () =>
    enregistrerContrat(db, fx.terrainId, {
      wave_numero: '221771234567',
      om_numero: '221771234567',
      wave_statut: 'verifie',
      om_statut: 'verifie',
      payout_mode: 'auto',
      paiement_production: 0,
      remboursement_autorise: 0,
    }, { auteurId: 1 }),
  );
  const r1 = creerReservationMohamed(db, { terrainId: fx.terrainId, joueurId: fx.joueurId, date: '2026-09-01', heure: '10:00' });
  runSql(db, "UPDATE reservations SET statut = 'confirme', confirme_at = ? WHERE id = ?", [
    new Date().toISOString(),
    r1.reservationId,
  ]);
  const resa1 = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [r1.reservationId]);
  const { du: du1, contrat: c1 } = appliquerApresPayin(db, { reservation: resa1 });
  h.assertEqual('blocage prod', raisonsBlocagePayout(db, du1, c1), 'pas_en_production');
  const diag1 = diagnostiquerBlocageTerrain(db, fx.terrainId);
  h.assertEqual('diag prod', diag1.raison_blocage, 'pas_en_production');

  // --- aucun_canal_verifie ---
  transaction(db, () =>
    enregistrerContrat(db, fx.terrainId, {
      wave_statut: 'absent',
      om_statut: 'absent',
      wave_numero: null,
      om_numero: null,
      numeros_identiques_whatsapp: 0,
      paiement_production: 1,
    }, { auteurId: 1 }),
  );
  const c2 = chargerContrat(db, fx.terrainId);
  h.assertEqual('blocage canal', raisonsBlocagePayout(db, du1, c2), 'aucun_canal_verifie');

  // --- en_fenetre (même terrain, contrat mis à jour) ---
  transaction(db, () =>
    enregistrerContrat(db, fx.terrainId, {
      wave_numero: '221778888888',
      om_numero: '221778888888',
      wave_statut: 'verifie',
      om_statut: 'verifie',
      payout_mode: 'auto',
      paiement_production: 1,
      remboursement_autorise: 1,
      delai_remboursement_heures: 24,
    }, { auteurId: 1 }),
  );
  const r2 = creerReservationMohamed(db, { terrainId: fx.terrainId, joueurId: fx.joueurId, date: '2026-09-02', heure: '11:00' });
  runSql(db, "UPDATE reservations SET statut = 'confirme', confirme_at = ? WHERE id = ?", [
    new Date().toISOString(),
    r2.reservationId,
  ]);
  const resa2 = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [r2.reservationId]);
  const { du: du2, contrat: c3 } = appliquerApresPayin(db, { reservation: resa2 });
  h.assertEqual('du en fenetre', du2.statut, 'en_fenetre');
  h.assertEqual('blocage fenetre', raisonsBlocagePayout(db, du2, c3), 'en_fenetre');

  // --- payout_non_autorise (PAYTECH_PAYOUT_ENABLED=false + mock off) ---
  process.env.PAYTECH_MOCK = 'false';
  process.env.PAYTECH_PAYOUT_ENABLED = 'false';
  process.env.PAYMENT_MODE = 'production';
  const payable = marquerPayable(db, du2, c3, Date.now() + 25 * 60 * 60 * 1000);
  h.assertEqual('blocage flag payout', raisonsBlocagePayout(db, payable, c3), 'payout_non_autorise');

  // --- diagnostic sans canal (mode retrait) ---
  transaction(db, () =>
    enregistrerContrat(db, fx.terrainId, {
      payout_mode: 'retrait',
      wave_statut: 'absent',
      om_statut: 'absent',
      wave_numero: null,
      om_numero: null,
      numeros_identiques_whatsapp: 0,
    }, { auteurId: 1 }),
  );
  const diag3 = diagnostiquerBlocageTerrain(db, fx.terrainId);
  h.assertEqual('retrait sans canal', diag3.code, 'CANAL_NON_VERIFIE');

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((e) => { console.error(e); process.exit(1); });
