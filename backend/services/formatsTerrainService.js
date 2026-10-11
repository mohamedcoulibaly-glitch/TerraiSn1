const { queryAll, queryOne, runSql, transaction } = require('../database');

/** Politique produit : réservation en ligne = 1 h uniquement.
 *  Au-delà → le joueur appelle le gérant (tarif négocié / tournoi…). */
const DEFAULT_DUREES = [
  { minutes: 60, label: '1h', ordre: 0 },
];
const DUREE_STANDARD_MINUTES = 60;

function slugify(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function mapFormatRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    terrain_id: Number(row.terrain_id),
    cle: String(row.cle),
    label: String(row.label || row.cle),
    prix_heure: Number(row.prix_heure || 0),
    map_grille: row.map_grille === 'demi' || row.map_grille === 'entier' ? row.map_grille : null,
    ordre: Number(row.ordre || 0),
    actif: Number(row.actif) !== 0,
  };
}

function mapDureeRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    terrain_id: Number(row.terrain_id),
    minutes: Number(row.minutes),
    label: String(row.label || `${row.minutes} min`),
    ordre: Number(row.ordre || 0),
    actif: Number(row.actif) !== 0,
  };
}

function ensureDefaults(db, terrain) {
  if (!terrain?.id) return;
  const existing = queryOne(db, 'SELECT id FROM terrain_formats WHERE terrain_id = ? LIMIT 1', [terrain.id]);
  if (!existing) {
    const entier = Number(terrain.prix_entier || terrain.prix_heure || 0);
    const moitie = Number(terrain.prix_moitie || Math.round(entier * 0.6) || 0);
    runSql(
      db,
      `INSERT INTO terrain_formats (terrain_id, cle, label, prix_heure, map_grille, ordre, actif)
       VALUES (?, 'moitie', 'Demi-terrain', ?, 'demi', 0, 1)`,
      [terrain.id, moitie],
    );
    runSql(
      db,
      `INSERT INTO terrain_formats (terrain_id, cle, label, prix_heure, map_grille, ordre, actif)
       VALUES (?, 'entier', 'Terrain entier', ?, 'entier', 1, 1)`,
      [terrain.id, entier],
    );
  }
  const existingD = queryOne(db, 'SELECT id FROM terrain_durees WHERE terrain_id = ? LIMIT 1', [terrain.id]);
  if (!existingD) {
    for (const d of DEFAULT_DUREES) {
      runSql(
        db,
        `INSERT INTO terrain_durees (terrain_id, minutes, label, ordre, actif) VALUES (?, ?, ?, ?, 1)`,
        [terrain.id, d.minutes, d.label, d.ordre],
      );
    }
  }
}

function listFormats(db, terrainId, { actifsUniquement = false } = {}) {
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return [];
  ensureDefaults(db, terrain);
  const rows = queryAll(
    db,
    `SELECT * FROM terrain_formats WHERE terrain_id = ?
     ${actifsUniquement ? 'AND actif = 1' : ''}
     ORDER BY ordre ASC, id ASC`,
    [terrainId],
  );
  return rows.map(mapFormatRow);
}

function listDurees(db, terrainId, { actifsUniquement = false } = {}) {
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return [];
  ensureDefaults(db, terrain);

  // Désactive les anciennes durées > 1 h encore en base
  runSql(
    db,
    `UPDATE terrain_durees SET actif = 0
     WHERE terrain_id = ? AND minutes <> ?`,
    [terrainId, DUREE_STANDARD_MINUTES],
  );

  // Garantit la présence de la durée 1 h active
  const oneHour = queryOne(
    db,
    `SELECT id FROM terrain_durees WHERE terrain_id = ? AND minutes = ? LIMIT 1`,
    [terrainId, DUREE_STANDARD_MINUTES],
  );
  if (!oneHour) {
    runSql(
      db,
      `INSERT INTO terrain_durees (terrain_id, minutes, label, ordre, actif) VALUES (?, ?, '1h', 0, 1)`,
      [terrainId, DUREE_STANDARD_MINUTES],
    );
  } else {
    runSql(
      db,
      `UPDATE terrain_durees SET actif = 1, label = '1h' WHERE id = ?`,
      [oneHour.id],
    );
  }

  const rows = queryAll(
    db,
    `SELECT * FROM terrain_durees WHERE terrain_id = ?
       AND minutes = ?
     ${actifsUniquement ? 'AND actif = 1' : ''}
     ORDER BY ordre ASC, minutes ASC`,
    [terrainId, DUREE_STANDARD_MINUTES],
  );
  const mapped = rows.map(mapDureeRow).filter(Boolean);
  if (!mapped.length) {
    return [{ minutes: DUREE_STANDARD_MINUTES, label: '1h', ordre: 0, actif: true, terrain_id: terrainId }];
  }
  return mapped;
}

