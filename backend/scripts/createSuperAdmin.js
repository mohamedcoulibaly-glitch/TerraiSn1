require('dotenv').config();
const bcrypt = require('bcryptjs');
const { getDb, queryOne, runSql, saveDb } = require('../database');

async function main() {
  const telephone = process.argv[2] || process.env.SUPER_ADMIN_PHONE;
  const password = process.argv[3] || process.env.SUPER_ADMIN_PASSWORD;
  const nom = process.argv[4] || 'Super Admin';
  const email = process.env.SUPER_ADMIN_EMAIL || `admin-${String(telephone || '').replace(/\D/g, '')}@terrainsn.local`;
  if (!telephone || !password || password.length < 8) {
    throw new Error('Usage: node scripts/createSuperAdmin.js <telephone> <mot-de-passe-8-caracteres-minimum> [nom]');
  }
  const db = await getDb();
  if (await queryOne(db, "SELECT id FROM users WHERE role = 'super_admin'")) {
    throw new Error('Un compte super_admin existe déjà');
  }
  await runSql(db, `INSERT INTO users (nom, email, telephone, password_hash, role, is_active, must_change_password)
    VALUES (?, ?, ?, ?, 'super_admin', 1, 0)`, [nom, email, telephone, bcrypt.hashSync(password, 12)]);
  saveDb();
  console.log('Compte super_admin créé.');
}

main().catch((error) => { console.error(error.message); process.exit(1); });
