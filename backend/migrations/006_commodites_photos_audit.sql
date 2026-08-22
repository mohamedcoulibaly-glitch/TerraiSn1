-- Commodités référentiel + liaisons + audit photos/commodités
-- Appliqué au runtime dans backend/database.js (sql.js)
-- Fichier 006 car 005_localisation.sql existe déjà.

CREATE TABLE IF NOT EXISTS commodites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cle TEXT NOT NULL UNIQUE,
  label_fr TEXT NOT NULL,
  icone TEXT NOT NULL,
  description TEXT,
  actif INTEGER DEFAULT 1,
  ordre INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS terrain_commodites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terrain_id INTEGER NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  commodite_id INTEGER NOT NULL REFERENCES commodites(id),
  actif INTEGER DEFAULT 1,
  UNIQUE(terrain_id, commodite_id)
);

CREATE TABLE IF NOT EXISTS audit_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terrain_id INTEGER NOT NULL,
  photo_id INTEGER,
  action TEXT NOT NULL,
  fait_par INTEGER,
  role_fait_par TEXT,
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_commodites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terrain_id INTEGER,
  commodite_id INTEGER,
  action TEXT NOT NULL,
  fait_par INTEGER,
  role_fait_par TEXT,
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_terrain_commodites_terrain ON terrain_commodites(terrain_id);
CREATE INDEX IF NOT EXISTS idx_audit_photos_terrain ON audit_photos(terrain_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_commodites_terrain ON audit_commodites(terrain_id, created_at);

-- Colonnes photos via addColumnIfMissing :
-- uploaded_by, uploaded_by_role, valide, valide_par, valide_at, largeur_px, hauteur_px, ratio
