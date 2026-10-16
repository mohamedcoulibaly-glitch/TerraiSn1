const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = path.join(os.tmpdir(), `us10-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.WHATSAPP_MOCK = 'true';

const { createHarness } = require('../helpers/harness');
const { openDb } = require('../helpers/fixtureDb');
const store = require('../../services/openwaSessionStore');
const { resoudreStatut } = require('../../services/whatsappStatus');

const h = createHarness('us10');

async function main() {
  const db = await openDb();
  store.sauver(db, { sessionKey: 'platform', openwaId: 'wa-1', status: 'ready' });
  const restored = await store.restaurer(db, async (id) => id === 'wa-1');
  h.assertEqual('reconnecté', restored[0].connected, true);
  h.assertEqual('status ready', restored[0].status, 'ready');

  store.sauver(db, { sessionKey: 'platform', openwaId: 'wa-1', status: 'ready' });
  const down = await store.restaurer(db, async () => false);
  h.assertEqual('health down', down[0].connected, false);
  h.assertEqual('ligne down', down[0].status, 'down');

  const mock = resoudreStatut({ dbRow: { status: 'ready', session_key: 'platform' }, memoryReady: true, mock: true, hasApiKey: true });
  h.assertEqual('mock pas prod', mock.readyForProd, false);
  h.assertEqual('mock pas connected', mock.connected, false);

  const fresh = resoudreStatut({ memoryReady: true, mock: false, hasApiKey: false });
  h.assertEqual('sans clé pas prod', fresh.readyForProd, false);

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
