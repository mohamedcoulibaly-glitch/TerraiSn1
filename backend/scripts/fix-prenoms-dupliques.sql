-- One-shot : corrige les prénoms dupliqués (ex: BabacarBabacar → Babacar)
-- et les noms qui recommencent par le prénom (ex: nom = "Babacar Sene" avec prenom = "Babacar").
-- Vérifier avec les SELECT avant d'exécuter les UPDATE.

-- 1) Diagnostic : prénom concaténé sans espace (même chaîne 2×)
SELECT id, prenom, nom
FROM users
WHERE length(prenom) > 0
  AND length(prenom) % 2 = 0
  AND substr(prenom, 1, length(prenom) / 2) = substr(prenom, length(prenom) / 2 + 1);

-- 2) Diagnostic : nom qui commence par "prenom "
SELECT id, prenom, nom
FROM users
WHERE prenom IS NOT NULL AND prenom != ''
  AND lower(nom) LIKE lower(prenom) || ' %';

-- 3) Fix prénom doublé sans espace
UPDATE users
SET prenom = substr(prenom, 1, length(prenom) / 2)
WHERE length(prenom) > 0
  AND length(prenom) % 2 = 0
  AND substr(prenom, 1, length(prenom) / 2) = substr(prenom, length(prenom) / 2 + 1);

-- 4) Fix nom = "Prénom Nom" → garder seulement le nom de famille
UPDATE users
SET nom = trim(substr(nom, length(prenom) + 1))
WHERE prenom IS NOT NULL AND prenom != ''
  AND lower(nom) LIKE lower(prenom) || ' %';
