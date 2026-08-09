-- ============================================================================
-- migrations/002_babacar.sql
-- Branche : babacar_sene — session JWT persistante (colonnes users)
-- Rejouable : SQLite n'a pas de ADD COLUMN IF NOT EXISTS.
-- Chaque ALTER est précédé d'une vérification via pragma_table_info.
-- Exécution recommandée : n'appliquer un ALTER que si la requête de
-- vérification retourne 0 ligne (ou ignorer l'erreur "duplicate column name").
-- NE PAS renommer de colonnes existantes. NE PAS modifier montant_acompte.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) users.refresh_token
-- Vérif avant ALTER :
--   SELECT COUNT(*) AS n FROM pragma_table_info('users') WHERE name = 'refresh_token';
-- Appliquer uniquement si n = 0
-- ----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN refresh_token TEXT;

-- ----------------------------------------------------------------------------
-- 2) users.refresh_token_expire_at
-- Vérif avant ALTER :
--   SELECT COUNT(*) AS n FROM pragma_table_info('users') WHERE name = 'refresh_token_expire_at';
-- Appliquer uniquement si n = 0
-- ----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN refresh_token_expire_at DATETIME;

-- ----------------------------------------------------------------------------
-- 3) users.statut
-- Vérif avant ALTER :
--   SELECT COUNT(*) AS n FROM pragma_table_info('users') WHERE name = 'statut';
-- Appliquer uniquement si n = 0
-- Valeurs autorisées : actif | suspendu | bloque
-- ----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN statut TEXT DEFAULT 'actif'
  CHECK(statut IN ('actif', 'suspendu', 'bloque'));

-- ----------------------------------------------------------------------------
-- 4) Backfill (toujours sûr à rejouer)
-- ----------------------------------------------------------------------------
UPDATE users SET statut = 'actif' WHERE statut IS NULL OR TRIM(statut) = '';

-- ============================================================================
-- État post-application (2026-08-06, terrainsn.db) :
--   users.refresh_token              → présent (skipped)
--   users.refresh_token_expire_at    → présent (skipped)
--   users.statut                     → présent (ajouté via database.js / runner)
-- Runner idempotent : backend/scripts/apply_002_babacar.js
-- ============================================================================
