const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = path.join(os.tmpdir(), `us23-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;

const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde, queryOne } = require('../helpers/fixtureDb');
const { bump } = require('../../services/configVersion');
const { reponseCacheConfig } = require('../../domain/prixCarte');

const h = createHarness('us23');

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const v1 = bump(db, monde.terrainAvance);
  const v2 = bump(db, monde.terrainAvance);
  h.assertEqual('version 1', v1, 1);
  h.assertEqual('version 2', v2, 2);
  const row = queryOne(db, 'SELECT config_version FROM terrains WHERE id = ?', [monde.terrainAvance]);
  h.assertEqual('persisté', Number(row.config_version), 2);

  const hit = reponseCacheConfig({ 'if-none-match': 'W/"2"' }, 2);
  h.assertEqual('304', hit.status, 304);
  const miss = reponseCacheConfig({ 'if-none-match': 'W/"1"' }, 2);
  h.assertEqual('200', miss.status, 200);

  const before = Number(queryOne(db, 'SELECT config_version FROM terrains WHERE id = ?', [monde.terrainAvance]).config_version);
  reponseCacheConfig({}, before);
  const after = Number(queryOne(db, 'SELECT config_version FROM terrains WHERE id = ?', [monde.terrainAvance]).config_version);
  h.assertEqual('GET ne change pas la version', after, before);

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
