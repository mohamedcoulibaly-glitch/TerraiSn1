-- Délai d'indisponibilité du créneau en attente de paiement (minutes).
-- Par défaut 15 min : après expiration sans confirmation, le créneau redevient libre.
ALTER TABLE terrains
  ADD COLUMN IF NOT EXISTS delai_verrou_paiement_min INTEGER DEFAULT 15;

UPDATE terrains
SET delai_verrou_paiement_min = 15
WHERE delai_verrou_paiement_min IS NULL;
