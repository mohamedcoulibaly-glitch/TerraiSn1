require('dotenv').config();
const { getDb, queryAll } = require('../database');

getDb().then((db) => {
  console.log('USERS', queryAll(db, 'SELECT id,email,telephone,role,telephone_verified FROM users'));
  console.log('PROP', queryAll(db, 'SELECT id,email,telephone FROM proprietaires'));
  console.log('EMP', queryAll(db, 'SELECT id,email,telephone FROM employes'));
  process.exit(0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
