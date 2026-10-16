const fs = require('fs');
const os = require('os');
const path = require('path');
const tmp = path.join(os.tmpdir(), `p14-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
const { createHarness } = require('../helpers/harness');
const { openDb } = require('../helpers/fixtureDb');
const store = require('../../services/openwaSessionStore');
const h = createHarness('p14');

async function main() {
  const db = await openDb();
  store.sauver(db, { sessionKey: 'platform', openwaId: 'sess-9', status: 'ready' });
  const up = await store.restaurer(db, async () => true);
  h.assertEqual('connected', up[0].connected, true);
  const down = await store.restaurer(db, async () => false);
  h.assertEqual('down', down[0].connected, false);
  h.assertEqual('status', down[0].status, 'down');
  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}
main().catch((e) => { console.error(e); process.exit(1); });
