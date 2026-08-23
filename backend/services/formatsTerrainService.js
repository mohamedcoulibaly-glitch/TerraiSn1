const { queryAll, queryOne, runSql, transaction } = require('../database');

const DEFAULT_DUREES = [
  { minutes: 60, label: '1h', ordre: 0 },
  { minutes: 90, label: '1h30', ordre: 1 },
  { minutes: 120, label: '2h', ordre: 2 },
  { minutes: 180, label: '3h', ordre: 3 },
];

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

async function ensureDefaults(db, terrain) {
  if (!terrain?.id) return;
  const existing = await queryOne(db, 'SELECT id FROM terrain_formats WHERE terrain_id = ? LIMIT 1', [terrain.id]);
  if (!existing) {
    const entier = Number(terrain.prix_entier || terrain.prix_heure || 0);
    const moitie = Number(terrain.prix_moitie || Math.round(entier * 0.6) || 0);
    await runSql(
      db,
      `INSERT INTO terrain_formats (terrain_id, cle, label, prix_heure, map_grille, ordre, actif)
       VALUES (?, 'moitie', 'Demi-terrain', ?, 'demi', 0, 1)`,
      [terrain.id, moitie],
    );
    await runSql(
      db,
      `INSERT INTO terrain_formats (terrain_id, cle, label, prix_heure, map_grille, ordre, actif)
       VALUES (?, 'entier', 'Terrain entier', ?, 'entier', 1, 1)`,
      [terrain.id, entier],
    );
  }
  const existingD = await queryOne(db, 'SELECT id FROM terrain_durees WHERE terrain_id = ? LIMIT 1', [terrain.id]);
  if (!existingD) {
    for (const d of DEFAULT_DUREES) {
      await runSql(
        db,
        `INSERT INTO terrain_durees (terrain_id, minutes, label, ordre, actif) VALUES (?, ?, ?, ?, 1)`,
        [terrain.id, d.minutes, d.label, d.ordre],
      );
    }
  }
}

async function listFormats(db, terrainId, { actifsUniquement = false } = {}) {
  const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return [];
  await ensureDefaults(db, terrain);
  const rows = await queryAll(
    db,
    `SELECT * FROM terrain_formats WHERE terrain_id = ?
     ${actifsUniquement ? 'AND actif = 1' : ''}
     ORDER BY ordre ASC, id ASC`,
    [terrainId],
  );
  return rows.map(mapFormatRow);
}

async function listDurees(db, terrainId, { actifsUniquement = false } = {}) {
  const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return [];
  await ensureDefaults(db, terrain);
  const rows = await queryAll(
    db,
    `SELECT * FROM terrain_durees WHERE terrain_id = ?
     ${actifsUniquement ? 'AND actif = 1' : ''}
     ORDER BY ordre ASC, minutes ASC`,
    [terrainId],
  );
  return rows.map(mapDureeRow);
}

async function getFormatByCle(db, terrainId, cle) {
  const formats = await listFormats(db, terrainId, { actifsUniquement: true });
  const key = String(cle || '').trim();
  return formats.find((f) => f.cle === key) || null;
}

/**
 * Remplace formats + durées d'un terrain.
 * Sync prix_moitie / prix_entier si les clés classiques sont présentes.
 */
async function replaceFormatsEtDurees(db, terrainId, { formats = [], durees = [] } = {}) {
  const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
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

  const normalizedDurees = (Array.isArray(durees) ? durees : [])
    .map((d, i) => {
      const minutes = Math.round(Number(d.minutes) || 0);
      if (!(minutes > 0) || minutes > 12 * 60) return null;
      return {
        minutes,
        label: String(d.label || `${minutes} min`).trim(),
        ordre: Number.isFinite(Number(d.ordre)) ? Number(d.ordre) : i,
        actif: d.actif === false || d.actif === 0 ? 0 : 1,
      };
    })
    .filter(Boolean);

  if (!normalizedDurees.length) {
    const err = new Error('Au moins une durée est requise');
    err.statusCode = 400;
    throw err;
  }

  await transaction(db, async () => {
    await runSql(db, 'DELETE FROM terrain_formats WHERE terrain_id = ?', [terrainId]);
    await runSql(db, 'DELETE FROM terrain_durees WHERE terrain_id = ?', [terrainId]);

    for (const f of normalizedFormats) {
      await runSql(
        db,
        `INSERT INTO terrain_formats (terrain_id, cle, label, prix_heure, map_grille, ordre, actif)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [terrainId, f.cle, f.label, f.prix_heure, f.map_grille, f.ordre, f.actif],
      );
    }
    for (const d of normalizedDurees) {
      await runSql(
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
      await runSql(
        db,
        `UPDATE terrains SET prix_entier = ?, prix_heure = ?, prix_moitie = ? WHERE id = ?`,
        [prixEntier, prixEntier, prixMoitie, terrainId],
      );
    }
  });

  return {
    formats: await listFormats(db, terrainId),
    durees: await listDurees(db, terrainId),
  };
}

async function attachFormatsToTerrainPayload(db, terrain) {
  if (!terrain?.id) return { formats: [], durees: [] };
  const [formats, durees] = await Promise.all([
    listFormats(db, terrain.id, { actifsUniquement: true }),
    listDurees(db, terrain.id, { actifsUniquement: true }),
  ]);
  return { formats, durees };
}

module.exports = {
  DEFAULT_DUREES,
  ensureDefaults,
  listFormats,
  listDurees,
  getFormatByCle,
  replaceFormatsEtDurees,
  attachFormatsToTerrainPayload,
  mapFormatRow,
  slugify,
};