function getFormatByCle(db, terrainId, cle) {
  const formats = listFormats(db, terrainId, { actifsUniquement: true });
  const key = String(cle || '').trim();
  return formats.find((f) => f.cle === key) || null;
}

/**
 * Remplace formats + durées d'un terrain.
 * Sync prix_moitie / prix_entier si les clés classiques sont présentes.
 */
function replaceFormatsEtDurees(db, terrainId, { formats = [], durees = [] } = {}) {
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) {
    const err = new Error('Terrain introuvable');
    err.statusCode = 404;
    throw err;
  }

  const normalizedFormats = (Array.isArray(formats) ? formats : [])
    .map((f, i) => {
      const cleRaw = f.cle || f.label;
      let cle = ['moitie', 'entier'].includes(String(f.cle || ''))
        ? String(f.cle)
        : slugify(cleRaw);
      if (!cle) cle = `format_${i + 1}`;
      const mapGrille =
        f.map_grille === 'demi' || f.map_grille === 'entier'
          ? f.map_grille
          : cle === 'moitie'
            ? 'demi'
            : cle === 'entier'
              ? 'entier'
              : null;
      return {
        cle,
        label: String(f.label || cle).trim() || cle,
        prix_heure: Math.max(0, Number(f.prix_heure) || 0),
        map_grille: mapGrille,
        ordre: Number.isFinite(Number(f.ordre)) ? Number(f.ordre) : i,
        actif: f.actif === false || f.actif === 0 ? 0 : 1,
      };
    })
    .filter((f) => f.label);

  if (!normalizedFormats.length) {
    const err = new Error('Au moins un format est requis');
    err.statusCode = 400;
    throw err;
  }

  const seen = new Set();
  for (const f of normalizedFormats) {
    if (seen.has(f.cle)) {
      const err = new Error(`Format en double : ${f.cle}`);
      err.statusCode = 400;
      throw err;
    }
    seen.add(f.cle);
  }

  // Politique : seule la durée 1 h est proposée en réservation
  const normalizedDurees = [
    {
      minutes: DUREE_STANDARD_MINUTES,
      label: '1h',
      ordre: 0,
      actif: 1,
    },
  ];

  transaction(db, () => {
    runSql(db, 'DELETE FROM terrain_formats WHERE terrain_id = ?', [terrainId]);
    runSql(db, 'DELETE FROM terrain_durees WHERE terrain_id = ?', [terrainId]);

    for (const f of normalizedFormats) {
      runSql(
        db,
        `INSERT INTO terrain_formats (terrain_id, cle, label, prix_heure, map_grille, ordre, actif)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [terrainId, f.cle, f.label, f.prix_heure, f.map_grille, f.ordre, f.actif],
      );
    }
    for (const d of normalizedDurees) {
      runSql(
        db,
        `INSERT INTO terrain_durees (terrain_id, minutes, label, ordre, actif)
         VALUES (?, ?, ?, ?, ?)`,
        [terrainId, d.minutes, d.label, d.ordre, d.actif],
      );
    }

    const moitie = normalizedFormats.find((f) => f.cle === 'moitie' || f.map_grille === 'demi');
    const entier = normalizedFormats.find((f) => f.cle === 'entier' || f.map_grille === 'entier');
    if (moitie || entier) {
      const prixEntier = entier ? entier.prix_heure : Number(terrain.prix_entier || terrain.prix_heure || 0);
      const prixMoitie = moitie
        ? moitie.prix_heure
        : Number(terrain.prix_moitie || Math.round(prixEntier * 0.6));
      runSql(
        db,
        `UPDATE terrains SET prix_entier = ?, prix_heure = ?, prix_moitie = ? WHERE id = ?`,
        [prixEntier, prixEntier, prixMoitie, terrainId],
      );
    }
  });

  return {
    formats: listFormats(db, terrainId),
    durees: listDurees(db, terrainId),
  };
}

function attachFormatsToTerrainPayload(db, terrain) {
  if (!terrain?.id) return { formats: [], durees: [] };
  const formats = listFormats(db, terrain.id, { actifsUniquement: true });
  const durees = listDurees(db, terrain.id, { actifsUniquement: true });
  return { formats, durees };
}

module.exports = {
  DEFAULT_DUREES,
  DUREE_STANDARD_MINUTES,
  ensureDefaults,
  listFormats,
  listDurees,
  getFormatByCle,
  replaceFormatsEtDurees,
  attachFormatsToTerrainPayload,
  mapFormatRow,
  slugify,
};
