/**
 * Complexes (sites) : regroupement de terrains d'un même propriétaire.
 * Contrainte applicative : un gérant actif ne peut être rattaché qu'à des terrains
 * du même site (et donc du même propriétaire). site_id NULL = legacy toléré.
 */
const { queryAll, queryOne, runSql } = require('../database');

function httpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Crée ou réutilise un site pour un propriétaire (match exact nom + proprio).
 * @returns {number} site id
 */
function ensureSite(db, { proprietaire_id, nom, adresse = null, ville = null }) {
  const pid = Number(proprietaire_id);
  const nomClean = String(nom || '').trim();
  if (!pid || !nomClean) {
    throw httpError('proprietaire_id et nom requis pour créer un site', 400);
  }

  const existing = queryOne(
    db,
    'SELECT id FROM sites WHERE proprietaire_id = ? AND nom = ?',
    [pid, nomClean],
  );
  if (existing) {
    runSql(
      db,
      `UPDATE sites SET adresse = COALESCE(?, adresse), ville = COALESCE(?, ville),
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [adresse || null, ville || null, existing.id],
    );
    return Number(existing.id);
  }

  return Number(runSql(
    db,
    `INSERT INTO sites (proprietaire_id, nom, adresse, ville)
     VALUES (?, ?, ?, ?)`,
    [pid, nomClean, adresse || null, ville || null],
  ).lastInsertRowid);
}

function assignerTerrainAuSite(db, terrain_id, site_id) {
  const tid = Number(terrain_id);
  const sid = site_id != null ? Number(site_id) : null;
  const terrain = queryOne(db, 'SELECT id, proprietaire_id, site_id FROM terrains WHERE id = ?', [tid]);
  if (!terrain) throw httpError('Terrain introuvable', 404);

  if (sid != null) {
    const site = queryOne(db, 'SELECT id, proprietaire_id FROM sites WHERE id = ?', [sid]);
    if (!site) throw httpError('Site introuvable', 404);
    if (Number(site.proprietaire_id) !== Number(terrain.proprietaire_id)) {
      throw httpError('Le site doit appartenir au même propriétaire que le terrain', 400);
    }
  }

  runSql(db, 'UPDATE terrains SET site_id = ? WHERE id = ?', [sid, tid]);
  return tid;
}

/**
 * Vérifie qu'un gérant peut être rattaché à ce terrain (même proprio + même site).
 * Appeler avant INSERT/UPDATE actif=1 sur gerants_terrains.
 */
function assertGerantCompatibleAvecTerrain(db, gerant_id, terrain_id) {
  const gid = Number(gerant_id);
  const tid = Number(terrain_id);

  const cible = queryOne(
    db,
    'SELECT id, proprietaire_id, site_id, nom FROM terrains WHERE id = ?',
    [tid],
  );
  if (!cible) throw httpError('Terrain introuvable', 404);

  const autres = queryAll(
    db,
    `SELECT t.id, t.proprietaire_id, t.site_id, t.nom
     FROM gerants_terrains gt
     JOIN terrains t ON t.id = gt.terrain_id
     WHERE gt.gerant_id = ? AND gt.actif = 1 AND gt.terrain_id != ?`,
    [gid, tid],
  );

  if (!autres.length) return { ok: true, cible };

  for (const a of autres) {
    if (Number(a.proprietaire_id) !== Number(cible.proprietaire_id)) {
      throw httpError(
        'Tous les terrains d\'un gérant doivent appartenir au même propriétaire',
        400,
      );
    }
  }

  const sitesExistants = [
    ...new Set(
      autres
        .map((a) => (a.site_id != null ? Number(a.site_id) : null))
        .filter((s) => s != null),
    ),
  ];

  if (cible.site_id != null) {
    const sid = Number(cible.site_id);
    if (sitesExistants.length && !sitesExistants.includes(sid)) {
      throw httpError(
        'Ce terrain appartient à un autre complexe (site) que ceux déjà gérés par ce gérant',
        400,
      );
    }
  } else if (sitesExistants.length === 1) {
    throw httpError(
      'Assignez d\'abord ce terrain au même complexe (site) que les autres terrains du gérant',
      400,
    );
  } else if (sitesExistants.length > 1) {
    throw httpError(
      'Ce gérant est déjà rattaché à plusieurs complexes — corrigez les rattachements avant d\'ajouter un terrain',
      400,
    );
  }

  return { ok: true, cible };
}

module.exports = {
  ensureSite,
  assignerTerrainAuSite,
  assertGerantCompatibleAvecTerrain,
};
