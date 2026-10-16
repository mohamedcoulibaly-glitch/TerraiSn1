const { createHarness } = require('../helpers/harness');
const { gerantDeepLink } = require('../../lib/gerantDeepLink');

const h = createHarness('us06');

h.assertEqual('lien backoffice', gerantDeepLink({}), '/backoffice/gerant');
h.assertEqual('lien mono-host', gerantDeepLink({ GERANT_MONO_HOST: '1' }), '/pro');

const events = [];
function publish(terrainId, type, payload) {
  events.push({ terrainId, type, payload });
}
publish(4, 'reservation_confirmee', { reservation_id: 9, statut: 'confirme' });
publish(8, 'horaires', {});
h.assertEqual('event du terrain 4', events.filter((e) => e.terrainId === 4 && e.type === 'reservation_confirmee').length, 1);
h.assert('pas de confirm sur un autre type', events.filter((e) => e.type === 'reservation_confirmee' && e.terrainId === 8).length === 0);

h.exitIfFailed();
