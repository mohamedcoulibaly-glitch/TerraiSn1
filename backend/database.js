const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, 'terrainsn.db');

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

module.exports = { getDb, saveDb, queryAll, queryOne, runSql };
