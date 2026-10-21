-- ============================================================================
-- migrations/005_couleur_primaire.sql
-- Charte graphique du terrain : couleur utilisée sur le QR code stylisé
-- (header/footer) et les communications. Rejouable via addColumnIfMissing
-- dans backend/database.js (même effet au boot).
-- ============================================================================

-- Vérif :
--   SELECT COUNT(*) FROM pragma_table_info('terrains') WHERE name = 'couleur_primaire';
ALTER TABLE terrains ADD COLUMN couleur_primaire TEXT DEFAULT '#059669';
