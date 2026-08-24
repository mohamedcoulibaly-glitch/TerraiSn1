/**
 * Couche DB TerrainSN — PostgreSQL (pg Pool).
 * API : getDb / queryAll / queryOne / runSql / transaction / saveDb (noop) / rowsModified
 * Placeholders `?` convertis automatiquement en `$1..$n`.
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://terrainsn:terrainsn@localhost:5433/terrainsn';

const pool = new Pool({ connectionString: DATABASE_URL });
const txStore = new AsyncLocalStorage();
const lastChanges = new WeakMap();
let schemaReady = false;
let schemaPromise = null;

function toPgParams(sql, params = []) {
  let i = 0;
  const text = String(sql).replace(/\?/g, () => `$${++i}`);
  return { text, values: params };
}

function runner() {
  return txStore.getStore()?.client || pool;
}

async function exec(sql, params = []) {
  const db = runner();
  const { text, values } = toPgParams(sql, params);
  try {
    const result = await db.query(text, values);
    lastChanges.set(db, result.rowCount || 0);
    return result;
  } catch (err) {
    console.error('SQL Error:', err.message, '\nQuery:', text);
    throw err;
  }
}

function isInsertWithoutReturning(sql) {
  const s = String(sql).trim();
  if (!/^INSERT\s+/i.test(s)) return false;
  if (/\bRETURNING\b/i.test(s)) return false;
  return true;
}

async function getDb() {
  if (!schemaReady) {
    if (!schemaPromise) {
      schemaPromise = initSchema(pool)
        .then(() => {
          schemaReady = true;
        })
        .finally(() => {
          schemaPromise = null;
        });
    }
    await schemaPromise;
  }
  return pool;
}

/** No-op : Postgres persiste immédiatement (plus de fichier sql.js). */
function saveDb() {}

function rowsModified(database) {
  // Toujours lire le compteur du runner ALS (client tx), pas le pool passé en argument.
  void database;
  return lastChanges.get(runner()) || 0;
}

async function queryAll(database, sql, params = []) {
  // database ignoré hors transaction ALS — garde signature (db, sql, params)
  void database;
  const result = await exec(sql, params);
  return result.rows;
}

async function queryOne(database, sql, params = []) {
  const rows = await queryAll(database, sql, params);
  return rows.length > 0 ? rows[0] : null;
}

async function runSql(database, sql, params = []) {
  void database;
  let finalSql = sql;
  if (isInsertWithoutReturning(sql)) {
    finalSql = `${String(sql).trim().replace(/;?\s*$/, '')} RETURNING *`;
  }
  const result = await exec(finalSql, params);
  const id = result.rows?.[0]?.id;
  return {
    lastInsertRowid: id != null ? Number(id) : 0,
    changes: result.rowCount || 0,
  };
}

async function transaction(database, callback) {
  void database;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txStore.run({ client }, async () => callback());
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    client.release();
  }
}

async function columnExists(client, table, column) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return r.rowCount > 0;
}

async function addColumnIfMissing(client, table, column, definition) {
  if (await columnExists(client, table, column)) return;
  await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
}

