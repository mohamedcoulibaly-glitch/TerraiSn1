const { createHarness } = require('../helpers/harness');
const { resoudreStatut } = require('../../services/whatsappStatus');

const h = createHarness('us12');

const ghost = resoudreStatut({
  dbRow: { status: 'down', session_key: 'platform' },
  memoryReady: true,
  mock: false,
  hasApiKey: true,
});
h.assertEqual('DB down prime sur la mémoire', ghost.connected, false);

const up = resoudreStatut({
  dbRow: { status: 'ready', session_key: 'platform' },
  memoryReady: false,
  mock: false,
  hasApiKey: true,
});
h.assertEqual('DB ready', up.connected, true);
h.assertEqual('readyForProd', up.readyForProd, true);

const noKey = resoudreStatut({
  dbRow: null,
  memoryReady: false,
  mock: false,
  hasApiKey: false,
});
h.assertEqual('GET sans ligne ne crée pas ready', noKey.status, 'down');
h.assertEqual('pas readyForProd sans clé', noKey.readyForProd, false);

h.exitIfFailed();
