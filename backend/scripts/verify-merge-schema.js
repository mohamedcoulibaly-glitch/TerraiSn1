/** Vérifie que les tables merge_final existent après initDb. */
const { getDb, queryAll, saveDb } = require('../database');

async function main() {
  const db = await getDb();
  const wanted = [
    'terrain_formats',
    'terrain_durees',
    'sites',
    'gerants_terrains',
    'planning_garde',
    'push_logs',
    'resume_dette_periode',
    'user_favoris',
    'notif_preferences',
  ];
  const rows = queryAll(
    db,
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${wanted.map(() => '?').join(',')}) ORDER BY name`,
    wanted,
  );
  const found = new Set(rows.map((r) => r.name));
  const missing = wanted.filter((n) => !found.has(n));
  console.log('tables:', [...found].join(', '));
  if (missing.length) {
    console.error('MISSING:', missing.join(', '));
    process.exit(1);
  }
  const cols = queryAll(db, 'PRAGMA table_info(terrains)');
  const colNames = new Set(cols.map((c) => c.name));
  for (const c of ['politique_paiement', 'delai_verrou_paiement_min', 'delai_paiement_dette_jours', 'site_id']) {
    if (!colNames.has(c)) {
      console.error('MISSING column terrains.' + c);
      process.exit(1);
    }
  }
  console.log('OK merge schema');
  saveDb(db);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
