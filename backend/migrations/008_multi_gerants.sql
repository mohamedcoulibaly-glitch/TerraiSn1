-- ============================================================================
-- 008_multi_gerants.sql
-- Gestion multi-gérants : liaison, planning de garde, audit
--
-- Décisions Phase 1 :
--   - gerant_id → employes(id)  (pas users — les gérants sont dans employes)
--   - Backfill depuis employes.terrain_id (est_principal = 1)
--   - employes.terrain_id conservé (compat JWT / routes existantes)
--   - Aucune modification payments/flow.js
--
-- Appliqué au runtime via CREATE TABLE IF NOT EXISTS dans backend/database.js
-- (ou exécution manuelle de ce fichier). Idempotent.
-- ============================================================================

-- Enrichir / créer la table de liaison gérant <-> terrain
CREATE TABLE IF NOT EXISTS gerants_terrains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gerant_id INTEGER NOT NULL REFERENCES employes(id) ON DELETE CASCADE,
  terrain_id INTEGER NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  est_principal INTEGER DEFAULT 0,
  -- 1 = gérant principal du terrain
  -- 0 = gérant supplémentaire
  actif INTEGER DEFAULT 1,
  date_debut DATE,
  date_fin DATE,
  -- null = sans fin définie
  note TEXT,
  -- ex: "Gérant matin", "Gérant week-end"
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(gerant_id, terrain_id)
);

-- Contrainte : un seul gérant principal par terrain
-- Géré en application, pas en DB (SQLite ne gère pas facilement
-- les partial unique indexes)

-- Planning de garde (optionnel par terrain)
CREATE TABLE IF NOT EXISTS planning_garde (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terrain_id INTEGER NOT NULL REFERENCES terrains(id) ON DELETE CASCADE,
  gerant_id INTEGER NOT NULL REFERENCES employes(id) ON DELETE CASCADE,
  jour_semaine INTEGER,
  -- 0=lundi, 1=mardi ... 6=dimanche, NULL=tous les jours
  heure_debut TIME,
  -- ex: '06:00', NULL = toute la journée
  heure_fin TIME,
  -- ex: '14:00', NULL = toute la journée
  date_specifique DATE,
  -- si renseigné, prioritaire sur jour_semaine
  actif INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (gerant_id, terrain_id)
    REFERENCES gerants_terrains(gerant_id, terrain_id)
);

-- Audit multi-gérants
-- fait_par : users.id (super_admin) ou autre acteur — pas de FK stricte
--   (mix possible users / proprietaires / employes)
CREATE TABLE IF NOT EXISTS audit_gerants_terrain (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terrain_id INTEGER REFERENCES terrains(id),
  gerant_id INTEGER REFERENCES employes(id),
  action TEXT NOT NULL CHECK(action IN (
    'ajout','suppression','passage_principal',
    'desactivation','planning_modifie'
  )),
  fait_par INTEGER,
  role_fait_par TEXT,
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index
CREATE INDEX IF NOT EXISTS idx_gerants_terrains_terrain
  ON gerants_terrains(terrain_id, actif);
CREATE INDEX IF NOT EXISTS idx_gerants_terrains_gerant
  ON gerants_terrains(gerant_id, actif);
CREATE INDEX IF NOT EXISTS idx_planning_garde_terrain
  ON planning_garde(terrain_id, jour_semaine, actif);
CREATE INDEX IF NOT EXISTS idx_audit_gerants_terrain
  ON audit_gerants_terrain(terrain_id, created_at);

-- Sessions actives (concurrence / indicateur "en ligne")
CREATE TABLE IF NOT EXISTS sessions_gerant_actives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gerant_id INTEGER NOT NULL REFERENCES employes(id),
  terrain_id INTEGER NOT NULL REFERENCES terrains(id),
  derniere_activite DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(gerant_id, terrain_id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_gerant_terrain
  ON sessions_gerant_actives(terrain_id, derniere_activite);

-- ============================================================================
-- Backfill : chaque employé déjà rattaché à un terrain devient
-- gérant principal actif de ce terrain (idempotent via INSERT OR IGNORE)
-- ============================================================================
INSERT OR IGNORE INTO gerants_terrains (
  gerant_id,
  terrain_id,
  est_principal,
  actif,
  date_debut,
  note
)
SELECT
  e.id,
  e.terrain_id,
  1,
  COALESCE(e.is_active, 1),
  date(COALESCE(e.created_at, CURRENT_TIMESTAMP)),
  'Migration 008 — gérant historique'
FROM employes e
WHERE e.terrain_id IS NOT NULL;
