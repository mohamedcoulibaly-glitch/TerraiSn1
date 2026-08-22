/**
 * Applique migrations/002_babacar.sql de façon idempotente.
 * Usage: node scripts/apply_002_babacar.js
 */
const path = require('path');
const { getDb, queryAll, runSql, saveDb } = require('../database');

async function hasColumn(db, table, column) {
  const cols = await queryAll(db, `PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

(async () => {
  const db = await getDb();
  const applied = [];
  const skipped = [];

  if (!(await hasColumn(db, 'users', 'refresh_token'))) {
    await runSql(db, 'ALTER TABLE users ADD COLUMN refresh_token TEXT');
    applied.push('refresh_token');
  } else {
    skipped.push('refresh_token');
  }

  if (!(await hasColumn(db, 'users', 'refresh_token_expire_at'))) {
    await runSql(db, 'ALTER TABLE users ADD COLUMN refresh_token_expire_at DATETIME');
    applied.push('refresh_token_expire_at');
  } else {
    skipped.push('refresh_token_expire_at');
  }

  if (!(await hasColumn(db, 'users', 'statut'))) {
    await runSql(
      db,
      "ALTER TABLE users ADD COLUMN statut TEXT DEFAULT 'actif' CHECK(statut IN ('actif', 'suspendu', 'bloque'))"
    );
    applied.push('statut');
  } else {
    skipped.push('statut');
  }

  await runSql(db, "UPDATE users SET statut = 'actif' WHERE statut IS NULL OR TRIM(statut) = ''");
  saveDb();

  const cols = (await queryAll(db, 'PRAGMA table_info(users)'))
    .filter((c) => ['refresh_token', 'refresh_token_expire_at', 'statut'].includes(c.name))
    .map((c) => `${c.name}:${c.type}${c.dflt_value != null ? ` default=${c.dflt_value}` : ''}`);

  console.log('Applied:', applied.length ? applied.join(', ') : '(none)');
  console.log('Skipped (already present):', skipped.length ? skipped.join(', ') : '(none)');
  console.log('Verified columns:', cols.join(' | '));
  console.log('Migration 002_babacar OK');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
