/** Smoke Phase 3 — alertes cross-terrain. */
const { getDb, queryOne, queryAll } = require('../database');
const { listAlertesTerrainsGerant } = require('../services/gerantService');

async function main() {
  const db = await getDb();
  const multi = queryOne(
    db,
    `SELECT gerant_id, COUNT(1) AS n
     FROM gerants_terrains
     WHERE actif = 1
     GROUP BY gerant_id
     HAVING COUNT(1) > 1
     ORDER BY n DESC
     LIMIT 1`,
  );
  if (!multi) {
    console.log('aucun gérant multi-terrains — skip');
    return;
  }

  const payload = await listAlertesTerrainsGerant(multi.gerant_id);
  console.log('gerant_id:', multi.gerant_id);
  console.log('terrains:', payload.terrains.length);
  for (const t of payload.terrains) {
    console.log(
      `  #${t.id} ${t.nom} — imminents=${t.imminents_count} scan=${t.en_attente_scan} libres=${t.creneaux_libres_maintenant}`,
    );
  }
  console.log('heure_serveur:', payload.heure_serveur);
  console.log('Phase 3 smoke OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
