require('dotenv').config();

const { getDb, saveDb } = require('../database');
const logger = require('../logger');

getDb()
  .then(() => {
    saveDb();
    logger.info('scripts/migrate.js', 'Migrations SQLite appliquees');
  })
  .catch((err) => {
    logger.error('scripts/migrate.js', 'Migration SQLite echouee', err);
    process.exit(1);
  });
