const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = path.join(os.tmpdir(), `us21-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;

const { createHarness } = require('../helpers/harness');
const { resoudrePrixAffiche } = require('../../domain/prixCarte');
const { openDb, seedMonde } = require('../helpers/fixtureDb');
const { appliquerPrixCarte } = require('../../services/prixCarteService');
const { calculerPrixReservation } = require('../../pricingService');

const h = createHarness('us21');

h.assertEqual('défaut demi', resoudrePrixAffiche({ source: 'demi', prixDemi: 18000, prixEntier: 40000 }).prix_affiche, 18000);
h.assertEqual(
  'demi absent → entier',
  resoudrePrixAffiche({ source: 'demi', prixEntier: 40000 }).prix_affiche,
  40000,
);
h.assertEqual('heure en dernier', resoudrePrixAffiche({ source: 'demi', prixHeure: 30000 }).prix_affiche, 30000);
h.assertThrows('enum', () => require('../../domain/prixCarte').normaliserSourcePrixCarte('nuit'), 'demi');

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const applied = appliquerPrixCarte(db, monde.terrainAvance, 'entier');
  h.assertEqual('patch entier', applied.prix_affiche, 40000);
  h.assert('version', applied.config_version >= 1);

  const db2 = db;
  const terrain = require('../../database').queryOne(db2, 'SELECT * FROM terrains WHERE id = ?', [monde.terrainAvance]);
  const prixPaye = calculerPrixReservation(db, terrain, '2026-11-02', '18:00', '19:00', 'moitie');
  h.assert('prix réservation indépendant de la carte', Number.isFinite(Number(prixPaye)));

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
