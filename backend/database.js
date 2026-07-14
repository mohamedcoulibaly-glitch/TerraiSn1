const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.resolve(__dirname, 'terrainsn.db');

let db = null;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();
  
  // Charger la DB depuis le fichier si elle existe
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  initDb(db);
  saveDb();
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

function initDb(database) {
  database.run('PRAGMA journal_mode = WAL');
  database.run('PRAGMA busy_timeout = 5000');
  database.run('PRAGMA foreign_keys = ON');
  // 1. users (joueurs & superadmin)
  database.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    telephone VARCHAR(50),
    role VARCHAR(50) DEFAULT 'joueur',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 2. proprietaires
  database.run(`CREATE TABLE IF NOT EXISTS proprietaires (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    telephone VARCHAR(50),
    plan VARCHAR(50) DEFAULT 'free',
    statut VARCHAR(50) DEFAULT 'actif',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 3. terrains
  database.run(`CREATE TABLE IF NOT EXISTS terrains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proprietaire_id INTEGER NOT NULL,
    nom VARCHAR(255) NOT NULL,
    adresse VARCHAR(255),
    ville VARCHAR(100),
    sport VARCHAR(50) DEFAULT 'foot',
    type VARCHAR(50) DEFAULT '11 vs 11',
    prix_heure DECIMAL(10, 2) NOT NULL,
    description TEXT,
    telephone VARCHAR(50),
    photos TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (proprietaire_id) REFERENCES proprietaires(id)
  )`);

  // 4. employes
  database.run(`CREATE TABLE IF NOT EXISTS employes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proprietaire_id INTEGER NOT NULL,
    terrain_id INTEGER,
    nom VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    telephone VARCHAR(50),
    whatsapp_number VARCHAR(50) NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (proprietaire_id) REFERENCES proprietaires(id),
    FOREIGN KEY (terrain_id) REFERENCES terrains(id)
  )`);

  // 5. horaires
  database.run(`CREATE TABLE IF NOT EXISTS horaires (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terrain_id INTEGER NOT NULL,
    jour VARCHAR(20),
    heure_debut TIME,
    heure_fin TIME,
    est_ouvert INTEGER DEFAULT 1,
    FOREIGN KEY (terrain_id) REFERENCES terrains(id)
  )`);

  // 6. blocages_creneaux
  database.run(`CREATE TABLE IF NOT EXISTS blocages_creneaux (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terrain_id INTEGER NOT NULL,
    employe_id INTEGER,
    date DATE,
    heure_debut TIME,
    heure_fin TIME,
    motif VARCHAR(255),
    FOREIGN KEY (terrain_id) REFERENCES terrains(id),
    FOREIGN KEY (employe_id) REFERENCES employes(id)
  )`);

  // 7. reservations
  database.run(`CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terrain_id INTEGER NOT NULL,
    joueur_id INTEGER,
    joueur_nom VARCHAR(255),
    joueur_telephone VARCHAR(50),
    date DATE NOT NULL,
    heure_debut TIME NOT NULL,
    heure_fin TIME NOT NULL,
    montant DECIMAL(10, 2),
    statut VARCHAR(50) DEFAULT 'en_attente',
    expire_at DATETIME,
    traite_par INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (terrain_id) REFERENCES terrains(id),
    FOREIGN KEY (joueur_id) REFERENCES users(id),
    FOREIGN KEY (traite_par) REFERENCES employes(id)
  )`);

  // Créneaux persistants : ils portent le verrou de paiement atomique.
  database.run(`CREATE TABLE IF NOT EXISTS creneaux (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terrain_id INTEGER NOT NULL,
    date DATE NOT NULL,
    heure_debut TIME NOT NULL,
    heure_fin TIME NOT NULL,
    statut TEXT NOT NULL DEFAULT 'libre',
    UNIQUE (terrain_id, date, heure_debut, heure_fin),
    FOREIGN KEY (terrain_id) REFERENCES terrains(id)
  )`);

  // 8. paiements
  database.run(`CREATE TABLE IF NOT EXISTS paiements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_id INTEGER NOT NULL,
    montant DECIMAL(10, 2),
    methode VARCHAR(50),
    statut VARCHAR(50) DEFAULT 'en_attente',
    reference_externe VARCHAR(255),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id)
  )`);

  database.run(`CREATE TABLE IF NOT EXISTS matchs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_id INTEGER NOT NULL UNIQUE,
    terrain_id INTEGER NOT NULL,
    gerant_id INTEGER NOT NULL,
    montant_total DECIMAL(10, 2) NOT NULL,
    acompte_paye DECIMAL(10, 2) NOT NULL,
    solde_paye DECIMAL(10, 2) NOT NULL,
    methode_solde TEXT DEFAULT 'especes',
    joue_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id),
    FOREIGN KEY (terrain_id) REFERENCES terrains(id),
    FOREIGN KEY (gerant_id) REFERENCES employes(id)
  )`);

  // Migrations non destructives pour les bases déjà créées.
  addColumnIfMissing(database, 'reservations', 'creneau_id', 'INTEGER');
  addColumnIfMissing(database, 'reservations', 'code_reservation', 'TEXT');
  addColumnIfMissing(database, 'reservations', 'verrou_expire_at', 'INTEGER');
  addColumnIfMissing(database, 'reservations', 'cree_par', "TEXT DEFAULT 'joueur'");
  addColumnIfMissing(database, 'reservations', 'lien_paiement', 'TEXT');
  addColumnIfMissing(database, 'reservations', 'format_terrain', "TEXT DEFAULT 'entier'");
  addColumnIfMissing(database, 'reservations', 'prix_total', 'DECIMAL(10, 2)');
  addColumnIfMissing(database, 'reservations', 'acompte', 'DECIMAL(10, 2) DEFAULT 5000');
  addColumnIfMissing(database, 'reservations', 'reste_a_payer', 'DECIMAL(10, 2) DEFAULT 0');
  addColumnIfMissing(database, 'paiements', 'reference_paytech', 'TEXT');
  addColumnIfMissing(database, 'paiements', 'montant_acompte', 'INTEGER');
  addColumnIfMissing(database, 'paiements', 'montant_commission', 'INTEGER');
  addColumnIfMissing(database, 'paiements', 'montant_reverse', 'INTEGER');
  addColumnIfMissing(database, 'paiements', 'statut_reversement', "TEXT DEFAULT 'en_attente'");
  addColumnIfMissing(database, 'terrains', 'prix_moitie', 'DECIMAL(10, 2)');
  addColumnIfMissing(database, 'terrains', 'prix_entier', 'DECIMAL(10, 2)');
  addColumnIfMissing(database, 'terrains', 'montant_acompte', 'DECIMAL(10, 2) DEFAULT 5000');
  addColumnIfMissing(database, 'terrains', 'acompte', 'INTEGER DEFAULT 5000');
  addColumnIfMissing(database, 'terrains', 'commission', 'INTEGER DEFAULT 400');
  addColumnIfMissing(database, 'users', 'terrain_id', 'INTEGER');
  addColumnIfMissing(database, 'users', 'must_change_password', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'users', 'prenom', 'VARCHAR(255)');
  addColumnIfMissing(database, 'users', 'telephone_verified', 'INTEGER DEFAULT 1');
  addColumnIfMissing(database, 'proprietaires', 'must_change_password', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'employes', 'must_change_password', 'INTEGER DEFAULT 0');

  database.run(`CREATE TABLE IF NOT EXISTS auth_otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telephone VARCHAR(50) NOT NULL,
    code VARCHAR(10) NOT NULL,
    user_id INTEGER,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  database.run('CREATE INDEX IF NOT EXISTS idx_auth_otps_telephone ON auth_otps(telephone)');
  database.run("UPDATE users SET role = 'super_admin' WHERE role = 'superadmin'");
  database.run('UPDATE terrains SET prix_entier = prix_heure WHERE prix_entier IS NULL');
  database.run('UPDATE terrains SET prix_moitie = ROUND(prix_heure * 0.6) WHERE prix_moitie IS NULL');
  database.run('UPDATE terrains SET acompte = montant_acompte WHERE acompte IS NULL AND montant_acompte IS NOT NULL');
  database.run('UPDATE terrains SET montant_acompte = acompte WHERE montant_acompte IS NULL AND acompte IS NOT NULL');
  database.run('UPDATE terrains SET commission = 400 WHERE commission IS NULL');
  database.run('UPDATE reservations SET prix_total = montant WHERE prix_total IS NULL');
  database.run('UPDATE reservations SET acompte = MIN(5000, montant) WHERE acompte IS NULL');
  database.run('UPDATE reservations SET reste_a_payer = MAX(0, prix_total - acompte) WHERE reste_a_payer IS NULL');
  database.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_code ON reservations(code_reservation)');
  database.run('CREATE INDEX IF NOT EXISTS idx_users_telephone ON users(telephone)');
  database.run('CREATE INDEX IF NOT EXISTS idx_reservations_creneau ON reservations(creneau_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_reservations_statut ON reservations(statut)');
  database.run('CREATE INDEX IF NOT EXISTS idx_reservations_terrain_date ON reservations(terrain_id, date)');
  database.run('CREATE INDEX IF NOT EXISTS idx_creneaux_statut ON creneaux(statut)');
  database.run('CREATE INDEX IF NOT EXISTS idx_paiements_reservation ON paiements(reservation_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_paiements_reference_paytech ON paiements(reference_paytech)');

  database.run(`CREATE TABLE IF NOT EXISTS portefeuille_gerant (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gerant_id INTEGER NOT NULL,
    terrain_id INTEGER NOT NULL,
    solde_disponible INTEGER DEFAULT 0,
    solde_en_attente INTEGER DEFAULT 0,
    total_encaisse INTEGER DEFAULT 0,
    total_commission_prelevee INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (gerant_id, terrain_id),
    FOREIGN KEY (gerant_id) REFERENCES users(id),
    FOREIGN KEY (terrain_id) REFERENCES terrains(id)
  )`);

  database.run(`CREATE TABLE IF NOT EXISTS reversements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gerant_id INTEGER NOT NULL,
    terrain_id INTEGER NOT NULL,
    reservation_id INTEGER NOT NULL,
    montant INTEGER NOT NULL,
    statut TEXT DEFAULT 'effectue',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (gerant_id) REFERENCES users(id),
    FOREIGN KEY (reservation_id) REFERENCES reservations(id)
  )`);
  database.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_reversements_reservation ON reversements(reservation_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_reversements_gerant ON reversements(gerant_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_reversements_terrain ON reversements(terrain_id)');

  // 9. avis
  database.run(`CREATE TABLE IF NOT EXISTS avis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_id INTEGER,
    joueur_id INTEGER,
    joueur_nom VARCHAR(255),
    terrain_id INTEGER NOT NULL,
    note INTEGER CHECK(note >= 1 AND note <= 5),
    commentaire TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id),
    FOREIGN KEY (joueur_id) REFERENCES users(id),
    FOREIGN KEY (terrain_id) REFERENCES terrains(id)
  )`);

  // 10. notifications
  database.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    destinataire_type VARCHAR(50),
    destinataire_id INTEGER,
    type VARCHAR(50),
    canal VARCHAR(50) DEFAULT 'whatsapp',
    contenu TEXT,
    lu INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 11. audit_logs
  database.run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    acteur_type VARCHAR(50),
    acteur_id INTEGER,
    action VARCHAR(255),
    table_cible VARCHAR(255),
    enregistrement_id INTEGER,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  console.log('✅ Tables SQLite initialisées.');
}

function addColumnIfMissing(database, table, column, definition) {
  const columns = queryAll(database, `PRAGMA table_info(${table})`);
  if (!columns.some((item) => item.name === column)) {
    database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Helper: convertir les résultats sql.js en objets
function queryAll(database, sql, params = []) {
  try {
    const stmt = database.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  } catch (err) {
    console.error('SQL Error:', err.message, '\nQuery:', sql);
    throw err;
  }
}

function queryOne(database, sql, params = []) {
  const results = queryAll(database, sql, params);
  return results.length > 0 ? results[0] : null;
}

function runSql(database, sql, params = []) {
  try {
    database.run(sql, params);
    saveDb();
    // Obtenir le dernier ID inséré
    const result = queryOne(database, 'SELECT last_insert_rowid() as id');
    return { lastInsertRowid: result ? result.id : 0 };
  } catch (err) {
    console.error('SQL Error:', err.message, '\nQuery:', sql);
    throw err;
  }
}

function transaction(database, callback) {
  database.run('BEGIN IMMEDIATE TRANSACTION');
  try {
    const result = callback();
    database.run('COMMIT');
    saveDb();
    return result;
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
}

module.exports = { getDb, saveDb, queryAll, queryOne, runSql, transaction };
