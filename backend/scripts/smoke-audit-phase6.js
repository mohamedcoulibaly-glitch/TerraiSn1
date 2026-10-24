/** Smoke Phase 6 — audit propriétaire. */
const { getDb, queryOne, runSql } = require('../database');
const { listAuditProprietaire, logActivite } = require('../services/auditService');

async function main() {
  const db = await getDb();
  const terrain = queryOne(
    db,
    `SELECT t.id, t.proprietaire_id FROM terrains t
     WHERE t.proprietaire_id IS NOT NULL LIMIT 1`,
  );
  if (!terrain) {
    console.log('aucun terrain — skip');
    return;
  }
  const gerant = queryOne(
    db,
    `SELECT gerant_id FROM gerants_terrains WHERE terrain_id = ? AND actif = 1 LIMIT 1`,
    [terrain.id],
  );

  if (gerant) {
    await logActivite({
      gerant_id: gerant.gerant_id,
      terrain_id: terrain.id,
      action: 'qr_scanne',
      details: { joueur_nom: 'Smoke Joueur' },
    });
  }

  const payload = await listAuditProprietaire(terrain.proprietaire_id, {
    periode: 'mois',
    type: 'tout',
  });
  console.log('terrains:', payload.terrains.length);
  console.log('gardes:', payload.gardes.length);
  console.log('activites:', payload.activites.length);
  if (payload.activites[0]) {
    console.log('sample:', payload.activites[0].action, '|', payload.activites[0].detail, '|', payload.activites[0].gerant_nom);
  }

  const scans = await listAuditProprietaire(terrain.proprietaire_id, {
    periode: 'mois',
    type: 'scan_qr',
  });
  console.log('filtre scan_qr:', scans.activites.length >= 1 ? `OK (${scans.activites.length})` : 'FAIL');
  if (scans.activites.length < 1) process.exit(1);

  const encaiss = await listAuditProprietaire(terrain.proprietaire_id, {
    type: 'encaissement',
  });
  console.log('filtre encaissement (vide attendu):', encaiss.activites.length === 0 ? 'OK' : 'FAIL');

  console.log('Phase 6 smoke OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
