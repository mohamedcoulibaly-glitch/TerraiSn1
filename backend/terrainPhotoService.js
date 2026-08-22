const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { queryAll, queryOne, runSql } = require('./database');

const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PHOTOS = 5;
const PHOTO_WIDTH = 1200;
const PHOTO_HEIGHT = 675;
const PHOTO_QUALITY = 82;
const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

let sharpLib = null;
try {
  sharpLib = require('sharp');
} catch {
  sharpLib = null;
}

function ensureUploadDir(terrainId) {
  const dir = path.join(UPLOAD_ROOT, 'terrains', String(terrainId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function parseImageDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) {
    const error = new Error('Image invalide. Utilisez JPG, PNG ou WEBP.');
    error.statusCode = 400;
    throw error;
  }
  const mime = match[1];
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    const error = new Error('Image trop lourde. Taille maximale : 5 Mo.');
    error.statusCode = 400;
    throw error;
  }
  return { buffer, mime };
}

async function compressToWebp(buffer) {
  let origWidth = null;
  let origHeight = null;
  if (sharpLib) {
    try {
      const meta = await sharpLib(buffer).rotate().metadata();
      origWidth = meta.width || null;
      origHeight = meta.height || null;
    } catch {
      /* ignore */
    }
    const out = await sharpLib(buffer)
      .rotate()
      .resize(PHOTO_WIDTH, PHOTO_HEIGHT, { fit: 'cover' })
      .webp({ quality: PHOTO_QUALITY })
      .toBuffer();
    return {
      buffer: out,
      ext: 'webp',
      origWidth,
      origHeight,
      width: PHOTO_WIDTH,
      height: PHOTO_HEIGHT,
    };
  }
  return { buffer, ext: 'bin', origWidth, origHeight, width: origWidth, height: origHeight };
}

async function listTerrainPhotos(database, terrainId) {
  return await queryAll(database, `SELECT * FROM terrain_photos
    WHERE terrain_id = ?
    ORDER BY ordre ASC, id ASC`, [terrainId]);
}

async function listPhotosByTerrainIds(database, terrainIds) {
  const ids = (terrainIds || []).map(Number).filter((n) => n > 0);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return await queryAll(
    database,
    `SELECT * FROM terrain_photos
     WHERE terrain_id IN (${placeholders})
     ORDER BY ordre ASC, id ASC`,
    ids,
  );
}

async function syncTerrainPhotos(database, terrainId) {
  const photos = (await listTerrainPhotos(database, terrainId)).map((photo) => photo.url);
  await runSql(database, 'UPDATE terrains SET photos = ? WHERE id = ?', [JSON.stringify(photos), terrainId]);
  return photos;
}

async function assertTerrain(database, terrainId) {
  const terrain = await queryOne(database, 'SELECT id FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) {
    const error = new Error('Terrain introuvable');
    error.statusCode = 404;
    throw error;
  }
  return terrain;
}

async function assertCapacity(database, terrainId, incoming = 1) {
  const count = Number((await queryOne(database, 'SELECT COUNT(*) AS n FROM terrain_photos WHERE terrain_id = ?', [terrainId]))?.n || 0);
  if (count + incoming > MAX_PHOTOS) {
    const error = new Error('Maximum 5 photos atteint');
    error.statusCode = 400;
    throw error;
  }
}

async function nextOrdre(database, terrainId) {
  const row = await queryOne(database, 'SELECT COALESCE(MAX(ordre), -1) AS max_ordre FROM terrain_photos WHERE terrain_id = ?', [terrainId]);
  return Number(row?.max_ordre ?? -1) + 1;
}

async function hasPrincipale(database, terrainId) {
  return Boolean(await queryOne(database, 'SELECT id FROM terrain_photos WHERE terrain_id = ? AND est_principale = 1 LIMIT 1', [terrainId]));
}