async function initSchema(poolOrClient) {
  const c = poolOrClient;
  await c.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  await c.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nom VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255),
      telephone VARCHAR(50),
      role VARCHAR(50) DEFAULT 'joueur',
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      refresh_token TEXT,
      refresh_token_expire_at TIMESTAMPTZ,
      statut TEXT DEFAULT 'actif' CHECK (statut IN ('actif', 'suspendu', 'bloque')),
      terrain_id INTEGER,
      must_change_password INTEGER DEFAULT 0,
      prenom VARCHAR(255),
      telephone_verified INTEGER DEFAULT 1,
      quartier VARCHAR(255),
      date_naissance DATE,
      bio TEXT,
      photo_url TEXT,
      is_banned INTEGER DEFAULT 0,
      banned_at TIMESTAMPTZ,
      banned_reason TEXT,
      notes_internes TEXT
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS proprietaires (
      id SERIAL PRIMARY KEY,
      nom VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      telephone VARCHAR(50),
      plan VARCHAR(50) DEFAULT 'free',
      statut VARCHAR(50) DEFAULT 'actif',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      refresh_token TEXT,
      refresh_token_expire_at TIMESTAMPTZ,
      must_change_password INTEGER DEFAULT 0,
      prenom VARCHAR(255),
      quartier VARCHAR(255),
      date_naissance DATE,
      bio TEXT,
      photo_url TEXT
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS terrains (
      id SERIAL PRIMARY KEY,
      proprietaire_id INTEGER NOT NULL REFERENCES proprietaires(id),
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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      prix_moitie DECIMAL(10, 2),
      prix_entier DECIMAL(10, 2),
      montant_acompte DECIMAL(10, 2) DEFAULT 5000,
      acompte INTEGER DEFAULT 5000,
      commission INTEGER DEFAULT 400,
      pourcentage_avance REAL DEFAULT 8,
      modele_revenus TEXT DEFAULT 'commission',
      commission_pourcentage REAL DEFAULT 0,
      abonnement_montant INTEGER DEFAULT 0,
      abonnement_periodicite TEXT DEFAULT 'mensuel',
      abonnement_prochain_paiement TIMESTAMPTZ,
      achat_definitif_montant INTEGER DEFAULT 0,
      achat_definitif_paye INTEGER DEFAULT 0,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      adresse_theorique TEXT,
      adresse_nominatim TEXT,
      commodites TEXT DEFAULT '[]',
      delai_remboursement_heures INTEGER DEFAULT 24,
      delai_verrou_paiement_min INTEGER DEFAULT 15,
      mode_essai INTEGER DEFAULT 0,
      essai_debut_at TIMESTAMPTZ,
      essai_duree_jours INTEGER DEFAULT 30,
      essai_fin_at TIMESTAMPTZ,
      essai_suspendu_auto INTEGER DEFAULT 0,
      delai_negociation_jours INTEGER DEFAULT 7,
      notif_essai_fin_j7 INTEGER DEFAULT 0,
      notif_essai_fin_j3 INTEGER DEFAULT 0,
      notif_essai_fin_j1 INTEGER DEFAULT 0
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS employes (
      id SERIAL PRIMARY KEY,
      proprietaire_id INTEGER NOT NULL REFERENCES proprietaires(id),
      terrain_id INTEGER REFERENCES terrains(id),
      nom VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      telephone VARCHAR(50),
      whatsapp_number VARCHAR(50) NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      refresh_token TEXT,
      refresh_token_expire_at TIMESTAMPTZ,
      must_change_password INTEGER DEFAULT 0,
      prenom VARCHAR(255),
      quartier VARCHAR(255),
      date_naissance DATE,
      bio TEXT,
      photo_url TEXT,
      whatsapp_wid VARCHAR(50),
      whatsapp_connected_at TIMESTAMPTZ
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS horaires (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      jour VARCHAR(20),
      heure_debut TIME,
      heure_fin TIME,
      est_ouvert INTEGER DEFAULT 1
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS blocages_creneaux (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      employe_id INTEGER REFERENCES employes(id),
      date DATE,
      heure_debut TIME,
      heure_fin TIME,
      motif VARCHAR(255),
      type_blocage TEXT DEFAULT 'MANUEL',
      montant INTEGER,
      libelle TEXT,
      groupe_id TEXT,
      date_debut DATE,
      date_fin DATE,
      jours TEXT,
      inclure_dans_ca INTEGER DEFAULT 0
    )
  `);
  await c.query('CREATE INDEX IF NOT EXISTS idx_blocages_groupe ON blocages_creneaux(groupe_id)');

  await c.query(`
    CREATE TABLE IF NOT EXISTS blocages_groupes (
      id TEXT PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await c.query('CREATE INDEX IF NOT EXISTS idx_blocages_groupes_terrain ON blocages_groupes(terrain_id)');

  await c.query(`
    CREATE TABLE IF NOT EXISTS encaissements_blocages (
      id SERIAL PRIMARY KEY,
      groupe_id TEXT NOT NULL,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      employe_id INTEGER,
      montant INTEGER NOT NULL,
      date_encaissement DATE NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await c.query('CREATE INDEX IF NOT EXISTS idx_encaissements_blocages_groupe ON encaissements_blocages(groupe_id)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_encaissements_blocages_terrain ON encaissements_blocages(terrain_id, date_encaissement)');

  await c.query(`
    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      joueur_id INTEGER REFERENCES users(id),
      joueur_nom VARCHAR(255),
      joueur_telephone VARCHAR(50),
      date DATE NOT NULL,
      heure_debut TIME NOT NULL,
      heure_fin TIME NOT NULL,
      montant DECIMAL(10, 2),
      statut VARCHAR(50) DEFAULT 'en_attente',
      expire_at TIMESTAMPTZ,
      traite_par INTEGER REFERENCES employes(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      creneau_id INTEGER,
      code_reservation TEXT,
      verrou_expire_at BIGINT,
      cree_par TEXT DEFAULT 'joueur',
      lien_paiement TEXT,
      reference_paytech TEXT,
      format_terrain TEXT DEFAULT 'entier',
      prix_total DECIMAL(10, 2),
      acompte DECIMAL(10, 2) DEFAULT 5000,
      reste_a_payer DECIMAL(10, 2) DEFAULT 0,
      montant_avance INTEGER,
      montant_restant INTEGER,
      qr_code_scanne_at TIMESTAMPTZ,
      qr_code_url TEXT,
      qr_code_payload TEXT,
      operational_stage TEXT DEFAULT 'reserved',
      checked_in_at TIMESTAMPTZ,
      checkout_at TIMESTAMPTZ,
      confirme_at TIMESTAMPTZ,
      mode_paiement TEXT DEFAULT 'en_ligne',
      confirme_manuellement_par INTEGER,
      confirme_manuellement_at TIMESTAMPTZ,
      note_gerant TEXT
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS creneaux (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      date DATE NOT NULL,
      heure_debut TIME NOT NULL,
      heure_fin TIME NOT NULL,
      statut TEXT NOT NULL DEFAULT 'libre',
      fenetre_retard INTEGER DEFAULT 30,
      UNIQUE (terrain_id, date, heure_debut, heure_fin)
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS paiements (
      id SERIAL PRIMARY KEY,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id),
      montant DECIMAL(10, 2),
      methode VARCHAR(50),
      statut VARCHAR(50) DEFAULT 'en_attente',
      reference_externe VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      reference_paytech TEXT,
      montant_acompte INTEGER,
      montant_commission INTEGER,
      montant_reverse INTEGER,
      statut_reversement TEXT DEFAULT 'en_attente'
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS matchs (
      id SERIAL PRIMARY KEY,
      reservation_id INTEGER NOT NULL UNIQUE REFERENCES reservations(id),
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      gerant_id INTEGER NOT NULL REFERENCES employes(id),
      montant_total DECIMAL(10, 2) NOT NULL,
      acompte_paye DECIMAL(10, 2) NOT NULL,
      solde_paye DECIMAL(10, 2) NOT NULL,
      methode_solde TEXT DEFAULT 'especes',
      joue_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS auth_otps (
      id SERIAL PRIMARY KEY,
      telephone VARCHAR(50) NOT NULL,
      code VARCHAR(10) NOT NULL,
      user_id INTEGER REFERENCES users(id),
      expires_at TIMESTAMPTZ NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await c.query('CREATE INDEX IF NOT EXISTS idx_auth_otps_telephone ON auth_otps(telephone)');

  await c.query(`UPDATE users SET role = 'super_admin' WHERE role = 'superadmin'`);
  await c.query('UPDATE terrains SET prix_entier = prix_heure WHERE prix_entier IS NULL');
  await c.query('UPDATE terrains SET prix_moitie = ROUND(prix_heure * 0.6) WHERE prix_moitie IS NULL');
  await c.query('UPDATE terrains SET acompte = montant_acompte WHERE acompte IS NULL AND montant_acompte IS NOT NULL');
  await c.query('UPDATE terrains SET montant_acompte = acompte WHERE montant_acompte IS NULL AND acompte IS NOT NULL');
  await c.query('UPDATE terrains SET commission = 400 WHERE commission IS NULL');
  await c.query(`UPDATE terrains SET modele_revenus = 'commission' WHERE modele_revenus IS NULL`);
  await c.query(`UPDATE terrains SET pourcentage_avance = ROUND((COALESCE(montant_acompte, acompte, 5000) * 100.0) / NULLIF(COALESCE(prix_entier, prix_heure), 0), 2) WHERE pourcentage_avance IS NULL`);
  await c.query(`UPDATE terrains SET commission_pourcentage = ROUND((COALESCE(commission, 0) * 100.0) / NULLIF(COALESCE(montant_acompte, acompte, 5000), 0), 2) WHERE commission_pourcentage IS NULL OR commission_pourcentage = 0`);
  await addColumnIfMissing(c, 'terrains', 'delai_verrou_paiement_min', 'INTEGER DEFAULT 15');
  await c.query('UPDATE terrains SET delai_verrou_paiement_min = 15 WHERE delai_verrou_paiement_min IS NULL');
  await c.query('UPDATE reservations SET prix_total = montant WHERE prix_total IS NULL');
  await c.query('UPDATE reservations SET acompte = LEAST(5000, montant) WHERE acompte IS NULL');
  await c.query('UPDATE reservations SET reste_a_payer = GREATEST(0, prix_total - acompte) WHERE reste_a_payer IS NULL');
  await c.query('UPDATE reservations SET montant_avance = acompte WHERE montant_avance IS NULL AND acompte IS NOT NULL');
  await c.query(`UPDATE reservations SET confirme_at = (
    SELECT p.created_at FROM paiements p
     WHERE p.reservation_id = reservations.id AND p.statut = 'paye'
     ORDER BY p.id DESC LIMIT 1
  ) WHERE confirme_at IS NULL AND statut IN ('confirme', 'acceptee', 'match_joue', 'joue')`);
  await c.query('UPDATE reservations SET montant_restant = reste_a_payer WHERE montant_restant IS NULL AND reste_a_payer IS NOT NULL');

  await c.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_code ON reservations(code_reservation)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_users_telephone ON users(telephone)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_reservations_creneau ON reservations(creneau_id)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_reservations_statut ON reservations(statut)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_reservations_terrain_date ON reservations(terrain_id, date)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_reservations_joueur ON reservations(joueur_id, created_at DESC)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_avis_terrain ON avis(terrain_id, created_at DESC)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_horaires_terrain ON horaires(terrain_id)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_employes_terrain_active ON employes(terrain_id, is_active)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_creneaux_statut ON creneaux(statut)');
  // Migration 009 — durée variables (1 résa = 1 ligne creneaux)
  try {
    await c.query(`
      ALTER TABLE creneaux
        ADD COLUMN IF NOT EXISTS duree_minutes INTEGER
        GENERATED ALWAYS AS (
          (
            (EXTRACT(HOUR FROM heure_fin)::INTEGER * 60 + EXTRACT(MINUTE FROM heure_fin)::INTEGER)
            -
            (EXTRACT(HOUR FROM heure_debut)::INTEGER * 60 + EXTRACT(MINUTE FROM heure_debut)::INTEGER)
          )
        ) STORED
    `);
  } catch (err) {
    // Colonne déjà présente ou non générable (ex. déjà ajoutée manuellement)
    if (!/already exists|duplicate/i.test(String(err.message || ''))) {
      console.warn('[schema] duree_minutes:', err.message);
    }
  }
  await c.query(`
    CREATE INDEX IF NOT EXISTS idx_creneaux_terrain_date_heures
      ON creneaux(terrain_id, date, heure_debut, heure_fin, statut)
  `);
  await c.query('CREATE INDEX IF NOT EXISTS idx_paiements_reservation ON paiements(reservation_id)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_paiements_reference_paytech ON paiements(reference_paytech)');
  try {
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_paiements_ref_paytech_unique
      ON paiements(reference_paytech) WHERE reference_paytech IS NOT NULL AND reference_paytech != ''`);
  } catch (err) {
    console.warn('Index idempotence paiements non créé:', err.message);
  }

  await c.query(`
    CREATE TABLE IF NOT EXISTS tarifs_dynamiques (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      jour TEXT NOT NULL,
      heure INTEGER NOT NULL,
      prix_entier DECIMAL(10, 2) NOT NULL,
      prix_moitie DECIMAL(10, 2) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (terrain_id, jour, heure)
    )
  `);
  await c.query('CREATE INDEX IF NOT EXISTS idx_tarifs_dynamiques_terrain ON tarifs_dynamiques(terrain_id)');

  await c.query(`
    CREATE TABLE IF NOT EXISTS regles_tarifs (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      nom TEXT NOT NULL,
      prix_demi_terrain INTEGER NOT NULL,
      prix_terrain_entier INTEGER NOT NULL,
      type TEXT CHECK (type IN ('semaine','weekend','soiree','special')),
      jours TEXT,
      heure_debut TIME,
      heure_fin TIME,
      priorite INTEGER DEFAULT 0,
      actif INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      source TEXT DEFAULT 'manuelle'
    )
  `);
  await c.query('CREATE INDEX IF NOT EXISTS idx_regles_tarifs_terrain ON regles_tarifs(terrain_id)');

  await c.query(`
    CREATE TABLE IF NOT EXISTS propositions_grille_tarifs (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      demandeur_type TEXT,
      demandeur_id INTEGER,
      payload TEXT NOT NULL,
      statut TEXT DEFAULT 'en_attente',
      commentaire TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      traite_at TIMESTAMPTZ,
      traite_par INTEGER
    )
  `);
  await c.query('CREATE INDEX IF NOT EXISTS idx_propositions_grille_terrain ON propositions_grille_tarifs(terrain_id, statut)');

  await c.query(`
    CREATE TABLE IF NOT EXISTS portefeuille_gerant (
      id SERIAL PRIMARY KEY,
      gerant_id INTEGER NOT NULL REFERENCES users(id),
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      solde_disponible INTEGER DEFAULT 0,
      solde_en_attente INTEGER DEFAULT 0,
      total_encaisse INTEGER DEFAULT 0,
      total_commission_prelevee INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (gerant_id, terrain_id)
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS reversements (
      id SERIAL PRIMARY KEY,
      gerant_id INTEGER NOT NULL REFERENCES users(id),
      terrain_id INTEGER NOT NULL,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id),
      montant INTEGER NOT NULL,
      commission_prelevee INTEGER DEFAULT 0,
      statut TEXT DEFAULT 'effectue',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await c.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_reversements_reservation ON reversements(reservation_id)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_reversements_gerant ON reversements(gerant_id)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_reversements_terrain ON reversements(terrain_id)');

  await c.query(`
    CREATE TABLE IF NOT EXISTS abonnements (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      montant INTEGER NOT NULL,
      date_echeance DATE NOT NULL,
      statut TEXT CHECK (statut IN ('paye', 'en_attente', 'en_retard')) DEFAULT 'en_attente',
      paye_le TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await c.query('CREATE INDEX IF NOT EXISTS idx_abonnements_terrain ON abonnements(terrain_id)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_abonnements_echeance ON abonnements(date_echeance, statut)');
  await addColumnIfMissing(c, 'abonnements', 'notif_abo_j7', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(c, 'abonnements', 'notif_abo_j3', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(c, 'abonnements', 'notif_abo_j1', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(c, 'abonnements', 'notif_abo_retard', 'INTEGER DEFAULT 0');

  await c.query(`
    CREATE TABLE IF NOT EXISTS terrain_photos (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      url TEXT NOT NULL,
      nom_fichier TEXT,
      taille_octets INTEGER,
      est_principale INTEGER DEFAULT 0,
      ordre INTEGER DEFAULT 0,
      uploaded_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      uploaded_by INTEGER,
      uploaded_by_role TEXT,
      valide INTEGER DEFAULT 1,
      valide_par INTEGER,
      valide_at TIMESTAMPTZ,
      largeur_px INTEGER,
      hauteur_px INTEGER,
      ratio TEXT
    )
  `);
  await c.query('CREATE INDEX IF NOT EXISTS idx_terrain_photos_terrain ON terrain_photos(terrain_id, ordre)');

  await c.query(`
    CREATE TABLE IF NOT EXISTS commodites (
      id SERIAL PRIMARY KEY,
      cle TEXT NOT NULL UNIQUE,
      label_fr TEXT NOT NULL,
      icone TEXT NOT NULL,
      description TEXT,
      actif INTEGER DEFAULT 1,
      ordre INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      modifiable_gerant INTEGER DEFAULT 1
    )
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS terrain_commodites (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      commodite_id INTEGER NOT NULL REFERENCES commodites(id),
      actif INTEGER DEFAULT 1,
      force_par_admin INTEGER DEFAULT 0,
      UNIQUE(terrain_id, commodite_id)
    )
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS audit_photos (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL,
      photo_id INTEGER,
      action TEXT NOT NULL,
      fait_par INTEGER,
      role_fait_par TEXT,
      detail TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS audit_commodites (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER,
      commodite_id INTEGER,
      action TEXT NOT NULL,
      fait_par INTEGER,
      role_fait_par TEXT,
      detail TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await c.query('CREATE INDEX IF NOT EXISTS idx_terrain_commodites_terrain ON terrain_commodites(terrain_id)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_audit_photos_terrain ON audit_photos(terrain_id, created_at)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_audit_commodites_terrain ON audit_commodites(terrain_id, created_at)');

  await c.query(`
    CREATE TABLE IF NOT EXISTS terrain_features (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
      feature_cle TEXT NOT NULL,
      actif INTEGER DEFAULT 1,
      configure_par INTEGER,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(terrain_id, feature_cle)
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS terrain_formats (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
      cle TEXT NOT NULL,
      label TEXT NOT NULL,
      prix_heure DECIMAL(10, 2) NOT NULL DEFAULT 0,
      map_grille TEXT,
      ordre INTEGER DEFAULT 0,
      actif INTEGER DEFAULT 1,
      UNIQUE(terrain_id, cle)
    )
  `);
  await c.query('CREATE INDEX IF NOT EXISTS idx_terrain_formats_terrain ON terrain_formats(terrain_id)');

  await c.query(`
    CREATE TABLE IF NOT EXISTS terrain_durees (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
      minutes INTEGER NOT NULL,
      label TEXT NOT NULL,
      ordre INTEGER DEFAULT 0,
      actif INTEGER DEFAULT 1,
      UNIQUE(terrain_id, minutes)
    )
  `);
  await c.query('CREATE INDEX IF NOT EXISTS idx_terrain_durees_terrain ON terrain_durees(terrain_id)');

  await seedDefaultCommodites(c);
  await migrateJsonCommodites(c);

  await c.query(`
    CREATE TABLE IF NOT EXISTS dettes_commissions (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      gerant_id INTEGER NOT NULL,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id),
      montant_commission INTEGER NOT NULL,
      montant_avance_manuelle INTEGER NOT NULL,
      statut TEXT DEFAULT 'en_attente' CHECK (statut IN ('en_attente','payee','annulee')),
      periode TEXT NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      payee_at TIMESTAMPTZ,
      remise_a_zero_par INTEGER,
      remise_a_zero_at TIMESTAMPTZ
    )
  `);
  await c.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_dettes_reservation ON dettes_commissions(reservation_id)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_dettes_terrain ON dettes_commissions(terrain_id, statut, periode)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_dettes_gerant ON dettes_commissions(gerant_id, statut)');

  await c.query(`
    CREATE TABLE IF NOT EXISTS audit_dette (
      id SERIAL PRIMARY KEY,
      dette_id INTEGER REFERENCES dettes_commissions(id),
      terrain_id INTEGER REFERENCES terrains(id),
      action TEXT NOT NULL CHECK (action IN (
        'creation','paiement_partiel','paiement_total',
        'remise_a_zero','annulation','note_ajoutee'
      )),
      montant_concerne INTEGER,
      fait_par INTEGER,
      role_fait_par TEXT,
      detail TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS plateforme_settings (
      cle TEXT PRIMARY KEY,
      valeur TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS mode_revenu_history (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL,
      ancien_mode TEXT,
      nouveau_mode TEXT NOT NULL,
      fait_par INTEGER,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS activite_gerant (
      id SERIAL PRIMARY KEY,
      gerant_id INTEGER REFERENCES employes(id),
      terrain_id INTEGER REFERENCES terrains(id),
      action TEXT NOT NULL CHECK (action IN (
        'reservation_creee',
        'reservation_annulee',
        'qr_scanne',
        'kanban_stage',
        'creneau_cree',
        'creneau_supprime'
      )),
      reservation_id INTEGER REFERENCES reservations(id),
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS score_confiance (
      id SERIAL PRIMARY KEY,
      gerant_id INTEGER REFERENCES employes(id),
      terrain_id INTEGER REFERENCES terrains(id),
      periode TEXT NOT NULL,
      reservations_confirmees INTEGER DEFAULT 0,
      matchs_scannes INTEGER DEFAULT 0,
      taux_scan REAL DEFAULT 0,
      annulations_total INTEGER DEFAULT 0,
      score INTEGER DEFAULT 100,
      alerte_envoyee INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(gerant_id, terrain_id, periode)
    )
  `);
  await c.query('CREATE INDEX IF NOT EXISTS idx_activite_gerant ON activite_gerant(gerant_id, terrain_id, created_at)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_score_confiance ON score_confiance(gerant_id, terrain_id, periode)');

  await c.query(`
    CREATE TABLE IF NOT EXISTS gerants_terrains (
      id SERIAL PRIMARY KEY,
      gerant_id INTEGER NOT NULL REFERENCES employes(id) ON DELETE CASCADE,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
      est_principal INTEGER DEFAULT 0,
      actif INTEGER DEFAULT 1,
      date_debut DATE,
      date_fin DATE,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(gerant_id, terrain_id)
    )
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS planning_garde (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
      gerant_id INTEGER NOT NULL REFERENCES employes(id) ON DELETE CASCADE,
      jour_semaine INTEGER,
      heure_debut TIME,
      heure_fin TIME,
      date_specifique DATE,
      actif INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (gerant_id, terrain_id) REFERENCES gerants_terrains(gerant_id, terrain_id)
    )
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS audit_gerants_terrain (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER REFERENCES terrains(id),
      gerant_id INTEGER REFERENCES employes(id),
      action TEXT NOT NULL CHECK (action IN (
        'ajout','suppression','passage_principal',
        'desactivation','planning_modifie'
      )),
      fait_par INTEGER,
      role_fait_par TEXT,
      detail TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS sessions_gerant_actives (
      id SERIAL PRIMARY KEY,
      gerant_id INTEGER NOT NULL REFERENCES employes(id),
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      derniere_activite TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(gerant_id, terrain_id)
    )
  `);
  await c.query('CREATE INDEX IF NOT EXISTS idx_gerants_terrains_terrain ON gerants_terrains(terrain_id, actif)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_gerants_terrains_gerant ON gerants_terrains(gerant_id, actif)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_planning_garde_terrain ON planning_garde(terrain_id, jour_semaine, actif)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_audit_gerants_terrain ON audit_gerants_terrain(terrain_id, created_at)');
  await c.query('CREATE INDEX IF NOT EXISTS idx_sessions_gerant_terrain ON sessions_gerant_actives(terrain_id, derniere_activite)');

  try {
    await c.query(`
      INSERT INTO gerants_terrains (
        gerant_id, terrain_id, est_principal, actif, date_debut, note
      )
      SELECT
        e.id, e.terrain_id, 1, COALESCE(e.is_active, 1),
        (COALESCE(e.created_at, NOW()))::date,
        'Migration 008 — gérant historique'
      FROM employes e
      WHERE e.terrain_id IS NOT NULL
      ON CONFLICT (gerant_id, terrain_id) DO NOTHING
    `);
  } catch (err) {
    console.warn('[schema] backfill gerants_terrains:', err.message);
  }

  await c.query(`
    CREATE TABLE IF NOT EXISTS avis (
      id SERIAL PRIMARY KEY,
      reservation_id INTEGER REFERENCES reservations(id),
      joueur_id INTEGER REFERENCES users(id),
      joueur_nom VARCHAR(255),
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      note INTEGER CHECK (note >= 1 AND note <= 5),
      commentaire TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      destinataire_type VARCHAR(50),
      destinataire_id INTEGER,
      type VARCHAR(50),
      canal VARCHAR(50) DEFAULT 'whatsapp',
      contenu TEXT,
      lu INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await c.query(`ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_fkey`);
  await addColumnIfMissing(c, 'push_subscriptions', 'account_type', "VARCHAR(20) NOT NULL DEFAULT 'user'");
  await addColumnIfMissing(c, 'push_subscriptions', 'actif', 'INTEGER DEFAULT 1');
  await addColumnIfMissing(c, 'push_subscriptions', 'last_used_at', 'TIMESTAMPTZ');
  await c.query(`CREATE INDEX IF NOT EXISTS idx_push_sub_actor ON push_subscriptions (account_type, user_id, actif)`);

  await c.query(`
    CREATE TABLE IF NOT EXISTS push_preferences (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      reservation_confirmation INTEGER DEFAULT 1,
      rappel_reservation INTEGER DEFAULT 1,
      promotion INTEGER DEFAULT 0,
      nouveau_message INTEGER DEFAULT 1,
      avis_reponse INTEGER DEFAULT 1
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS notif_preferences (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      account_type VARCHAR(20) NOT NULL DEFAULT 'user',
      push_resa_confirmee INTEGER DEFAULT 1,
      push_resa_annulee INTEGER DEFAULT 1,
      push_rappel_match INTEGER DEFAULT 1,
      push_remboursement INTEGER DEFAULT 1,
      push_nouvelle_resa INTEGER DEFAULT 1,
      push_match_imminent INTEGER DEFAULT 1,
      push_reversement INTEGER DEFAULT 1,
      push_dette_rappel INTEGER DEFAULT 1,
      push_revenus INTEGER DEFAULT 1,
      push_sante_gerant INTEGER DEFAULT 1,
      push_abonnement INTEGER DEFAULT 1,
      push_retrait_demande INTEGER DEFAULT 1,
      push_payout_echec INTEGER DEFAULT 1,
      push_alertes_terrain INTEGER DEFAULT 1,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (account_type, user_id)
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS push_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      account_type VARCHAR(20) DEFAULT 'user',
      type_notif TEXT NOT NULL,
      titre TEXT NOT NULL,
      corps TEXT NOT NULL,
      data TEXT,
      statut VARCHAR(20) DEFAULT 'envoye' CHECK (statut IN ('envoye','echoue','clique','ferme')),
      erreur TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await c.query(`CREATE INDEX IF NOT EXISTS idx_push_logs_user ON push_logs (user_id, created_at DESC)`);
  await c.query(`CREATE INDEX IF NOT EXISTS idx_push_logs_type ON push_logs (type_notif, created_at DESC)`);

  await addColumnIfMissing(c, 'reservations', 'push_rappel_j1', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(c, 'reservations', 'push_rappel_h2', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(c, 'reservations', 'push_match_imminent', 'INTEGER DEFAULT 0');

  await c.query(`
    CREATE TABLE IF NOT EXISTS reservation_reminders (
      id SERIAL PRIMARY KEY,
      reservation_id INTEGER NOT NULL UNIQUE REFERENCES reservations(id),
      sent_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await c.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      acteur_type VARCHAR(50),
      acteur_id INTEGER,
      action VARCHAR(255),
      table_cible VARCHAR(255),
      enregistrement_id INTEGER,
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Colonnes éventuelles manquantes sur bases déjà créées
  await addColumnIfMissing(c, 'regles_tarifs', 'source', "TEXT DEFAULT 'manuelle'");

  // Politique sans avance + délai paiement dette commission (canonique : avance | sans_avance)
  await addColumnIfMissing(c, 'terrains', 'politique_paiement', "TEXT DEFAULT 'avance'");
  await addColumnIfMissing(c, 'terrains', 'delai_paiement_dette_jours', 'INTEGER DEFAULT 30');
  await c.query(`
    UPDATE terrains
       SET politique_paiement = CASE
         WHEN politique_paiement IN ('sans_avance') THEN 'sans_avance'
         ELSE 'avance'
       END
     WHERE politique_paiement IS NULL
        OR politique_paiement = ''
        OR politique_paiement NOT IN ('avance', 'sans_avance')
  `);
  await c.query(`
    UPDATE terrains
       SET politique_paiement = 'avance'
     WHERE politique_paiement = 'avec_avance'
  `);
  await c.query(`
    UPDATE terrains
       SET delai_paiement_dette_jours = 30
     WHERE delai_paiement_dette_jours IS NULL OR delai_paiement_dette_jours < 1
  `);

  await addColumnIfMissing(c, 'dettes_commissions', 'date_echeance', 'DATE');
  await addColumnIfMissing(c, 'dettes_commissions', 'montant_regle', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(c, 'dettes_commissions', 'derniere_mise_a_jour', 'TIMESTAMPTZ');

  await c.query(`
    CREATE TABLE IF NOT EXISTS resume_dette_periode (
      id SERIAL PRIMARY KEY,
      terrain_id INTEGER NOT NULL REFERENCES terrains(id),
      gerant_id INTEGER NOT NULL,
      periode TEXT NOT NULL,
      total_commission INTEGER DEFAULT 0,
      total_regle INTEGER DEFAULT 0,
      solde_restant INTEGER GENERATED ALWAYS AS (total_commission - total_regle) STORED,
      date_echeance DATE,
      statut TEXT DEFAULT 'en_cours'
        CHECK (statut IN ('en_cours','partiellement_regle','solde','en_retard')),
      notif_j7_envoyee INTEGER DEFAULT 0,
      notif_j3_envoyee INTEGER DEFAULT 0,
      notif_j1_envoyee INTEGER DEFAULT 0,
      notif_retard_envoyee INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(terrain_id, gerant_id, periode)
    )
  `);
  await c.query(`
    CREATE INDEX IF NOT EXISTS idx_resume_dette_terrain
      ON resume_dette_periode(terrain_id, periode, statut)
  `);
  await addColumnIfMissing(c, 'resume_dette_periode', 'notif_retard_envoyee', 'INTEGER DEFAULT 0');

  console.log('✅ Schéma PostgreSQL initialisé.');
}

const DEFAULT_COMMODITES = [
  ['eclairage', 'Éclairage nocturne', 'Lightbulb', 1],
  ['vestiaires', 'Vestiaires', 'Shirt', 2],
  ['douches', 'Douches', 'ShowerHead', 3],
  ['parking', 'Parking', 'SquareParking', 4],
  ['buvette', 'Buvette', 'Utensils', 5],
  ['tribune', 'Tribune', 'Users', 6],
  ['wifi', 'Wi-Fi', 'Wifi', 7],
  ['arbitre', 'Arbitre disponible', 'Award', 8],
  ['ballon', 'Ballon fourni', 'CircleDot', 9],
  ['securite', 'Agent de sécurité', 'ShieldCheck', 10],
  ['dossards', 'Dossards fournis', 'Shirt', 11],
  ['eau', 'Eau à la mi-temps', 'Droplet', 12],
  ['toilettes', 'Toilettes', 'Bath', 13],
  ['priere', 'Espace de prière', 'Building2', 14],
  ['glacons', 'Glaçons / Glacière', 'Snowflake', 15],
  ['secours', 'Premiers secours', 'Cross', 16],
  ['video', 'Enregistrement vidéo', 'Video', 17],
];

async function seedDefaultCommodites(client) {
  for (const [cle, label_fr, icone, ordre] of DEFAULT_COMMODITES) {
    await client.query(
      `INSERT INTO commodites (cle, label_fr, icone, actif, ordre)
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (cle) DO NOTHING`,
      [cle, label_fr, icone, ordre],
    );
  }
}

async function migrateJsonCommodites(client) {
  const byCleRes = await client.query('SELECT id, cle FROM commodites');
  const byCle = new Map(byCleRes.rows.map((row) => [row.cle, row.id]));
  const terrainsRes = await client.query('SELECT id, commodites FROM terrains');
  for (const terrain of terrainsRes.rows) {
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
      await client.query(
        `INSERT INTO terrain_commodites (terrain_id, commodite_id, actif)
         VALUES ($1, $2, 1)
         ON CONFLICT (terrain_id, commodite_id) DO NOTHING`,
        [terrain.id, cid],
      );
    }
  }
}

module.exports = {
  getDb,
  saveDb,
  queryAll,
  queryOne,
  runSql,
  transaction,
  rowsModified,
  pool,
  DATABASE_URL,
};
