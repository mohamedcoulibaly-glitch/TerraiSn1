const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { UPLOAD_ROOT } = require('./terrainPhotoService');

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function parseImageDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) {
    const error = new Error('Photo invalide. Utilisez JPG, PNG ou WEBP.');
    error.statusCode = 400;
    throw error;
  }

  const mime = match[1];
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    const error = new Error('Photo trop lourde. Taille maximale : 3 Mo.');
    error.statusCode = 400;
    throw error;
  }

  return { buffer, ext: IMAGE_TYPES[mime] };
}

function saveProfilePhoto(accountType, accountId, dataUrl) {
  const safeType = ['user', 'proprietaire', 'employe'].includes(accountType) ? accountType : 'user';
  const { buffer, ext } = parseImageDataUrl(dataUrl);
  const dir = path.join(UPLOAD_ROOT, 'profiles', safeType, String(accountId));
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const absolutePath = path.join(dir, filename);
  fs.writeFileSync(absolutePath, buffer);

  return `/uploads/profiles/${safeType}/${accountId}/${filename}`;
}

module.exports = {
  saveProfilePhoto,
};
