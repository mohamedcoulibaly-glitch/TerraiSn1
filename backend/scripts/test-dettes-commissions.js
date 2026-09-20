/**
 * Tests dettes commissions — unitaires, intégration et cycle payout.
 * Usage : node scripts/test-dettes-commissions.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `terrainsn-dettes-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.PAYMENT_MODE = 'simulation';
process.env.PAYTECH_MOCK = 'true';
process.env.WHATSAPP_MOCK = 'true';
process.env.PAYTECH_PAYOUT_ENABLED = 'true';
process.env.WHATSAPP_DEV_NUMBER = '771112233';

const { createHarness } = require('../test/helpers/harness');
const { seedMohamedCompte, creerReservationMohamed } = require('../test/helpers/dbFixtures');
const { MOHAMED } = require('../test/helpers/mohamed');

const { getDb, queryOne, queryAll, runSql, transaction } = require('../database');
const {
  confirmerManuellement,
  detteOuverteTerrain,
  preparerCompensationDette,
  appliquerCompensationDette,
  remiseAZero,
  resumeGerant,
  listDettesAdmin,
  resumeSuperadminMois,
  setSetting,
  periodeCivile,
} = require('../services/detteCommissionService');
const { enregistrerContrat } = require('../services/contratService');
const { traiterConfirmationPaytech } = require('../payments/flow');
const { tenterAutoSiPayable } = require('../services/payoutEngine');
const { duExistant } = require('../services/ledgerService');

const h = createHarness('dettes-commissions');

function creerReservationEnAttente(db, { terrainId, joueurId, gerantId, date, heure }) {
  return creerReservationMohamed(db, { terrainId, joueurId, date, heure });
}

async function confirmerPayin(db, reservationId, { autoPayout = false } = {}) {
  const ref = `TF-${reservationId}-${Date.now()}`;
  const result = await traiterConfirmationPaytech(db, reservationId, ref);
  if (autoPayout && result.action === 'confirm' && result.ledgerInfo) {
    await tenterAutoSiPayable(db, {
      du: result.ledgerInfo.du,
      contrat: result.ledgerInfo.contrat,
    });
  }
  return result;
}

async function main() {
  const db = await getDb();
  const fx = seedMohamedCompte(db, {
    payoutMode: 'auto',
    paiementProduction: 1,
    remboursementAutorise: 0,
    delaiRemboursementHeures: 0,
  });

  // ========== UNITAIRES : compensation FIFO ==========
  const dette1 = runSql(
    db,
    `INSERT INTO dettes_commissions
       (terrain_id, gerant_id, reservation_id, montant_commission, montant_avance_manuelle, statut, periode)
     VALUES (?, ?, 9001, 300, 5000, 'en_attente', ?)`,
    [fx.terrainId, fx.gerantId, periodeCivile()],
  ).lastInsertRowid;
  runSql(
    db,
    `INSERT INTO dettes_commissions
       (terrain_id, gerant_id, reservation_id, montant_commission, montant_avance_manuelle, statut, periode)
     VALUES (?, ?, 9002, 200, 5000, 'en_attente', ?)`,
    [fx.terrainId, fx.gerantId, periodeCivile()],
  );

  const prepPartiel = preparerCompensationDette(db, { terrainId: fx.terrainId, montantDisponible: 400 });
  h.assertEqual('FIFO : 2 lignes ouvertes', prepPartiel.lignes.length, 2);
  h.assertEqual('FIFO : 1ère dette 300', prepPartiel.lignes[0].montant, 300);
  h.assertEqual('FIFO : 2e dette 100', prepPartiel.lignes[1].montant, 100);
  h.assertEqual('FIFO : compense 400', prepPartiel.montant_compense, 400);
  h.assertEqual('FIFO : net 0', prepPartiel.montant_net, 0);

  const ouvert = detteOuverteTerrain(db, fx.terrainId);
  h.assertEqual('dette ouverte totale 500', ouvert.total, 500);
  h.assertEqual('dette ouverte nb 2', ouvert.nb, 2);

  // Appliquer compensation partielle sur 1ère dette
  const appliPartiel = appliquerCompensationDette(db, {
    terrainId: fx.terrainId,
    lignes: [{ dette_id: dette1, montant: 150 }],
    faitPar: 1,
    roleFaitPar: 'systeme',
    payoutId: 99,
  });
  h.assertEqual('partiel : montant compensé 150', appliPartiel.montant, 150);
  h.assertEqual('partiel : 0 soldée', appliPartiel.soldées, 0);
  const detteApresPartiel = queryOne(db, 'SELECT montant_commission, statut FROM dettes_commissions WHERE id = ?', [
    dette1,
  ]);
  h.assertEqual('partiel : reste 150', Number(detteApresPartiel.montant_commission), 150);
  h.assertEqual('partiel : toujours en_attente', detteApresPartiel.statut, 'en_attente');

  // Appliquer compensation totale
  const appliTotal = appliquerCompensationDette(db, {
    terrainId: fx.terrainId,
    lignes: [{ dette_id: dette1, montant: 150 }],
    faitPar: 1,
    roleFaitPar: 'systeme',
    payoutId: 100,
  });
  h.assertEqual('total : 1 soldée', appliTotal.soldées, 1);
  const dette1Final = queryOne(db, 'SELECT statut FROM dettes_commissions WHERE id = ?', [dette1]);
  h.assertEqual('total : dette1 payee', dette1Final.statut, 'payee');

  // Nettoyer dettes fixtures unitaires
  runSql(db, 'DELETE FROM audit_dette');
  runSql(db, 'DELETE FROM dettes_commissions WHERE reservation_id IN (9001, 9002)');

  // ========== INTÉGRATION : confirmation manuelle ==========
  const resaManuelle = creerReservationEnAttente(db, {
    terrainId: fx.terrainId,
    joueurId: fx.joueurId,
    date: '2026-11-01',
    heure: '10:00',
  });

  const manuel = transaction(db, () =>
    confirmerManuellement(db, {
      reservationId: resaManuelle.reservationId,
      gerantId: fx.gerantId,
      note: 'Paiement cash reçu',
    }),
  );
  h.assert('manuel : code généré', Boolean(manuel.code));
  h.assertEqual('manuel : commission 500', manuel.commission, 500);
  h.assertEqual('manuel : avance 5000', manuel.montantAvance, MOHAMED.montants.avancePayin);

  const resaConfirmee = queryOne(db, 'SELECT statut, mode_paiement FROM reservations WHERE id = ?', [
    resaManuelle.reservationId,
  ]);
  h.assertEqual('manuel : réservation confirmée', resaConfirmee.statut, 'confirme');
  h.assertEqual('manuel : mode_paiement manuel', resaConfirmee.mode_paiement, 'manuel');

  const detteManuelle = queryOne(
    db,
    'SELECT * FROM dettes_commissions WHERE reservation_id = ?',
    [resaManuelle.reservationId],
  );
  h.assert('manuel : dette créée', Boolean(detteManuelle));
  h.assertEqual('manuel : dette statut en_attente', detteManuelle.statut, 'en_attente');
  h.assertEqual('manuel : dette commission 500', Number(detteManuelle.montant_commission), 500);

  const auditCreation = queryAll(
    db,
    `SELECT * FROM audit_dette WHERE dette_id = ? AND action = 'creation'`,
    [detteManuelle.id],
  );
  h.assert('manuel : audit création', auditCreation.length >= 1);

  const paiementManuel = queryOne(
    db,
    `SELECT * FROM paiements WHERE reservation_id = ? AND methode = 'manuel'`,
    [resaManuelle.reservationId],
  );
  h.assert('manuel : paiement enregistré', Boolean(paiementManuel));
  h.assertEqual('manuel : paiement statut paye', paiementManuel.statut, 'paye');

  // Idempotence : double confirmation refusée
  await h.assertThrowsAsync(
    'manuel : double confirmation refusée',
    async () => {
      transaction(db, () =>
        confirmerManuellement(db, {
          reservationId: resaManuelle.reservationId,
          gerantId: fx.gerantId,
        }),
      );
    },
    /déjà traitée|déjà une commission/,
  );

  // ========== INTÉGRATION : résumés admin / gérant ==========
  const resumeG = resumeGerant(db, fx.gerantId);
  h.assert('résumé gérant : nb > 0', resumeG.resume.nb_reservations_manuelles >= 1);
  h.assert('résumé gérant : dette en cours > 0', resumeG.resume.dette_en_cours >= 500);
  h.assert('résumé gérant : détail non vide', resumeG.detail.length >= 1);

  setSetting(db, 'dette_instructions', 'Virement Wave au 77 000 00 00');
  const adminList = listDettesAdmin(db, { terrainId: fx.terrainId });
  h.assert('admin : par_terrain non vide', adminList.par_terrain.length >= 1);
  h.assert('admin : instructions persistées', adminList.instructions.includes('Virement Wave'));

  const resumeSA = resumeSuperadminMois(db);
  h.assert('superadmin : total en attente > 0', resumeSA.total_en_attente >= 500);

  // ========== INTÉGRATION : payout auto avec compensation dette ==========
  const resaPayin = creerReservationEnAttente(db, {
    terrainId: fx.terrainId,
    joueurId: fx.joueurId,
    date: '2026-11-02',
    heure: '11:00',
  });
  await confirmerPayin(db, resaPayin.reservationId);

  const du = duExistant(db, resaPayin.reservationId);
  h.assert('payin : dû créé', Boolean(du));
  h.assertEqual('payin : dû payable (sans fenêtre refund)', du.statut, 'payable');

  const contrat = transaction(db, () => {
    const { chargerContrat } = require('../services/contratService');
    return chargerContrat(db, fx.terrainId);
  });

  const payoutResult = await tenterAutoSiPayable(db, { du, contrat });
  h.assert('payout avec dette : exécuté', payoutResult.ok === true);

  const payout = queryOne(
    db,
    `SELECT * FROM payouts WHERE reservation_id = ? ORDER BY id DESC LIMIT 1`,
    [resaPayin.reservationId],
  );
  h.assert('payout : ligne créée', Boolean(payout));
  h.assert(
    'payout : dette compensée 500',
    Number(payout.montant_dette_compensee || 0) === 500,
    `obtenu=${payout.montant_dette_compensee}`,
  );
  h.assertEqual('payout : net = brut - dette', Number(payout.montant_net), Number(payout.montant_brut) - 500);
  h.assertEqual('payout : statut envoye', payout.statut, 'envoye');

  const detteApresPayout = queryOne(
    db,
    'SELECT statut FROM dettes_commissions WHERE reservation_id = ?',
    [resaManuelle.reservationId],
  );
  h.assertEqual('dette manuelle soldée après payout', detteApresPayout.statut, 'payee');

  const auditPaiement = queryAll(
    db,
    `SELECT * FROM audit_dette WHERE dette_id = ? AND action = 'paiement_total'`,
    [detteManuelle.id],
  );
  h.assert('audit paiement_total présent', auditPaiement.length >= 1);

  // ========== INTÉGRATION : remise à zéro superadmin ==========
  const resaManuelle2 = creerReservationEnAttente(db, {
    terrainId: fx.terrainId,
    joueurId: fx.joueurId,
    date: '2026-11-03',
    heure: '12:00',
  });
  transaction(db, () =>
    confirmerManuellement(db, {
      reservationId: resaManuelle2.reservationId,
      gerantId: fx.gerantId,
    }),
  );

  const avantRemise = detteOuverteTerrain(db, fx.terrainId);
  h.assert('avant remise : dette ouverte', avantRemise.total >= 500);

  const remise = transaction(db, () =>
    remiseAZero(db, {
      terrainId: fx.terrainId,
      superAdminId: 1,
      note: 'Virement reçu',
      montantRecu: avantRemise.total,
    }),
  );
  h.assert('remise à zéro : success', remise.success === true);

  const apresRemise = detteOuverteTerrain(db, fx.terrainId);
  h.assertEqual('après remise : dette 0', apresRemise.total, 0);

  const auditRemise = queryAll(
    db,
    `SELECT * FROM audit_dette WHERE terrain_id = ? AND action = 'remise_a_zero' ORDER BY id DESC LIMIT 1`,
    [fx.terrainId],
  );
  h.assert('audit remise_a_zero', auditRemise.length >= 1);

  await h.assertThrowsAsync(
    'remise à zéro : refuse si plus de dette',
    async () => {
      transaction(db, () =>
        remiseAZero(db, { terrainId: fx.terrainId, superAdminId: 1 }),
      );
    },
    /Aucune dette/,
  );

  h.exitIfFailed();
  console.log('\nTous les tests dettes commissions OK\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