async function persistPhotoBuffer(database, terrainId, {
  buffer, nomFichier, est_principale = false, ordre, uploaded_by = null, uploaded_by_role = null,
}) {
  await assertTerrain(database, terrainId);
  await assertCapacity(database, terrainId, 1);
  const compressedMeta = await compressToWebp(buffer);
  const { buffer: compressed, ext, width, height, origWidth, origHeight } = compressedMeta;
  const dir = ensureUploadDir(terrainId);
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext === 'bin' ? 'jpg' : ext}`;
  const absolutePath = path.join(dir, filename);
  fs.writeFileSync(absolutePath, compressed);

  const publicUrl = `/uploads/terrains/${terrainId}/${filename}`;
  const makePrincipale = est_principale || !(await hasPrincipale(database, terrainId));
  if (makePrincipale) {
    await runSql(database, 'UPDATE terrain_photos SET est_principale = 0 WHERE terrain_id = ?', [terrainId]);
  }
  const ordreVal = ordre === undefined || ordre === '' || ordre === null ? await nextOrdre(database, terrainId) : Number(ordre);
  const ratio = width && height ? (width / height).toFixed(4) : null;
  const role = uploaded_by_role === 'gerant' ? 'gerant' : (uploaded_by_role ? 'super_admin' : null);
  await runSql(
    database,
    `INSERT INTO terrain_photos (terrain_id, url, nom_fichier, taille_octets, est_principale, ordre, uploaded_at,
      uploaded_by, uploaded_by_role, valide, largeur_px, hauteur_px, ratio)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, 1, ?, ?, ?)`,
    [terrainId, publicUrl, nomFichier || filename, compressed.length, makePrincipale ? 1 : 0, ordreVal,
      uploaded_by || null, role, width || null, height || null, ratio],
  );
  await syncTerrainPhotos(database, terrainId);
  const row = await queryOne(database, 'SELECT * FROM terrain_photos WHERE terrain_id = ? ORDER BY id DESC LIMIT 1', [terrainId]);
  return { ...row, origWidth, origHeight };
}

async function createTerrainPhoto(database, terrainId, payload = {}) {
  if (payload.buffer) {
    const mime = String(payload.mimetype || payload.mime || '');
    if (mime && !IMAGE_TYPES[mime]) {
      const error = new Error('Image invalide. Utilisez JPG, PNG ou WEBP.');
      error.statusCode = 400;
      throw error;
    }
    if (!payload.buffer.length || payload.buffer.length > MAX_IMAGE_BYTES) {
      const error = new Error('Image trop lourde. Taille maximale : 5 Mo.');
      error.statusCode = 400;
      throw error;
    }
    return persistPhotoBuffer(database, terrainId, {
      buffer: payload.buffer,
      nomFichier: payload.originalname || payload.nom_fichier,
      est_principale: payload.est_principale,
      ordre: payload.ordre,
      uploaded_by: payload.uploaded_by,
      uploaded_by_role: payload.uploaded_by_role,
    });
  }
  const { buffer } = parseImageDataUrl(payload.dataUrl);
  return persistPhotoBuffer(database, terrainId, {
    buffer,
    nomFichier: payload.nom_fichier,
    est_principale: payload.est_principale,
    ordre: payload.ordre,
    uploaded_by: payload.uploaded_by,
    uploaded_by_role: payload.uploaded_by_role,
  });
}

async function updateTerrainPhoto(database, terrainId, photoId, { est_principale, ordre }) {
  const photo = await queryOne(database, 'SELECT * FROM terrain_photos WHERE id = ? AND terrain_id = ?', [photoId, terrainId]);
  if (!photo) {
    const error = new Error('Photo introuvable');
    error.statusCode = 404;
    throw error;
  }
  if (est_principale !== undefined && est_principale) {
    await runSql(database, 'UPDATE terrain_photos SET est_principale = 0 WHERE terrain_id = ?', [terrainId]);
  }
  await runSql(database, `UPDATE terrain_photos
    SET est_principale = COALESCE(?, est_principale), ordre = COALESCE(?, ordre)
    WHERE id = ? AND terrain_id = ?`, [
    est_principale === undefined ? null : (est_principale ? 1 : 0),
    ordre === undefined || ordre === '' ? null : Number(ordre),
    photoId,
    terrainId,
  ]);
  await syncTerrainPhotos(database, terrainId);
  return await queryOne(database, 'SELECT * FROM terrain_photos WHERE id = ?', [photoId]);
}

async function setPhotoPrincipale(database, terrainId, photoId) {
  return updateTerrainPhoto(database, terrainId, photoId, { est_principale: true });
}

async function reorderTerrainPhotos(database, terrainId, ids) {
  await assertTerrain(database, terrainId);
  const list = Array.isArray(ids) ? ids.map(Number).filter((n) => n > 0) : [];
  const existing = await listTerrainPhotos(database, terrainId);
  if (!list.length || list.length !== existing.length || list.some((id) => !existing.some((p) => Number(p.id) === id))) {
    const error = new Error('Ordre de photos invalide');
    error.statusCode = 400;
    throw error;
  }
  for (let index = 0; index < list.length; index += 1) {
    const id = list[index];
    await runSql(database, 'UPDATE terrain_photos SET ordre = ? WHERE id = ? AND terrain_id = ?', [index, id, terrainId]);
  }
  await syncTerrainPhotos(database, terrainId);
  return listTerrainPhotos(database, terrainId);
}

async function deleteTerrainPhoto(database, terrainId, photoId, { asGerant = false } = {}) {
  const photo = await queryOne(database, 'SELECT * FROM terrain_photos WHERE id = ? AND terrain_id = ?', [photoId, terrainId]);
  if (!photo) {
    const error = new Error('Photo introuvable');
    error.statusCode = 404;
    throw error;
  }
  if (asGerant && photo.uploaded_by_role === 'super_admin') {
    const error = new Error("Les photos ajoutées par l'administration ne peuvent pas être supprimées");
    error.statusCode = 403;
    throw error;
  }
  const remainingBefore = await listTerrainPhotos(database, terrainId);
  if (asGerant && remainingBefore.length <= 1) {
    const error = new Error('Impossible de supprimer la seule photo du terrain');
    error.statusCode = 400;
    throw error;
  }
  await runSql(database, 'DELETE FROM terrain_photos WHERE id = ? AND terrain_id = ?', [photoId, terrainId]);
  if (String(photo.url || '').startsWith('/uploads/')) {
    const relative = photo.url.replace(/^\/uploads\//, '');
    const absolutePath = path.join(UPLOAD_ROOT, relative);
    if (absolutePath.startsWith(UPLOAD_ROOT) && fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  }
  const remaining = await listTerrainPhotos(database, terrainId);
  if (photo.est_principale && remaining.length > 0 && !remaining.some((item) => Number(item.est_principale) === 1)) {
    await runSql(database, 'UPDATE terrain_photos SET est_principale = 1 WHERE id = ?', [remaining[0].id]);
  }
  await syncTerrainPhotos(database, terrainId);
  return { deleted: true, photo };
}

async function terrainAUnePhotoPrincipale(database, terrainId) {
  return hasPrincipale(database, terrainId);
}

module.exports = {
  UPLOAD_ROOT,
  MAX_PHOTOS,
  listTerrainPhotos,
  listPhotosByTerrainIds,
  createTerrainPhoto,
  updateTerrainPhoto,
  setPhotoPrincipale,
  reorderTerrainPhotos,
  deleteTerrainPhoto,
  terrainAUnePhotoPrincipale,
};
