/**
 * Comptes stables pour la campagne E2E (US-28).
 * À lancer avec DB_PATH pointant vers une base dédiée.
 * Ne touche pas seed.js démo.
 *
 * joueur        77 111 11 11   E2eJoueur!1
 * gérant        77 222 22 22   E2eGerant!1
 * propriétaire  78 333 33 33   E2eProprio!1
 * superadmin    70 444 44 44   E2eSuper!1
 */
const bcrypt = require('bcryptjs');
const { getDb, queryOne, runSql } = require('../database');

const COMPTES = [
  { role: 'joueur', nom: 'E2E Joueur', email: 'e2e.joueur@terrainsn.test', tel: '+221 77 111 11 11', password: 'E2eJoueur!1' },
  { role: 'superadmin', nom: 'E2E Super', email: 'e2e.super@terrainsn.test', tel: '+221 70 444 44 44', password: 'E2eSuper!1' },
];

async function seedE2E() {
  const db = await getDb();
  const hash = bcrypt.hashSync('E2eJoueur!1', 4);
  for (const compte of COMPTES) {
    const existing = queryOne(db, 'SELECT id FROM users WHERE email = ?', [compte.email]);
    const h = compte.role === 'joueur' ? hash : bcrypt.hashSync(compte.password, 4);
    if (existing) {
      runSql(db, 'UPDATE users SET nom = ?, telephone = ?, password_hash = ?, role = ?, telephone_verified = 1, is_active = 1 WHERE id = ?', [
        compte.nom, compte.tel, h, compte.role, existing.id,
      ]);
    } else {
      runSql(
        db,
        `INSERT INTO users (nom, email, password_hash, telephone, role, is_active, telephone_verified)
         VALUES (?, ?, ?, ?, ?, 1, 1)`,
        [compte.nom, compte.email, h, compte.tel, compte.role],
      );
    }
  }

  let proprio = queryOne(db, 'SELECT id FROM proprietaires WHERE email = ?', ['e2e.proprio@terrainsn.test']);
  if (!proprio) {
    const id = runSql(
      db,
      `INSERT INTO proprietaires (nom, email, password_hash, telephone, statut)
       VALUES ('E2E Proprio', 'e2e.proprio@terrainsn.test', ?, '+221 78 333 33 33', 'actif')`,
      [bcrypt.hashSync('E2eProprio!1', 4)],
    ).lastInsertRowid;
    proprio = { id };
  }

  let avance = queryOne(db, "SELECT id FROM terrains WHERE nom = 'E2E Avance'");
  if (!avance) {
    avance = {
      id: runSql(
        db,
        `INSERT INTO terrains (proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_entier, prix_moitie, is_active, politique_paiement)
         VALUES (?, 'E2E Avance', 'Dakar', 'Dakar', 'foot', '5v5', 30000, 40000, 18000, 1, 'avance')`,
        [proprio.id],
      ).lastInsertRowid,
    };
  }
  let sans = queryOne(db, "SELECT id FROM terrains WHERE nom = 'E2E Sans avance'");
  if (!sans) {
    sans = {
      id: runSql(
        db,
        `INSERT INTO terrains (proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_entier, prix_moitie, is_active, politique_paiement)
         VALUES (?, 'E2E Sans avance', 'Dakar', 'Dakar', 'foot', '5v5', 30000, 40000, 18000, 1, 'sans_avance')`,
        [proprio.id],
      ).lastInsertRowid,
    };
  }

  const gerantEmail = 'e2e.gerant@terrainsn.test';
  let gerant = queryOne(db, 'SELECT id FROM employes WHERE email = ?', [gerantEmail]);
  if (!gerant) {
    gerant = {
      id: runSql(
        db,
        `INSERT INTO employes (proprietaire_id, terrain_id, nom, email, password_hash, telephone, whatsapp_number, is_active)
         VALUES (?, ?, 'E2E Gerant', ?, ?, '+221 77 222 22 22', '221772222222', 1)`,
        [proprio.id, avance.id, gerantEmail, bcrypt.hashSync('E2eGerant!1', 4)],
      ).lastInsertRowid,
    };
  }
  return { proprioId: proprio.id, terrainAvance: avance.id, terrainSans: sans.id, gerantId: gerant.id };
}

if (require.main === module) {
  seedE2E()
    .then((ids) => {
      console.log('seed e2e ok', ids);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { seedE2E, COMPTES };
