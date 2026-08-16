const bcrypt = require('bcryptjs');
const { getDb, queryOne, runSql, saveDb } = require('../database');

const EMAIL = 'babacar.sene@gmail.com';
const TELEPHONE = '+221 75 014 71 38';
const WHATSAPP = '+221750147138';
const PASSWORD = 'password123';

async function main() {
  const db = await getDb();
  const hash = bcrypt.hashSync(PASSWORD, 10);

  // Préférer Complexe Sportif Pikine s'il n'a pas déjà un gérant actif
  let terrain = queryOne(
    db,
    `SELECT t.id, t.nom, t.proprietaire_id
     FROM terrains t
     WHERE t.id = 1
       AND NOT EXISTS (
         SELECT 1 FROM employes e
         WHERE e.terrain_id = t.id AND COALESCE(e.is_active, 1) = 1
       )`,
  );

  if (!terrain) {
    terrain = queryOne(
      db,
      `SELECT t.id, t.nom, t.proprietaire_id
       FROM terrains t
       WHERE COALESCE(t.is_active, 1) = 1
         AND NOT EXISTS (
           SELECT 1 FROM employes e
           WHERE e.terrain_id = t.id AND COALESCE(e.is_active, 1) = 1
         )
       ORDER BY t.id
       LIMIT 1`,
    );
  }

  if (!terrain) {
    terrain = queryOne(
      db,
      'SELECT id, nom, proprietaire_id FROM terrains WHERE COALESCE(is_active, 1) = 1 ORDER BY id LIMIT 1',
    );
  }

  if (!terrain) {
    console.error('Aucun terrain en base — lance npm run seed');
    process.exit(1);
  }

  const existing = queryOne(
    db,
    `SELECT id FROM employes
     WHERE email = ?
        OR REPLACE(REPLACE(telephone, ' ', ''), '+', '') LIKE ?
        OR REPLACE(REPLACE(whatsapp_number, ' ', ''), '+', '') LIKE ?`,
    [EMAIL, '%750147138%', '%750147138%'],
  );

  if (existing) {
    runSql(
      db,
      `UPDATE employes SET
         proprietaire_id = ?, terrain_id = ?, nom = ?, prenom = ?, email = ?,
         password_hash = ?, telephone = ?, whatsapp_number = ?, is_active = 1
       WHERE id = ?`,
      [
        terrain.proprietaire_id,
        terrain.id,
        'Babacar Sene',
        'Babacar',
        EMAIL,
        hash,
        TELEPHONE,
        WHATSAPP,
        existing.id,
      ],
    );
    console.log('updated id', existing.id);
  } else {
    const result = runSql(
      db,
      `INSERT INTO employes
         (proprietaire_id, terrain_id, nom, prenom, email, password_hash, telephone, whatsapp_number, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        terrain.proprietaire_id,
        terrain.id,
        'Babacar Sene',
        'Babacar',
        EMAIL,
        hash,
        TELEPHONE,
        WHATSAPP,
      ],
    );
    console.log('inserted id', result?.lastInsertRowid || result);
  }

  saveDb();

  const row = queryOne(
    db,
    `SELECT e.id, e.nom, e.prenom, e.email, e.telephone, e.whatsapp_number,
            e.terrain_id, e.is_active, t.nom AS terrain_nom
     FROM employes e
     LEFT JOIN terrains t ON t.id = e.terrain_id
     WHERE e.email = ?`,
    [EMAIL],
  );

  console.log('ok', row);
  console.log(`login: ${EMAIL} / ${PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
