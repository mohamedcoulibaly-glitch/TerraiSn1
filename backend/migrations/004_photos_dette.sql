-- Photos terrain (si table absente)
CREATE TABLE IF NOT EXISTS terrain_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terrain_id INTEGER NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  nom_fichier TEXT,
  taille_octets INTEGER,
  est_principale INTEGER DEFAULT 0,
  ordre INTEGER DEFAULT 0,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_terrain_photos_terrain
  ON terrain_photos(terrain_id, ordre);

-- Table dettes commissions
CREATE TABLE IF NOT EXISTS dettes_commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terrain_id INTEGER NOT NULL REFERENCES terrains(id),
  gerant_id INTEGER NOT NULL REFERENCES users(id),
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  montant_commission INTEGER NOT NULL,
  montant_avance_manuelle INTEGER NOT NULL,
  statut TEXT DEFAULT 'en_attente'
    CHECK(statut IN ('en_attente','payee','annulee')),
  periode TEXT NOT NULL,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  payee_at DATETIME,
  remise_a_zero_par INTEGER REFERENCES users(id),
  remise_a_zero_at DATETIME,
  UNIQUE(reservation_id)
);

CREATE INDEX IF NOT EXISTS idx_dettes_terrain
  ON dettes_commissions(terrain_id, statut, periode);

CREATE INDEX IF NOT EXISTS idx_dettes_gerant
  ON dettes_commissions(gerant_id, statut);

-- Audit log dette (traçabilité complète)
CREATE TABLE IF NOT EXISTS audit_dette (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dette_id INTEGER REFERENCES dettes_commissions(id),
  terrain_id INTEGER REFERENCES terrains(id),
  action TEXT NOT NULL
    CHECK(action IN (
      'creation','paiement_partiel','paiement_total',
      'remise_a_zero','annulation','note_ajoutee'
    )),
  montant_concerne INTEGER,
  fait_par INTEGER REFERENCES users(id),
  role_fait_par TEXT,
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plateforme_settings (
  cle TEXT PRIMARY KEY,
  valeur TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- SQLite : les ALTER ADD COLUMN sont appliqués de façon idempotente
-- via addColumnIfMissing dans database.js (pas de IF NOT EXISTS natif).
-- Colonnes visées :
--   terrain_photos.nom_fichier, terrain_photos.taille_octets
--   reservations.mode_paiement, confirme_manuellement_par,
--   confirme_manuellement_at, note_gerant
