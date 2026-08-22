require('dotenv').config();
const { getDb, queryAll } = require('../database');

async function main() {
  const db = await getDb();
  console.log('USERS', await queryAll(db, 'SELECT id,email,telephone,role,telephone_verified FROM users'));
  console.log('PROP', await queryAll(db, 'SELECT id,email,telephone FROM proprietaires'));
  console.log('EMP', await queryAll(db, 'SELECT id,email,telephone FROM employes'));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
