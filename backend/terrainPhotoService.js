const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { queryAll, queryOne } = require('./database');

const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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
  const ext = IMAGE_TYPES[mime];
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    const error = new Error('Image trop lourde. Taille maximale : 5 Mo.');
    error.statusCode = 400;
    throw error;
  }
  return { buffer, ext };
}

function listTerrainPhotos(database, terrainId) {
  return queryAll(database, `SELECT id, terrain_id, url, est_principale, ordre, created_at
    FROM terrain_photos
    WHERE terrain_id = ?
    ORDER BY est_principale DESC, ordre ASC, id ASC`, [terrainId]);
}

function syncTerrainPhotos(database, terrainId) {
  const photos = listTerrainPhotos(database, terrainId).map((photo) => photo.url);
  database.run('UPDATE terrains SET photos = ? WHERE id = ?', [JSON.stringify(photos), terrainId]);
  return photos;
}

function createTerrainPhoto(database, terrainId, { dataUrl, est_principale = false, ordre = 0 }) {
  const terrain = queryOne(database, 'SELECT id FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) {
    const error = new Error('Terrain introuvable');
    error.statusCode = 404;
    throw error;
  }
  const { buffer, ext } = parseImageDataUrl(dataUrl);
  const dir = ensureUploadDir(terrainId);
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const absolutePath = path.join(dir, filename);
  fs.writeFileSync(absolutePath, buffer);

  const publicUrl = `/uploads/terrains/${terrainId}/${filename}`;
  if (est_principale) {
    database.run('UPDATE terrain_photos SET est_principale = 0 WHERE terrain_id = ?', [terrainId]);
  }
  database.run(`INSERT INTO terrain_photos (terrain_id, url, est_principale, ordre)
    VALUES (?, ?, ?, ?)`, [terrainId, publicUrl, est_principale ? 1 : 0, Number(ordre || 0)]);
  syncTerrainPhotos(database, terrainId);
  return queryOne(database, 'SELECT * FROM terrain_photos WHERE terrain_id = ? ORDER BY id DESC LIMIT 1', [terrainId]);
}

function updateTerrainPhoto(database, terrainId, photoId, { est_principale, ordre }) {
  const photo = queryOne(database, 'SELECT * FROM terrain_photos WHERE id = ? AND terrain_id = ?', [photoId, terrainId]);
  if (!photo) {
    const error = new Error('Photo introuvable');
    error.statusCode = 404;
    throw error;
  }
  if (est_principale !== undefined && est_principale) {
    database.run('UPDATE terrain_photos SET est_principale = 0 WHERE terrain_id = ?', [terrainId]);
  }
  database.run(`UPDATE terrain_photos
    SET est_principale = COALESCE(?, est_principale), ordre = COALESCE(?, ordre)
    WHERE id = ? AND terrain_id = ?`, [
    est_principale === undefined ? null : (est_principale ? 1 : 0),
    ordre === undefined || ordre === '' ? null : Number(ordre),
    photoId,
    terrainId,
  ]);
  syncTerrainPhotos(database, terrainId);
  return queryOne(database, 'SELECT * FROM terrain_photos WHERE id = ?', [photoId]);
}

function deleteTerrainPhoto(database, terrainId, photoId) {
  const photo = queryOne(database, 'SELECT * FROM terrain_photos WHERE id = ? AND terrain_id = ?', [photoId, terrainId]);
  if (!photo) {
    const error = new Error('Photo introuvable');
    error.statusCode = 404;
    throw error;
  }
  database.run('DELETE FROM terrain_photos WHERE id = ? AND terrain_id = ?', [photoId, terrainId]);
  if (String(photo.url || '').startsWith('/uploads/')) {
    const relative = photo.url.replace(/^\/uploads\//, '');
    const absolutePath = path.join(UPLOAD_ROOT, relative);
    if (absolutePath.startsWith(UPLOAD_ROOT) && fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  }
  const remaining = listTerrainPhotos(database, terrainId);
  if (photo.est_principale && remaining.length > 0 && !remaining.some((item) => Number(item.est_principale) === 1)) {
    database.run('UPDATE terrain_photos SET est_principale = 1 WHERE id = ?', [remaining[0].id]);
  }
  syncTerrainPhotos(database, terrainId);
  return { deleted: true };
}

module.exports = {
  UPLOAD_ROOT,
  listTerrainPhotos,
  createTerrainPhoto,
  updateTerrainPhoto,
  deleteTerrainPhoto,
};
