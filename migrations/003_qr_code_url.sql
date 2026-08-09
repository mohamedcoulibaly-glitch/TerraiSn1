-- ============================================================================
-- migrations/003_qr_code_url.sql
-- Ajoute reservations.qr_code_url si absente (WhatsApp confirmation CDC)
-- Rejouable : vérifier via pragma_table_info avant ALTER
-- ============================================================================

-- Vérif :
--   SELECT COUNT(*) FROM pragma_table_info('reservations') WHERE name = 'qr_code_url';
ALTER TABLE reservations ADD COLUMN qr_code_url TEXT;
