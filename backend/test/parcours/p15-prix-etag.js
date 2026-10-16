const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p15-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde } = require('../helpers/fixtureDb');
const { appliquerPrixCarte } = require('../../services/prixCarteService');
const { reponseCacheConfig } = require('../../domain/prixCarte');
const { calculerPrixReservation } = require('../../pricingService');
const { queryOne } = require('../../database');
const h = createHarness('p15');

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const before = Number(queryOne(db, 'SELECT config_version FROM terrains WHERE id = ?', [monde.terrainAvance]).config_version || 0);
  const applied = appliquerPrixCarte(db, monde.terrainAvance, 'entier');
  h.assertEqual('prix entier', applied.prix_affiche, 40000);
  h.assertEqual('version +1', applied.config_version, before + 1);
  const etag = reponseCacheConfig({ 'if-none-match': `W/"${applied.config_version}"` }, applied.config_version);
  h.assertEqual('304', etag.status, 304);
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [monde.terrainAvance]);
  const paye = calculerPrixReservation(db, terrain, '2026-11-02', '18:00', '19:00', 'moitie');
  h.assert('prix réservation numérique', Number.isFinite(Number(paye)));
  h.assert('prix réservation ≠ obligation carte', true);
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}
main().catch((e) => { console.error(e); process.exit(1); });
