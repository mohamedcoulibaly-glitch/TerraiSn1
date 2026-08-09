-- Commodités / services inclus (JSON array d'ids)
-- Ex: ["dossards","eau","vestiaires","parking"]
ALTER TABLE terrains ADD COLUMN commodites TEXT DEFAULT '[]';
