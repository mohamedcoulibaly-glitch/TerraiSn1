const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.resolve(__dirname, 'terrainsn.db');

let db = null;
let loadedMtime = 0;
let opening = null;

function fileMtime() {
  try {
    return fs.existsSync(dbPath) ? fs.statSync(dbPath).mtimeMs : 0;
  } catch {
    return 0;
  }
}

async function openDatabase() {
  const SQL = await initSqlJs();
  const currentMtime = fileMtime();
  let instance;
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    instance = new SQL.Database(buffer);
  } else {
    instance = new SQL.Database();
  }
  loadedMtime = currentMtime;
  initDb(instance);
  // Persister sans invalider l'instance courante
  const data = instance.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  loadedMtime = fileMtime();
  db = instance;
  return instance;
}

async function getDb() {
  const currentMtime = fileMtime();
  if (db && currentMtime === loadedMtime) return db;

  // Éviter les ouvertures concurrentes (nodemon / seed)
  if (opening) return opening;

  opening = openDatabase()
    .catch((err) => {
      db = null;
      loadedMtime = 0;
      throw err;
    })
    .finally(() => {
      opening = null;
    });
  return opening;
}

function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    loadedMtime = fileMtime();
  } catch (err) {
    console.error('⚠️ saveDb échoué:', err.message);
  }
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
  addColumnIfMissing(database, 'blocages_creneaux', 'type_blocage', "TEXT DEFAULT 'MANUEL'");
  addColumnIfMissing(database, 'blocages_creneaux', 'montant', 'INTEGER');
  addColumnIfMissing(database, 'blocages_creneaux', 'libelle', 'TEXT');
  addColumnIfMissing(database, 'blocages_creneaux', 'groupe_id', 'TEXT');
  addColumnIfMissing(database, 'blocages_creneaux', 'date_debut', 'DATE');
  addColumnIfMissing(database, 'blocages_creneaux', 'date_fin', 'DATE');
  addColumnIfMissing(database, 'blocages_creneaux', 'jours', 'TEXT');
  addColumnIfMissing(database, 'blocages_creneaux', 'inclure_dans_ca', 'INTEGER DEFAULT 0');
  database.run('CREATE INDEX IF NOT EXISTS idx_blocages_groupe ON blocages_creneaux(groupe_id)');

  database.run(`CREATE TABLE IF NOT EXISTS blocages_groupes (
    id TEXT PRIMARY KEY,
    terrain_id INTEGER NOT NULL,
    employe_id INTEGER,
    type_blocage TEXT NOT NULL DEFAULT 'MANUEL',
    libelle TEXT,
    date_debut DATE,
    date_fin DATE,
    jours TEXT,
    heure_debut TIME,
    heure_fin TIME,
    montant INTEGER,
    motif TEXT,
    inclure_dans_ca INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (terrain_id) REFERENCES terrains(id)
  )`);
  addColumnIfMissing(database, 'blocages_groupes', 'inclure_dans_ca', 'INTEGER DEFAULT 0');
  database.run('CREATE INDEX IF NOT EXISTS idx_blocages_groupes_terrain ON blocages_groupes(terrain_id)');

  database.run(`CREATE TABLE IF NOT EXISTS encaissements_blocages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupe_id TEXT NOT NULL,
    terrain_id INTEGER NOT NULL,
    employe_id INTEGER,
    montant INTEGER NOT NULL,
    date_encaissement DATE NOT NULL,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (terrain_id) REFERENCES terrains(id)
  )`);
  database.run('CREATE INDEX IF NOT EXISTS idx_encaissements_blocages_groupe ON encaissements_blocages(groupe_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_encaissements_blocages_terrain ON encaissements_blocages(terrain_id, date_encaissement)');

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
  addColumnIfMissing(database, 'reservations', 'reference_paytech', 'TEXT');
  addColumnIfMissing(database, 'reservations', 'format_terrain', "TEXT DEFAULT 'entier'");
  addColumnIfMissing(database, 'reservations', 'prix_total', 'DECIMAL(10, 2)');
  addColumnIfMissing(database, 'reservations', 'acompte', 'DECIMAL(10, 2) DEFAULT 5000');
  addColumnIfMissing(database, 'reservations', 'reste_a_payer', 'DECIMAL(10, 2) DEFAULT 0');
  addColumnIfMissing(database, 'reservations', 'montant_avance', 'INTEGER');
  addColumnIfMissing(database, 'reservations', 'montant_restant', 'INTEGER');
  addColumnIfMissing(database, 'reservations', 'qr_code_scanne_at', 'DATETIME');
  addColumnIfMissing(database, 'reservations', 'qr_code_url', 'TEXT');
  addColumnIfMissing(database, 'reservations', 'qr_code_payload', 'TEXT');
  addColumnIfMissing(database, 'reservations', 'operational_stage', "TEXT DEFAULT 'reserved'");
  addColumnIfMissing(database, 'reservations', 'checked_in_at', 'DATETIME');
  addColumnIfMissing(database, 'reservations', 'checkout_at', 'DATETIME');
  addColumnIfMissing(database, 'reservations', 'confirme_at', 'DATETIME');
  addColumnIfMissing(database, 'reservations', 'mode_paiement', "TEXT DEFAULT 'en_ligne'");
  addColumnIfMissing(database, 'reservations', 'confirme_manuellement_par', 'INTEGER');
  addColumnIfMissing(database, 'reservations', 'confirme_manuellement_at', 'DATETIME');
  addColumnIfMissing(database, 'reservations', 'note_gerant', 'TEXT');
  addColumnIfMissing(database, 'creneaux', 'fenetre_retard', 'INTEGER DEFAULT 30');
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
  addColumnIfMissing(database, 'terrains', 'pourcentage_avance', 'REAL DEFAULT 8');
  addColumnIfMissing(database, 'users', 'refresh_token', 'TEXT');
  addColumnIfMissing(database, 'users', 'refresh_token_expire_at', 'DATETIME');
  // CDC babacar : statut compte joueur (bloque / suspendu / actif)
  addColumnIfMissing(
    database,
    'users',
    'statut',
    "TEXT DEFAULT 'actif' CHECK(statut IN ('actif', 'suspendu', 'bloque'))"
  );
  addColumnIfMissing(database, 'proprietaires', 'refresh_token', 'TEXT');
  addColumnIfMissing(database, 'proprietaires', 'refresh_token_expire_at', 'DATETIME');
  addColumnIfMissing(database, 'employes', 'refresh_token', 'TEXT');
  addColumnIfMissing(database, 'employes', 'refresh_token_expire_at', 'DATETIME');
  addColumnIfMissing(database, 'terrains', 'modele_revenus', "TEXT DEFAULT 'commission'");
  addColumnIfMissing(database, 'terrains', 'commission_pourcentage', 'REAL DEFAULT 0');
  addColumnIfMissing(database, 'terrains', 'abonnement_montant', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'terrains', 'abonnement_periodicite', "TEXT DEFAULT 'mensuel'");
  addColumnIfMissing(database, 'terrains', 'abonnement_prochain_paiement', 'DATETIME');
  addColumnIfMissing(database, 'terrains', 'achat_definitif_montant', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'terrains', 'achat_definitif_paye', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'terrains', 'latitude', 'REAL');
  addColumnIfMissing(database, 'terrains', 'longitude', 'REAL');
  addColumnIfMissing(database, 'terrains', 'adresse_theorique', 'TEXT');
  addColumnIfMissing(database, 'terrains', 'adresse_nominatim', 'TEXT');
  addColumnIfMissing(database, 'terrains', 'commodites', "TEXT DEFAULT '[]'");
  addColumnIfMissing(database, 'terrains', 'delai_remboursement_heures', 'INTEGER DEFAULT 24');
  addColumnIfMissing(database, 'users', 'terrain_id', 'INTEGER');
  addColumnIfMissing(database, 'users', 'must_change_password', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'users', 'prenom', 'VARCHAR(255)');
  addColumnIfMissing(database, 'users', 'telephone_verified', 'INTEGER DEFAULT 1');
  addColumnIfMissing(database, 'users', 'quartier', 'VARCHAR(255)');
  addColumnIfMissing(database, 'users', 'date_naissance', 'DATE');
  addColumnIfMissing(database, 'users', 'bio', 'TEXT');
  addColumnIfMissing(database, 'users', 'photo_url', 'TEXT');
  addColumnIfMissing(database, 'users', 'is_banned', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'users', 'banned_at', 'DATETIME');
  addColumnIfMissing(database, 'users', 'banned_reason', 'TEXT');
  addColumnIfMissing(database, 'users', 'notes_internes', 'TEXT');
  addColumnIfMissing(database, 'proprietaires', 'must_change_password', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'proprietaires', 'prenom', 'VARCHAR(255)');
  addColumnIfMissing(database, 'proprietaires', 'quartier', 'VARCHAR(255)');
  addColumnIfMissing(database, 'proprietaires', 'date_naissance', 'DATE');
  addColumnIfMissing(database, 'proprietaires', 'bio', 'TEXT');
  addColumnIfMissing(database, 'proprietaires', 'photo_url', 'TEXT');
  addColumnIfMissing(database, 'employes', 'must_change_password', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'employes', 'prenom', 'VARCHAR(255)');
  addColumnIfMissing(database, 'employes', 'quartier', 'VARCHAR(255)');
  addColumnIfMissing(database, 'employes', 'date_naissance', 'DATE');
  addColumnIfMissing(database, 'employes', 'bio', 'TEXT');
  addColumnIfMissing(database, 'employes', 'photo_url', 'TEXT');
  addColumnIfMissing(database, 'employes', 'whatsapp_wid', 'VARCHAR(50)');
  addColumnIfMissing(database, 'employes', 'whatsapp_connected_at', 'DATETIME');

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
  database.run("UPDATE terrains SET modele_revenus = 'commission' WHERE modele_revenus IS NULL");
  database.run('UPDATE terrains SET pourcentage_avance = ROUND((COALESCE(montant_acompte, acompte, 5000) * 100.0) / NULLIF(COALESCE(prix_entier, prix_heure), 0), 2) WHERE pourcentage_avance IS NULL');
  database.run('UPDATE terrains SET commission_pourcentage = ROUND((COALESCE(commission, 0) * 100.0) / NULLIF(COALESCE(montant_acompte, acompte, 5000), 0), 2) WHERE commission_pourcentage IS NULL OR commission_pourcentage = 0');
  database.run('UPDATE reservations SET prix_total = montant WHERE prix_total IS NULL');
  database.run('UPDATE reservations SET acompte = MIN(5000, montant) WHERE acompte IS NULL');
  database.run('UPDATE reservations SET reste_a_payer = MAX(0, prix_total - acompte) WHERE reste_a_payer IS NULL');
  database.run('UPDATE reservations SET montant_avance = acompte WHERE montant_avance IS NULL AND acompte IS NOT NULL');
  database.run(`UPDATE reservations SET confirme_at = (
    SELECT p.created_at FROM paiements p
     WHERE p.reservation_id = reservations.id AND p.statut = 'paye'
     ORDER BY p.id DESC LIMIT 1
  ) WHERE confirme_at IS NULL AND statut IN ('confirme', 'acceptee', 'match_joue', 'joue')`);
  database.run('UPDATE reservations SET montant_restant = reste_a_payer WHERE montant_restant IS NULL AND reste_a_payer IS NOT NULL');
  database.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_code ON reservations(code_reservation)');
  database.run('CREATE INDEX IF NOT EXISTS idx_users_telephone ON users(telephone)');
  database.run('CREATE INDEX IF NOT EXISTS idx_reservations_creneau ON reservations(creneau_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_reservations_statut ON reservations(statut)');
  database.run('CREATE INDEX IF NOT EXISTS idx_reservations_terrain_date ON reservations(terrain_id, date)');
  database.run('CREATE INDEX IF NOT EXISTS idx_creneaux_statut ON creneaux(statut)');
  database.run('CREATE INDEX IF NOT EXISTS idx_paiements_reservation ON paiements(reservation_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_paiements_reference_paytech ON paiements(reference_paytech)');
  // Idempotence paiement : une même référence PayTech ne peut créditer qu'une fois
  try {
    database.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_paiements_ref_paytech_unique
      ON paiements(reference_paytech) WHERE reference_paytech IS NOT NULL AND reference_paytech != ''`);
  } catch (err) {
    console.warn('Index idempotence paiements non créé:', err.message);
  }

  database.run(`CREATE TABLE IF NOT EXISTS tarifs_dynamiques (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terrain_id INTEGER NOT NULL,
    jour TEXT NOT NULL,
    heure INTEGER NOT NULL,
    prix_entier DECIMAL(10, 2) NOT NULL,
    prix_moitie DECIMAL(10, 2) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (terrain_id, jour, heure),
    FOREIGN KEY (terrain_id) REFERENCES terrains(id)
  )`);
  database.run('CREATE INDEX IF NOT EXISTS idx_tarifs_dynamiques_terrain ON tarifs_dynamiques(terrain_id)');

  /** Règles tarifaires (week-end, soirée, etc.) — distinctes de la grille horaire cellule par cellule. */
  database.run(`CREATE TABLE IF NOT EXISTS regles_tarifs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terrain_id INTEGER NOT NULL,
    nom TEXT NOT NULL,
    prix_demi_terrain INTEGER NOT NULL,
    prix_terrain_entier INTEGER NOT NULL,
    type TEXT CHECK(type IN ('semaine','weekend','soiree','special')),
    jours TEXT,
    heure_debut TIME,
    heure_fin TIME,
    priorite INTEGER DEFAULT 0,
    actif INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (terrain_id) REFERENCES terrains(id)
  )`);
  database.run('CREATE INDEX IF NOT EXISTS idx_regles_tarifs_terrain ON regles_tarifs(terrain_id)');
  addColumnIfMissing(database, 'regles_tarifs', 'source', "TEXT DEFAULT 'manuelle'");

  database.run(`CREATE TABLE IF NOT EXISTS propositions_grille_tarifs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terrain_id INTEGER NOT NULL,
    demandeur_type TEXT,
    demandeur_id INTEGER,
    payload TEXT NOT NULL,
    statut TEXT DEFAULT 'en_attente',
    commentaire TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    traite_at DATETIME,
    traite_par INTEGER,
    FOREIGN KEY (terrain_id) REFERENCES terrains(id)
  )`);
  database.run('CREATE INDEX IF NOT EXISTS idx_propositions_grille_terrain ON propositions_grille_tarifs(terrain_id, statut)');

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
    commission_prelevee INTEGER DEFAULT 0,
    statut TEXT DEFAULT 'effectue',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (gerant_id) REFERENCES users(id),
    FOREIGN KEY (reservation_id) REFERENCES reservations(id)
  )`);
  addColumnIfMissing(database, 'reversements', 'commission_prelevee', 'INTEGER DEFAULT 0');
  database.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_reversements_reservation ON reversements(reservation_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_reversements_gerant ON reversements(gerant_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_reversements_terrain ON reversements(terrain_id)');

  database.run(`CREATE TABLE IF NOT EXISTS abonnements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terrain_id INTEGER NOT NULL,
    montant INTEGER NOT NULL,
    date_echeance DATE NOT NULL,
    statut TEXT CHECK(statut IN ('paye', 'en_attente', 'en_retard')) DEFAULT 'en_attente',
    paye_le DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (terrain_id) REFERENCES terrains(id)
  )`);
  database.run('CREATE INDEX IF NOT EXISTS idx_abonnements_terrain ON abonnements(terrain_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_abonnements_echeance ON abonnements(date_echeance, statut)');

  database.run(`CREATE TABLE IF NOT EXISTS terrain_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terrain_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    nom_fichier TEXT,
    taille_octets INTEGER,
    est_principale INTEGER DEFAULT 0,
    ordre INTEGER DEFAULT 0,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (terrain_id) REFERENCES terrains(id)
  )`);
  database.run('CREATE INDEX IF NOT EXISTS idx_terrain_photos_terrain ON terrain_photos(terrain_id, ordre)');
  addColumnIfMissing(database, 'terrain_photos', 'nom_fichier', 'TEXT');
  addColumnIfMissing(database, 'terrain_photos', 'taille_octets', 'INTEGER');
  addColumnIfMissing(database, 'terrain_photos', 'uploaded_at', 'DATETIME');
  addColumnIfMissing(database, 'terrain_photos', 'uploaded_by', 'INTEGER');
  addColumnIfMissing(database, 'terrain_photos', 'uploaded_by_role', 'TEXT');
  addColumnIfMissing(database, 'terrain_photos', 'valide', 'INTEGER DEFAULT 1');
  addColumnIfMissing(database, 'terrain_photos', 'valide_par', 'INTEGER');
  addColumnIfMissing(database, 'terrain_photos', 'valide_at', 'DATETIME');
  addColumnIfMissing(database, 'terrain_photos', 'largeur_px', 'INTEGER');
  addColumnIfMissing(database, 'terrain_photos', 'hauteur_px', 'INTEGER');
  addColumnIfMissing(database, 'terrain_photos', 'ratio', 'TEXT');

  database.run(`CREATE TABLE IF NOT EXISTS commodites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cle TEXT NOT NULL UNIQUE,
    label_fr TEXT NOT NULL,
    icone TEXT NOT NULL,
    description TEXT,
    actif INTEGER DEFAULT 1,
    ordre INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  database.run(`CREATE TABLE IF NOT EXISTS terrain_commodites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terrain_id INTEGER NOT NULL,
    commodite_id INTEGER NOT NULL,
    actif INTEGER DEFAULT 1,
    UNIQUE(terrain_id, commodite_id),
    FOREIGN KEY (terrain_id) REFERENCES terrains(id),
    FOREIGN KEY (commodite_id) REFERENCES commodites(id)
  )`);
  database.run(`CREATE TABLE IF NOT EXISTS audit_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terrain_id INTEGER NOT NULL,
    photo_id INTEGER,
    action TEXT NOT NULL,
    fait_par INTEGER,
    role_fait_par TEXT,
    detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  database.run(`CREATE TABLE IF NOT EXISTS audit_commodites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terrain_id INTEGER,
    commodite_id INTEGER,
    action TEXT NOT NULL,
    fait_par INTEGER,
    role_fait_par TEXT,
    detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  database.run('CREATE INDEX IF NOT EXISTS idx_terrain_commodites_terrain ON terrain_commodites(terrain_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_audit_photos_terrain ON audit_photos(terrain_id, created_at)');
  database.run('CREATE INDEX IF NOT EXISTS idx_audit_commodites_terrain ON audit_commodites(terrain_id, created_at)');
  addColumnIfMissing(database, 'commodites', 'modifiable_gerant', 'INTEGER DEFAULT 1');
  addColumnIfMissing(database, 'terrain_commodites', 'force_par_admin', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'terrains', 'mode_essai', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'terrains', 'essai_debut_at', 'DATETIME');
  addColumnIfMissing(database, 'terrains', 'essai_duree_jours', 'INTEGER DEFAULT 30');
  addColumnIfMissing(database, 'terrains', 'essai_fin_at', 'DATETIME');
  addColumnIfMissing(database, 'terrains', 'essai_suspendu_auto', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'terrains', 'delai_negociation_jours', 'INTEGER DEFAULT 7');
  addColumnIfMissing(database, 'terrains', 'notif_essai_fin_j7', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'terrains', 'notif_essai_fin_j3', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'terrains', 'notif_essai_fin_j1', 'INTEGER DEFAULT 0');
  database.run(`CREATE TABLE IF NOT EXISTS terrain_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terrain_id INTEGER NOT NULL,
    feature_cle TEXT NOT NULL,
    actif INTEGER DEFAULT 1,
    configure_par INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(terrain_id, feature_cle),
    FOREIGN KEY (terrain_id) REFERENCES terrains(id) ON DELETE CASCADE
  )`);
  seedDefaultCommodites(database);
  migrateJsonCommodites(database);

  database.run(`CREATE TABLE IF NOT EXISTS dettes_commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terrain_id INTEGER NOT NULL,
    gerant_id INTEGER NOT NULL,
    reservation_id INTEGER NOT NULL,
    montant_commission INTEGER NOT NULL,
    montant_avance_manuelle INTEGER NOT NULL,
    statut TEXT DEFAULT 'en_attente' CHECK(statut IN ('en_attente','payee','annulee')),
    periode TEXT NOT NULL,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    payee_at DATETIME,
    remise_a_zero_par INTEGER,
    remise_a_zero_at DATETIME,
    FOREIGN KEY (terrain_id) REFERENCES terrains(id),
    FOREIGN KEY (reservation_id) REFERENCES reservations(id)
  )`);
  database.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_dettes_reservation ON dettes_commissions(reservation_id)');
  database.run('CREATE INDEX IF NOT EXISTS idx_dettes_terrain ON dettes_commissions(terrain_id, statut, periode)');
  database.run('CREATE INDEX IF NOT EXISTS idx_dettes_gerant ON dettes_commissions(gerant_id, statut)');

  database.run(`CREATE TABLE IF NOT EXISTS audit_dette (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dette_id INTEGER,
    terrain_id INTEGER,
    action TEXT NOT NULL CHECK(action IN (
      'creation','paiement_partiel','paiement_total',
      'remise_a_zero','annulation','note_ajoutee'
    )),
    montant_concerne INTEGER,
    fait_par INTEGER,
    role_fait_par TEXT,
    detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dette_id) REFERENCES dettes_commissions(id),
    FOREIGN KEY (terrain_id) REFERENCES terrains(id)
  )`);

  database.run(`CREATE TABLE IF NOT EXISTS plateforme_settings (
    cle TEXT PRIMARY KEY,
    valeur TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  database.run(`CREATE TABLE IF NOT EXISTS mode_revenu_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    terrain_id INTEGER NOT NULL,
    ancien_mode TEXT,
    nouveau_mode TEXT NOT NULL,
    fait_par INTEGER,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  database.run(`CREATE TABLE IF NOT EXISTS activite_gerant (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gerant_id INTEGER REFERENCES employes(id),
    terrain_id INTEGER REFERENCES terrains(id),
    action TEXT NOT NULL CHECK(action IN (
      'reservation_creee',
      'reservation_annulee',
      'qr_scanne',
      'kanban_stage',
      'creneau_cree',
      'creneau_supprime'
    )),
    reservation_id INTEGER REFERENCES reservations(id),
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  database.run(`CREATE TABLE IF NOT EXISTS score_confiance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gerant_id INTEGER REFERENCES employes(id),
    terrain_id INTEGER REFERENCES terrains(id),
    periode TEXT NOT NULL,
    reservations_confirmees INTEGER DEFAULT 0,
    matchs_scannes INTEGER DEFAULT 0,
    taux_scan REAL DEFAULT 0,
    annulations_total INTEGER DEFAULT 0,
    score INTEGER DEFAULT 100,
    alerte_envoyee INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(gerant_id, terrain_id, periode)
  )`);

  database.run('CREATE INDEX IF NOT EXISTS idx_activite_gerant ON activite_gerant(gerant_id, terrain_id, created_at)');
  database.run('CREATE INDEX IF NOT EXISTS idx_score_confiance ON score_confiance(gerant_id, terrain_id, periode)');

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

  // 10b. Web Push subscriptions
  database.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  database.run(`CREATE TABLE IF NOT EXISTS push_preferences (
    user_id INTEGER PRIMARY KEY,
    reservation_confirmation INTEGER DEFAULT 1,
    rappel_reservation INTEGER DEFAULT 1,
    promotion INTEGER DEFAULT 0,
    nouveau_message INTEGER DEFAULT 1,
    avis_reponse INTEGER DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  database.run(`CREATE TABLE IF NOT EXISTS reservation_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_id INTEGER NOT NULL UNIQUE,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id)
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

const DEFAULT_COMMODITES = [
  ['eclairage', 'Éclairage nocturne', 'Zap', 1],
  ['vestiaires', 'Vestiaires', 'Users', 2],
  ['douches', 'Douches', 'Droplets', 3],
  ['parking', 'Parking', 'Car', 4],
  ['buvette', 'Buvette', 'Coffee', 5],
  ['tribune', 'Tribune', 'Armchair', 6],
  ['wifi', 'Wi-Fi', 'Wifi', 7],
  ['arbitre', 'Arbitre disponible', 'Flag', 8],
  ['ballon', 'Ballon fourni', 'CircleDot', 9],
  ['securite', 'Agent de sécurité', 'Shield', 10],
  ['dossards', 'Dossards fournis', 'Shirt', 11],
  ['eau', 'Eau à la mi-temps', 'Droplet', 12],
  ['toilettes', 'Toilettes', 'Bath', 13],
  ['priere', 'Espace de prière', 'Moon', 14],
  ['glacons', 'Glaçons / Glacière', 'Snowflake', 15],
  ['secours', 'Premiers secours', 'Ambulance', 16],
  ['video', 'Enregistrement vidéo', 'Video', 17],
];

function seedDefaultCommodites(database) {
  for (const [cle, label_fr, icone, ordre] of DEFAULT_COMMODITES) {
    const exists = queryOne(database, 'SELECT id FROM commodites WHERE cle = ?', [cle]);
    if (!exists) {
      database.run(
        'INSERT INTO commodites (cle, label_fr, icone, actif, ordre) VALUES (?, ?, ?, 1, ?)',
        [cle, label_fr, icone, ordre],
      );
    }
  }
}

function migrateJsonCommodites(database) {
  const byCle = new Map(queryAll(database, 'SELECT id, cle FROM commodites').map((c) => [c.cle, c.id]));
  const terrains = queryAll(database, 'SELECT id, commodites FROM terrains');
  for (const terrain of terrains) {
    let keys = [];
    try {
      const parsed = JSON.parse(terrain.commodites || '[]');
      if (Array.isArray(parsed)) keys = parsed.map(String);
    } catch {
      keys = [];
    }
    for (const key of keys) {
      const cid = byCle.get(key);
      if (!cid) continue;
      const existing = queryOne(database, 'SELECT id FROM terrain_commodites WHERE terrain_id = ? AND commodite_id = ?', [terrain.id, cid]);
      if (!existing) {
        database.run('INSERT INTO terrain_commodites (terrain_id, commodite_id, actif) VALUES (?, ?, 1)', [terrain.id, cid]);
      }
    }
  }
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

let txDepth = 0;

function runSql(database, sql, params = []) {
  try {
    database.run(sql, params);
    // Lire last_insert_rowid AVANT saveDb() (un reload efface le curseur sql.js)
    const result = queryOne(database, 'SELECT last_insert_rowid() as id');
    if (txDepth === 0) saveDb();
    return { lastInsertRowid: result ? result.id : 0 };
  } catch (err) {
    console.error('SQL Error:', err.message, '\nQuery:', sql);
    throw err;
  }
}

function safeRun(database, sql) {
  try {
    database.run(sql);
  } catch (err) {
    const msg = String(err && err.message || '');
    if (/no transaction is active/i.test(msg)) return;
    throw err;
  }
}

function transaction(database, callback) {
  database.run('BEGIN IMMEDIATE TRANSACTION');
  txDepth += 1;
  try {
    const result = callback();
    safeRun(database, 'COMMIT');
    saveDb();
    return result;
  } catch (error) {
    safeRun(database, 'ROLLBACK');
    throw error;
  } finally {
    txDepth = Math.max(0, txDepth - 1);
  }
}

module.exports = { getDb, saveDb, queryAll, queryOne, runSql, transaction };
