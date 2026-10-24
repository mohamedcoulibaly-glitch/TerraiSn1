/**
 * Smoke Phase 7 — sites admin + PATCH rattachement (sans HTTP).
 */
const { getDb, queryOne, queryAll, runSql } = require('../database');
const { ensureSite } = require('../services/siteService');

async function main() {
  const db = await getDb();
  const terrain = queryOne(db, 'SELECT id, proprietaire_id, site_id, nom FROM terrains LIMIT 1');
  if (!terrain) throw new Error('Aucun terrain en base');

  const siteId = ensureSite(db, {
    proprietaire_id: terrain.proprietaire_id,
    nom: `_smoke_p7_${Date.now()}`,
    ville: 'Dakar',
  });
  const site = queryOne(db, 'SELECT * FROM sites WHERE id = ?', [siteId]);
  if (!site) throw new Error('ensureSite a échoué');

  const sitesProprio = queryAll(
    db,
    'SELECT id FROM sites WHERE proprietaire_id = ?',
    [terrain.proprietaire_id],
  );
  if (!sitesProprio.some((s) => Number(s.id) === Number(siteId))) {
    throw new Error('Liste sites proprio incomplète');
  }

  runSql(db, 'UPDATE terrains SET site_id = ? WHERE id = ?', [siteId, terrain.id]);
  const after = queryOne(db, 'SELECT id, site_id, proprietaire_id FROM terrains WHERE id = ?', [terrain.id]);
  if (Number(after.site_id) !== Number(siteId)) throw new Error('PATCH site_id simulé KO');

  // Restaure site_id précédent pour ne pas polluer le seed
  runSql(db, 'UPDATE terrains SET site_id = ? WHERE id = ?', [terrain.site_id ?? null, terrain.id]);

  console.log(
    JSON.stringify({
      ok: true,
      terrain_id: terrain.id,
      site_id: siteId,
      sites_proprio: sitesProprio.length,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
