/**
 * Crée le propriétaire Mohamed Coulibaly (77 826 12 25)
 * et le rattache au gérant Babacar Sene.
 *
 * Usage: node scripts/ensure-mohamed-proprietaire.js
 */
const bcrypt = require('bcryptjs');
const { getDb, queryOne, runSql, saveDb } = require('../database');

const EMAIL = 'mohamed.coulibaly@terrainsn.sn';
const TELEPHONE = '+221 77 826 12 25';
const PASSWORD = 'password123';
const NOM = 'Mohamed Coulibaly';
const PRENOM = 'Mohamed';

async function main() {
  const db = await getDb();
  const hash = bcrypt.hashSync(PASSWORD, 10);

  const babacar = await queryOne(
    db,
    `SELECT id, nom, email, terrain_id, proprietaire_id
     FROM employes
     WHERE email = 'babacar.sene@gmail.com'
        OR nom LIKE '%Babacar Sene%'
     ORDER BY id DESC
     LIMIT 1`,
  );
  if (!babacar) {
    console.error('Gérant Babacar Sene introuvable — lance d’abord ensure-babacar-gerant.js');
    process.exit(1);
  }

  let proprio = await queryOne(
    db,
    `SELECT * FROM proprietaires
     WHERE email = ?
        OR REPLACE(REPLACE(telephone, ' ', ''), '+', '') LIKE '%778261225%'`,
    [EMAIL],
  );

  if (proprio) {
    await runSql(
      db,
      `UPDATE proprietaires SET
         nom = ?, prenom = ?, email = ?, telephone = ?, password_hash = ?,
         plan = 'premium', statut = 'actif', must_change_password = 0
       WHERE id = ?`,
      [NOM, PRENOM, EMAIL, TELEPHONE, hash, proprio.id],
    );
  } else {
    await runSql(
      db,
      `INSERT INTO proprietaires (nom, prenom, email, telephone, password_hash, plan, statut)
       VALUES (?, ?, ?, ?, ?, 'premium', 'actif')`,
      [NOM, PRENOM, EMAIL, TELEPHONE, hash],
    );
    proprio = await queryOne(db, 'SELECT * FROM proprietaires WHERE email = ?', [EMAIL]);
  }

  // Le même numéro était sur le gérant démo Mohamed : on le libère
  // pour que la connexion téléphone ouvre l’espace propriétaire.
  await runSql(
    db,
    `UPDATE employes
     SET telephone = CASE
           WHEN REPLACE(REPLACE(COALESCE(telephone, ''), ' ', ''), '+', '') LIKE '%778261225%'
           THEN NULL ELSE telephone END,
         whatsapp_number = CASE
           WHEN REPLACE(REPLACE(COALESCE(whatsapp_number, ''), ' ', ''), '+', '') LIKE '%778261225%'
           THEN '000000000' ELSE whatsapp_number END
     WHERE id != ?
       AND (
         REPLACE(REPLACE(COALESCE(telephone, ''), ' ', ''), '+', '') LIKE '%778261225%'
         OR REPLACE(REPLACE(COALESCE(whatsapp_number, ''), ' ', ''), '+', '') LIKE '%778261225%'
       )`,
    [babacar.id],
  );

  let terrain = await queryOne(db, 'SELECT id, nom, proprietaire_id, is_active FROM terrains WHERE id = ?', [
    babacar.terrain_id,
  ]);
  if (!terrain) {
    terrain = await queryOne(
      db,
      'SELECT id, nom, proprietaire_id, is_active FROM terrains WHERE COALESCE(is_active, 1) = 1 ORDER BY id LIMIT 1',
    );
  }
  if (!terrain) {
    console.error('Aucun terrain à rattacher');
    process.exit(1);
  }

  await runSql(db, 'UPDATE terrains SET proprietaire_id = ?, telephone = ?, is_active = 1 WHERE id = ?', [
    proprio.id,
    TELEPHONE,
    terrain.id,
  ]);

  await runSql(
    db,
    `UPDATE employes SET proprietaire_id = ?, terrain_id = ?, is_active = 1
     WHERE id = ?`,
    [proprio.id, terrain.id, babacar.id],
  );

  saveDb();

  const linked = await queryOne(
    db,
    `SELECT e.id AS gerant_id, e.nom AS gerant_nom, e.email AS gerant_email,
            e.telephone AS gerant_tel, t.id AS terrain_id, t.nom AS terrain_nom,
            p.id AS proprio_id, p.nom AS proprio_nom, p.email AS proprio_email,
            p.telephone AS proprio_tel
     FROM employes e
     JOIN terrains t ON t.id = e.terrain_id
     JOIN proprietaires p ON p.id = e.proprietaire_id
     WHERE e.id = ?`,
    [babacar.id],
  );

  console.log('ok', linked);
  console.log(`login proprio: ${TELEPHONE}  ou  ${EMAIL}  /  ${PASSWORD}`);
  console.log(`login gérant : ${linked.gerant_email}  /  ${PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
