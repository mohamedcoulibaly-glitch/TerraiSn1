/** Smoke Phase 2 — sites + contrainte. */
const { getDb, queryOne, queryAll, saveDb } = require('../database');
const {
  ensureSite,
  assignerTerrainAuSite,
  assertGerantCompatibleAvecTerrain,
} = require('../services/siteService');

async function main() {
  const db = await getDb();
  const siteCount = queryOne(db, "SELECT COUNT(1) AS n FROM sqlite_master WHERE type='table' AND name='sites'");
  const col = queryAll(db, 'PRAGMA table_info(terrains)').some((c) => c.name === 'site_id');
  console.log('table sites:', siteCount?.n ? 'OK' : 'MISSING');
  console.log('terrains.site_id:', col ? 'OK' : 'MISSING');
  if (!siteCount?.n || !col) process.exit(1);

  const t = queryOne(db, 'SELECT id, proprietaire_id FROM terrains LIMIT 1');
  if (!t) {
    console.log('aucun terrain — schéma OK, skip assert');
    saveDb();
    return;
  }

  const sid = ensureSite(db, {
    proprietaire_id: t.proprietaire_id,
    nom: '_smoke_site_phase2',
    ville: 'Dakar',
  });
  assignerTerrainAuSite(db, t.id, sid);
  const after = queryOne(db, 'SELECT site_id FROM terrains WHERE id = ?', [t.id]);
  console.log(`assign site: terrain=${t.id} → site_id=${after.site_id}`);

  // Gérant sans rattachement actif → premier lien toujours OK
  const orphan = queryOne(
    db,
    `SELECT e.id FROM employes e
     WHERE NOT EXISTS (
       SELECT 1 FROM gerants_terrains gt WHERE gt.gerant_id = e.id AND gt.actif = 1
     )
     LIMIT 1`,
  );
  if (orphan) {
    assertGerantCompatibleAvecTerrain(db, orphan.id, t.id);
    console.log(`assert premier lien OK gerant=${orphan.id}`);
  } else {
    console.log('pas de gérant orphelin — skip assert premier lien');
  }

  // Même site / même proprio : gérant déjà lié à ce terrain
  const linked = queryOne(
    db,
    `SELECT gt.gerant_id AS id FROM gerants_terrains gt
     WHERE gt.terrain_id = ? AND gt.actif = 1 LIMIT 1`,
    [t.id],
  );
  if (linked) {
    assertGerantCompatibleAvecTerrain(db, linked.id, t.id);
    console.log(`assert même terrain OK gerant=${linked.id}`);
  }

  saveDb();
  console.log('Phase 2 smoke OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
