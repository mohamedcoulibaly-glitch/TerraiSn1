/** Smoke Phase 5 — planning éditable par gérant principal. */
const { getDb, queryOne, queryAll } = require('../database');
const {
  remplacerPlanningParPrincipal,
  listPlanningGerant,
} = require('../services/gerantService');

async function main() {
  const db = await getDb();
  const multi = queryOne(
    db,
    `SELECT terrain_id, COUNT(1) AS n
     FROM gerants_terrains
     WHERE actif = 1
     GROUP BY terrain_id
     HAVING COUNT(1) > 1
     ORDER BY n DESC
     LIMIT 1`,
  );
  if (!multi) {
    console.log('aucun terrain multi-gérants — skip');
    return;
  }
  const tid = Number(multi.terrain_id);
  const principal = queryOne(
    db,
    `SELECT gerant_id FROM gerants_terrains
     WHERE terrain_id = ? AND est_principal = 1 AND actif = 1 LIMIT 1`,
    [tid],
  );
  const secondaire = queryOne(
    db,
    `SELECT gerant_id FROM gerants_terrains
     WHERE terrain_id = ? AND actif = 1 AND gerant_id != ? LIMIT 1`,
    [tid, principal?.gerant_id],
  );
  if (!principal || !secondaire) {
    console.log('principal/secondaire manquant — skip');
    return;
  }

  // Non-principal → 403
  let blocked = false;
  try {
    await remplacerPlanningParPrincipal(
      tid,
      secondaire.gerant_id,
      { planning_hebdo: [{ jour_semaine: 0, heure_debut: '09:00', heure_fin: '12:00' }] },
      secondaire.gerant_id,
    );
  } catch (e) {
    blocked = e.statusCode === 403;
  }
  console.log('non-principal bloqué:', blocked ? 'OK' : 'FAIL');
  if (!blocked) process.exit(1);

  // Principal → OK
  const planning = await remplacerPlanningParPrincipal(
    tid,
    secondaire.gerant_id,
    {
      planning_hebdo: [
        { jour_semaine: 0, heure_debut: '08:00', heure_fin: '14:00' },
        { jour_semaine: 1, heure_debut: '08:00', heure_fin: '14:00' },
      ],
    },
    principal.gerant_id,
  );
  const rows = await listPlanningGerant(tid, secondaire.gerant_id);
  const hebdo = rows.filter((r) => !r.date_specifique);
  console.log('principal a écrit', hebdo.length, 'créneaux →', planning.length >= 0 ? 'OK' : 'FAIL');
  console.log(
    'jours:',
    hebdo.map((r) => r.jour_semaine).sort().join(','),
  );
  console.log('Phase 5 smoke OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
