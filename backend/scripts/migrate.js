require('dotenv').config();

const { getDb, saveDb } = require('../database');
const logger = require('../logger');

/** Postgres : le schéma est créé dans getDb() / initSchema. */
async function main() {
  await getDb();
  saveDb();
  logger.info('scripts/migrate.js', 'Schema PostgreSQL pret (initSchema)');
}

main().catch((err) => {
  logger.error('scripts/migrate.js', 'Migration echouee', err);
  process.exit(1);
});
