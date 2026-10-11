-- =============================================================================
-- merge_final.sql — Fusion Babacar → Mohamed (SQLite)
-- Idempotent : peut être rejoué sans erreur.
--
-- RÈGLES :
--   NE JAMAIS : DROP TABLE, DROP COLUMN, ALTER TYPE
--   UNIQUEMENT : CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN (via app)
--
-- Note SQLite : ADD COLUMN IF NOT EXISTS n'est pas portable sur toutes les
-- versions. Les colonnes sont aussi appliquées par backend/database.js
-- (addColumnIfMissing). Ce fichier documente le schéma attendu et peut être
-- rejoué via scripts qui ignorent "duplicate column".
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Colonnes terrains ( Babacar )
-- ---------------------------------------------------------------------------
-- ALTER TABLE terrains ADD COLUMN politique_paiement TEXT DEFAULT 'avance';
-- ALTER TABLE terrains ADD COLUMN delai_paiement_dette_jours INTEGER DEFAULT 30;
-- ALTER TABLE terrains ADD COLUMN delai_verrou_paiement_min INTEGER DEFAULT 15;
-- ALTER TABLE terrains ADD COLUMN types_location TEXT DEFAULT 'les_deux';
-- ALTER TABLE terrains ADD COLUMN duree_min_minutes INTEGER DEFAULT 60;

-- ---------------------------------------------------------------------------
-- 2. Tables formats / durées
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS terrain_formats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terrain_id INTEGER NOT NULL,
  cle TEXT NOT NULL,
  label TEXT NOT NULL,
  prix_heure DECIMAL(10, 2) NOT NULL DEFAULT 0,
  map_grille TEXT,
  ordre INTEGER DEFAULT 0,
  actif INTEGER DEFAULT 1,
  UNIQUE(terrain_id, cle),
  FOREIGN KEY (terrain_id) REFERENCES terrains(id)
);
CREATE INDEX IF NOT EXISTS idx_terrain_formats_terrain ON terrain_formats(terrain_id);

CREATE TABLE IF NOT EXISTS terrain_durees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terrain_id INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  label TEXT NOT NULL,
  ordre INTEGER DEFAULT 0,
  actif INTEGER DEFAULT 1,
  UNIQUE(terrain_id, minutes),
  FOREIGN KEY (terrain_id) REFERENCES terrains(id)
);
CREATE INDEX IF NOT EXISTS idx_terrain_durees_terrain ON terrain_durees(terrain_id);

-- ---------------------------------------------------------------------------
-- 3. Multi-gérants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gerants_terrains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gerant_id INTEGER NOT NULL,
  terrain_id INTEGER NOT NULL,
  est_principal INTEGER DEFAULT 0,
  actif INTEGER DEFAULT 1,
  date_debut DATE,
  date_fin DATE,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(gerant_id, terrain_id),
  FOREIGN KEY (gerant_id) REFERENCES employes(id),
  FOREIGN KEY (terrain_id) REFERENCES terrains(id)
);

CREATE TABLE IF NOT EXISTS planning_garde (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terrain_id INTEGER NOT NULL,
  gerant_id INTEGER NOT NULL,
  jour_semaine INTEGER,
  heure_debut TIME,
  heure_fin TIME,
  date_specifique DATE,
  actif INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (terrain_id) REFERENCES terrains(id),
  FOREIGN KEY (gerant_id) REFERENCES employes(id)
);

CREATE TABLE IF NOT EXISTS audit_gerants_terrain (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terrain_id INTEGER,
  gerant_id INTEGER,
  action TEXT NOT NULL,
  fait_par INTEGER,
  role_fait_par TEXT,
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (terrain_id) REFERENCES terrains(id),
  FOREIGN KEY (gerant_id) REFERENCES employes(id)
);

CREATE TABLE IF NOT EXISTS sessions_gerant_actives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gerant_id INTEGER NOT NULL,
  terrain_id INTEGER NOT NULL,
  derniere_activite DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(gerant_id, terrain_id),
  FOREIGN KEY (gerant_id) REFERENCES employes(id),
  FOREIGN KEY (terrain_id) REFERENCES terrains(id)
);

CREATE INDEX IF NOT EXISTS idx_gerants_terrains_terrain ON gerants_terrains(terrain_id, actif);
CREATE INDEX IF NOT EXISTS idx_gerants_terrains_gerant ON gerants_terrains(gerant_id, actif);
CREATE INDEX IF NOT EXISTS idx_planning_garde_terrain ON planning_garde(terrain_id, jour_semaine, actif);
CREATE INDEX IF NOT EXISTS idx_audit_gerants_terrain ON audit_gerants_terrain(terrain_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_gerant_terrain ON sessions_gerant_actives(terrain_id, derniere_activite);

-- ---------------------------------------------------------------------------
-- 4. Push / notifications extras Babacar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notif_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, account_type)
);

CREATE TABLE IF NOT EXISTS push_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  account_type VARCHAR(20) DEFAULT 'user',
  type_notif TEXT NOT NULL,
  titre TEXT NOT NULL,
  corps TEXT NOT NULL,
  data TEXT,
  statut VARCHAR(20) DEFAULT 'envoye',
  erreur TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_push_logs_user ON push_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_push_logs_type ON push_logs(type_notif, created_at);

-- ---------------------------------------------------------------------------
-- 5. Résumé dettes période
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resume_dette_periode (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terrain_id INTEGER NOT NULL,
  gerant_id INTEGER NOT NULL,
  periode TEXT NOT NULL,
  total_commission INTEGER DEFAULT 0,
  total_regle INTEGER DEFAULT 0,
  solde_restant INTEGER DEFAULT 0,
  date_echeance DATE,
  statut TEXT DEFAULT 'en_cours',
  notif_j7_envoyee INTEGER DEFAULT 0,
  notif_j3_envoyee INTEGER DEFAULT 0,
  notif_j1_envoyee INTEGER DEFAULT 0,
  notif_retard_envoyee INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(terrain_id, gerant_id, periode),
  FOREIGN KEY (terrain_id) REFERENCES terrains(id)
);
CREATE INDEX IF NOT EXISTS idx_resume_dette_terrain ON resume_dette_periode(terrain_id, periode, statut);

-- ---------------------------------------------------------------------------
-- 6. Colonnes réservations / dettes (push reminders)
-- ---------------------------------------------------------------------------
-- ALTER TABLE reservations ADD COLUMN push_rappel_j1 INTEGER DEFAULT 0;
-- ALTER TABLE reservations ADD COLUMN push_rappel_h2 INTEGER DEFAULT 0;
-- ALTER TABLE reservations ADD COLUMN push_match_imminent INTEGER DEFAULT 0;
-- ALTER TABLE dettes_commissions ADD COLUMN date_echeance DATE;
-- ALTER TABLE dettes_commissions ADD COLUMN montant_regle INTEGER DEFAULT 0;
-- ALTER TABLE dettes_commissions ADD COLUMN derniere_mise_a_jour DATETIME;
-- ALTER TABLE creneaux ADD COLUMN duree_minutes INTEGER;
-- ALTER TABLE creneaux ADD COLUMN fenetre_retard INTEGER DEFAULT 30;

-- Backfill multi-gérants (gérants historiques)
INSERT OR IGNORE INTO gerants_terrains (
  gerant_id, terrain_id, est_principal, actif, date_debut, note
)
SELECT
  e.id, e.terrain_id, 1, COALESCE(e.is_active, 1),
  date(COALESCE(e.created_at, CURRENT_TIMESTAMP)),
  'merge_final — gérant historique'
FROM employes e
WHERE e.terrain_id IS NOT NULL;
