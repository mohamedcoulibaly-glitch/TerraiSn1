-- ============================================================================
-- 009_creneaux_duree.sql
-- Durées variables : une réservation = une ligne creneaux (heure_debut → heure_fin).
-- PostgreSQL. Idempotent. heure_fin existe déjà dans initSchema.
-- Appliqué aussi au runtime dans backend/database.js.
-- ============================================================================

-- Durée en minutes (colonne générée stockée)
ALTER TABLE creneaux
  ADD COLUMN IF NOT EXISTS duree_minutes INTEGER
  GENERATED ALWAYS AS (
    (
      (EXTRACT(HOUR FROM heure_fin)::INTEGER * 60 + EXTRACT(MINUTE FROM heure_fin)::INTEGER)
      -
      (EXTRACT(HOUR FROM heure_debut)::INTEGER * 60 + EXTRACT(MINUTE FROM heure_debut)::INTEGER)
    )
  ) STORED;

-- Index chevauchements / file d'attente
CREATE INDEX IF NOT EXISTS idx_creneaux_terrain_date_heures
  ON creneaux(terrain_id, date, heure_debut, heure_fin, statut);
