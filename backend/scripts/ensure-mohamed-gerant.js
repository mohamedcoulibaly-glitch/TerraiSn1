const bcrypt = require('bcryptjs');
const { getDb, queryOne, queryAll, runSql, saveDb } = require('../database');

async function main() {
  const db = await getDb();
  const emails = (await queryAll(db, 'SELECT id, email FROM employes')).map((e) => e.email);
  console.log('employes:', emails.join(', ') || '(aucun)');

  const hash = bcrypt.hashSync('password123', 10);
  const existing = await queryOne(db, "SELECT id FROM employes WHERE email = ?", ['mohamed.gerant@gmail.com']);

  if (existing) {
    await runSql(db, 'UPDATE employes SET password_hash = ?, is_active = 1 WHERE id = ?', [hash, existing.id]);
    console.log('updated id', existing.id);
  } else {
    const terrain = await queryOne(db, 'SELECT id, proprietaire_id FROM terrains WHERE COALESCE(is_active, 1) = 1 ORDER BY id LIMIT 1');
    if (!terrain) {
      console.error('aucun terrain en base — lance npm run seed');
      process.exit(1);
    }
    await runSql(
      db,
      `INSERT INTO employes (proprietaire_id, terrain_id, nom, prenom, email, password_hash, telephone, whatsapp_number, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [terrain.proprietaire_id, terrain.id, 'Mohamed Coulibaly', 'Mohamed', 'mohamed.gerant@gmail.com', hash, '+221 77 826 12 25', '+221778261225']
    );
    console.log('inserted for terrain', terrain.id);
  }

  saveDb();
  const row = await queryOne(db, "SELECT id, email, is_active FROM employes WHERE email = ?", ['mohamed.gerant@gmail.com']);
  console.log('ok', row);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
