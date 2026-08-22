-- Historique des changements de mode de revenu (essai / commission / abonnement / achat)
-- Appliqué au runtime par CREATE TABLE IF NOT EXISTS dans backend/database.js
-- (sql.js charge terrainsn.db puis initSchema au démarrage du serveur)

CREATE TABLE IF NOT EXISTS mode_revenu_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terrain_id INTEGER NOT NULL,
  ancien_mode TEXT,
  nouveau_mode TEXT NOT NULL,
  fait_par INTEGER,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS terrain_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terrain_id INTEGER NOT NULL,
  feature_cle TEXT NOT NULL,
  actif INTEGER DEFAULT 1,
  configure_par INTEGER,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
