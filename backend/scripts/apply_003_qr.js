/**
 * Applique migrations/003_qr_code_url.sql de façon idempotente.
 * Usage: node scripts/apply_003_qr.js
 */
const { getDb, queryAll, runSql, saveDb } = require('../database');

async function hasColumn(db, table, column) {
  const cols = await queryAll(db, `PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

(async () => {
  const db = await getDb();
  if (!(await hasColumn(db, 'reservations', 'qr_code_url'))) {
    await runSql(db, 'ALTER TABLE reservations ADD COLUMN qr_code_url TEXT');
    console.log('Applied: qr_code_url');
  } else {
    console.log('Skipped: qr_code_url already present');
  }
  saveDb();
  const cols = (await queryAll(db, 'PRAGMA table_info(reservations)'))
    .filter((c) => c.name.includes('qr'))
    .map((c) => c.name);
  console.log('QR columns:', cols.join(', ') || '(none)');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
