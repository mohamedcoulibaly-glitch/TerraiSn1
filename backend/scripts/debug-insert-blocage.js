const { getDb, queryAll, queryOne, runSql } = require('../database');

(async () => {
  const db = await getDb();
  const before = await queryAll(db, "SELECT * FROM blocages_creneaux WHERE date='2026-08-16'");
  console.log('before', before.length, before);

  const result = await runSql(
    db,
    'INSERT INTO blocages_creneaux (terrain_id, employe_id, date, heure_debut, heure_fin, motif) VALUES (?, ?, ?, ?, ?, ?)',
    [1, 7, '2026-08-16', '15:00', '16:00', 'test'],
  );
  console.log('insert result', result);

  await runSql(
    db,
    `UPDATE creneaux SET statut = 'bloque' WHERE terrain_id = ? AND date = ? AND heure_debut >= ? AND heure_debut < ?`,
    [1, '2026-08-16', '15:00', '16:00'],
  );

  const blocage = await queryOne(db, 'SELECT * FROM blocages_creneaux WHERE id = ?', [result.lastInsertRowid]);
  console.log('fetched by lastInsertRowid', blocage);

  const all = await queryAll(db, "SELECT * FROM blocages_creneaux WHERE date='2026-08-16' ORDER BY id DESC LIMIT 3");
  console.log('latest', all);

  // cleanup
  if (result.lastInsertRowid) {
    await runSql(db, 'DELETE FROM blocages_creneaux WHERE id = ?', [result.lastInsertRowid]);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
