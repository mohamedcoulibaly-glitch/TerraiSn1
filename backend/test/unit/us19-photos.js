const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = path.join(os.tmpdir(), `us19-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;
process.env.UPLOAD_ROOT = path.join(os.tmpdir(), `us19-up-${process.pid}`);

const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde, queryOne } = require('../helpers/fixtureDb');
const photo = require('../../terrainPhotoService');

const h = createHarness('us19');

function dataUrl(mime, buffer) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  photo._setHeicConverter(() => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const jpeg = photo.createTerrainPhoto(db, monde.terrainAvance, {
    dataUrl: dataUrl('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
  });
  h.assert('jpeg url', String(jpeg.url).endsWith('.jpg'));

  const png = photo.createTerrainPhoto(db, monde.terrainAvance, {
    dataUrl: dataUrl('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  });
  h.assert('png url', String(png.url).endsWith('.png'));

  const webp = photo.createTerrainPhoto(db, monde.terrainAvance, {
    dataUrl: dataUrl('image/webp', Buffer.from('RIFF')),
  });
  h.assert('webp url', String(webp.url).endsWith('.webp'));

  const heic = photo.createTerrainPhoto(db, monde.terrainAvance, {
    dataUrl: dataUrl('image/heic', Buffer.from('heic-bytes')),
  });
  h.assert('heic converti jpg', String(heic.url).endsWith('.jpg'));

  const gif = photo.createTerrainPhoto(db, monde.terrainAvance, {
    dataUrl: dataUrl('image/gif', Buffer.from('GIF89a')),
  });
  h.assert('gif accepté', String(gif.url).endsWith('.gif'));

  h.assertThrows('pdf refusé', () => photo.parseImageDataUrl('data:application/pdf;base64,JVBERi0='), 'Image invalide');

  const big = Buffer.alloc(photo.MAX_IMAGE_BYTES + 1, 1);
  h.assertThrows('trop lourd', () => photo.parseImageDataUrl(dataUrl('image/jpeg', big)), '5 Mo');

  let missing = false;
  try {
    photo.createTerrainPhoto(db, 99999, { dataUrl: dataUrl('image/jpeg', Buffer.from([0xff, 0xd8])) });
  } catch (error) {
    missing = error.statusCode === 404;
  }
  h.assert('terrain inconnu', missing);

  const listed = photo.listTerrainPhotos(db, monde.terrainAvance);
  h.assert('photos listées', listed.length >= 4);
  const terrain = queryOne(db, 'SELECT photos FROM terrains WHERE id = ?', [monde.terrainAvance]);
  h.assert('sync json', String(terrain.photos).includes('/uploads/'));

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  h.exitIfFailed();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
