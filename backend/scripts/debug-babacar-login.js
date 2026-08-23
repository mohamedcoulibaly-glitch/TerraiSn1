const bcrypt = require('bcryptjs');
const { getDb, queryOne, queryAll } = require('../database');

(async () => {
  const db = await getDb();
  const rows = await queryAll(
    db,
    `SELECT id, email, telephone, whatsapp_number, is_active, terrain_id,
            substr(password_hash,1,20) AS hash_prefix
     FROM employes
     WHERE email LIKE '%babacar%' OR telephone LIKE '%750147138%' OR whatsapp_number LIKE '%750147138%'`,
  );
  console.log('matches', rows);
  const e = await queryOne(db, `SELECT * FROM employes WHERE email = ?`, ['babacar.sene@gmail.com']);
  if (e) {
    console.log('compare password123', bcrypt.compareSync('password123', e.password_hash));
    console.log('full', {
      id: e.id,
      email: e.email,
      telephone: e.telephone,
      is_active: e.is_active,
      terrain_id: e.terrain_id,
    });
  } else {
    console.log('NO USER FOUND');
    console.log('all emails', await queryAll(db, 'SELECT id, email, telephone FROM employes'));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
