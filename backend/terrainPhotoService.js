const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { queryAll, queryOne } = require('./database');

const UPLOAD_ROOT = process.env.UPLOAD_ROOT
  ? path.resolve(process.env.UPLOAD_ROOT)
  : path.join(__dirname, 'uploads');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

let heicConverter = defaultHeicConverter;

function defaultHeicConverter() {
  const error = new Error('Conversion HEIC indisponible sur ce serveur. Envoyez un JPEG, PNG ou WebP.');
  error.statusCode = 400;
  throw error;
}

function _setHeicConverter(fn) {
  heicConverter = typeof fn === 'function' ? fn : defaultHeicConverter;
}

function isHeic(mime) {
  return mime === 'image/heic' || mime === 'image/heif';
}

function ensureUploadDir(terrainId) {
  const dir = path.join(UPLOAD_ROOT, 'terrains', String(terrainId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extensionFromMime(mime) {
  if (IMAGE_TYPES[mime]) return IMAGE_TYPES[mime];
  const sub = String(mime.split('/')[1] || 'img').toLowerCase();
  const clean = sub.replace(/[^a-z0-9]/g, '').slice(0, 8);
  return clean || 'img';
}

function parseImageDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) {
    const error = new Error('Image invalide. Envoyez une image de 5 Mo maximum.');
    error.statusCode = 400;
    throw error;
  }
  const mime = match[1].toLowerCase();
  let buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length) {
    const error = new Error('Image invalide. Fichier vide.');
    error.statusCode = 400;
    throw error;
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    const error = new Error('Image trop lourde. Taille maximale : 5 Mo.');
    error.statusCode = 400;
    throw error;
  }
  let ext = extensionFromMime(mime);
  if (isHeic(mime)) {
    try {
      const jpeg = heicConverter(buffer);
      const out = Buffer.isBuffer(jpeg) ? jpeg : Buffer.from(jpeg);
      if (!out.length) {
        const error = new Error('Conversion HEIC impossible. Envoyez un JPEG, PNG ou WebP.');
        error.statusCode = 400;
        throw error;
      }
      if (out.length > MAX_IMAGE_BYTES) {
        const error = new Error('Image trop lourde après conversion. Taille maximale : 5 Mo.');
        error.statusCode = 400;
        throw error;
      }
      buffer = out;
      ext = 'jpg';
    } catch (err) {
      if (err && err.statusCode === 400) throw err;
      const error = new Error('Conversion HEIC indisponible sur ce serveur. Envoyez un JPEG, PNG ou WebP.');
      error.statusCode = 400;
      throw error;
    }
  }
  return { buffer, ext };
}

function listTerrainPhotos(database, terrainId) {
  return queryAll(database, `SELECT id, terrain_id, url, est_principale, ordre, created_at
    FROM terrain_photos
    WHERE terrain_id = ?
    ORDER BY est_principale DESC, ordre ASC, id ASC`, [terrainId]);
}

function listPhotosByTerrainIds(database, terrainIds) {
  const ids = (terrainIds || []).map(Number).filter((n) => n > 0);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return queryAll(
    database,
    `SELECT id, terrain_id, url, est_principale, ordre, created_at
     FROM terrain_photos
     WHERE terrain_id IN (${placeholders})
     ORDER BY est_principale DESC, ordre ASC, id ASC`,
    ids,
  );
}

function syncTerrainPhotos(database, terrainId) {
  const photos = listTerrainPhotos(database, terrainId).map((photo) => photo.url);
  database.run('UPDATE terrains SET photos = ? WHERE id = ?', [JSON.stringify(photos), terrainId]);
  return photos;
}

function fileToDataUrl(buffer, mimetype, filename) {
  if (!buffer || !Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    const error = new Error('Image invalide. Envoyez une image de 5 Mo maximum.');
    error.statusCode = 400;
    throw error;
  }
  let mime = String(mimetype || '').toLowerCase();
  if (!mime.startsWith('image/')) {
    const ext = String(filename || '').split('.').pop().toLowerCase();
    const byExt = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
      gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
      heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', jfif: 'image/jpeg',
    };
    mime = byExt[ext] || 'image/jpeg';
  }
  return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
}

function createTerrainPhoto(database, terrainId, input = {}) {
  const { est_principale = false, ordre = 0 } = input;
  const dataUrl = input.dataUrl || fileToDataUrl(input.buffer, input.mimetype, input.originalname);
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

function terrainAUnePhotoPrincipale(database, terrainId) {
  return Boolean(queryOne(
    database,
    'SELECT id FROM terrain_photos WHERE terrain_id = ? AND est_principale = 1 LIMIT 1',
    [terrainId],
  ));
}

function setPhotoPrincipale(database, terrainId, photoId) {
  const photo = queryOne(
    database,
    'SELECT id FROM terrain_photos WHERE id = ? AND terrain_id = ?',
    [photoId, terrainId],
  );
  if (!photo) {
    const error = new Error('Photo introuvable');
    error.statusCode = 404;
    throw error;
  }
  database.run('UPDATE terrain_photos SET est_principale = 0 WHERE terrain_id = ?', [terrainId]);
  database.run('UPDATE terrain_photos SET est_principale = 1 WHERE id = ?', [photoId]);
  syncTerrainPhotos(database, terrainId);
  return queryOne(database, 'SELECT * FROM terrain_photos WHERE id = ?', [photoId]);
}

function reorderTerrainPhotos(database, terrainId, ordre) {
  const ids = Array.isArray(ordre) ? ordre.map(Number) : [];
  ids.forEach((id, index) => {
    database.run(
      'UPDATE terrain_photos SET ordre = ? WHERE id = ? AND terrain_id = ?',
      [index, id, terrainId],
    );
  });
  return listTerrainPhotos(database, terrainId);
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
  MAX_IMAGE_BYTES,
  listTerrainPhotos,
  listPhotosByTerrainIds,
  createTerrainPhoto,
  updateTerrainPhoto,
  deleteTerrainPhoto,
  terrainAUnePhotoPrincipale,
  setPhotoPrincipale,
  reorderTerrainPhotos,
  parseImageDataUrl,
  _setHeicConverter,
};
