/**
 * Parcours Postgres léger (complément Babacar) — ne remplace PAS
 * test-parcours-complet.js / test-parcours-tous-roles.js de Mohamed.
 *
 * Usage: node scripts/test-parcours-postgres.js
 */
process.env.PAYMENT_MODE = process.env.PAYMENT_MODE || 'simulation';
process.env.PAYTECH_MOCK = process.env.PAYTECH_MOCK || 'true';
process.env.WHATSAPP_MOCK = process.env.WHATSAPP_MOCK || 'true';

const { createHarness } = require('../test/helpers/harness');
const { getDb, queryOne } = require('../database');
const {
  seedParcours,
  creerReservationParcours,
  cleanupParcours,
} = require('../test/helpers/pgFixtures');
const { traiterConfirmationPaytech } = require('../payments/flow');
const { chargerContrat } = require('../services/contratService');
const { duExistant } = require('../services/ledgerService');
const { calculerDecomposition } = require('../services/calculsPaiement');

const h = createHarness('parcours-postgres');

async function main() {
  const db = await getDb();
  let fx;
  try {
    fx = await seedParcours(db, {
      avancePct: 12.5,
      commissionPct: 10,
      payoutMode: 'auto',
      remboursementAutorise: 1,
      delaiRemboursementHeures: 24,
    });

    const contrat = await chargerContrat(db, fx.terrainId);
    h.assert('contrat chargé', Boolean(contrat));
    const calc = calculerDecomposition(contrat, 40000);
    h.assertEqual('avance dynamique 5000', calc.avance, 5000);

    const { reservationId } = await creerReservationParcours(db, {
      terrainId: fx.terrainId,
      joueurId: fx.joueurId,
      joueurTelephone: fx.telJoueur,
      avance: calc.avance,
      date: '2030-08-01',
      heure: '18:00',
    });

    const ref = `PG-AR-${reservationId}-${Date.now()}`;
    const result = await traiterConfirmationPaytech(db, reservationId, ref);
    h.assert(
      'confirmation OK',
      result.action === 'confirm' || result.action === 'already_paid',
      JSON.stringify(result),
    );

    const resa = await queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [reservationId]);
    h.assert(
      'statut confirmé',
      ['confirme', 'acceptee', 'confirmee'].includes(String(resa.statut)),
      resa?.statut,
    );

    const du = await duExistant(db, reservationId);
    h.assert('dû ledger', Boolean(du));
    if (du) {
      h.assertEqual('dû avance', Number(du.avance), 5000);
      h.assertEqual('dû commission', Number(du.commission), 500);
    }
  } catch (err) {
    h.assert(`exception: ${err.message}`, false);
    console.error(err);
  } finally {
    if (fx) {
      try {
        await cleanupParcours(db, fx);
      } catch (e) {
        console.warn('cleanup:', e.message);
      }
    }
  }
  h.exitIfFailed();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
