/**
 * Test d'envoi des QR codes de réservation par WhatsApp (OpenWA).
 *
 * Vérifie côté backend, pour 2 réservations distinctes :
 *   1. code_reservation unique en base (aucun doublon) ;
 *   2. payload QR signé (HMAC) bien associé à (reservation_id, code, terrain) ;
 *   3. fichier PNG présent/régénéré, différent d'une réservation à l'autre ;
 * puis envoie au numéro cible, DEPUIS la session demandée :
 *   - un texte d'introduction par réservation,
 *   - l'image QR native ; si le moteur média OpenWA la refuse
 *     (502 SEND_FAILED connu), repli automatique : texte + lien public
 *     de l'image (jamais de marqueur technique « [IMAGE_QR] … »).
 *
 * Usage :
 *   node scripts/test-qr-whatsapp.js [--to 778261225] [--from gerant:1]
 *                                   [--ids 12,34 | --codes TF-123456,TF-654321]
 *                                   [--check-only]
 * Défauts : --to $WHATSAPP_TEST_NUMBER (778261225), --from gerant:1,
 *           2 dernières réservations confirmées avec code.
 */
require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
const hasFlag = (flag) => process.argv.includes(flag);

const TO = argValue('--to') || process.env.WHATSAPP_TEST_NUMBER || '778261225';
const FROM = argValue('--from') || 'gerant:1';
const CHECK_ONLY = hasFlag('--check-only');

async function main() {
  if (!process.env.OPENWA_API_KEY) throw new Error('OPENWA_API_KEY manquant dans backend/.env');

  const { getDb, queryOne, queryAll } = require('../database');
  const notificationService = require('../notificationService');
  const whatsappClient = require('../whatsappClient');
  const { verifyQrPayload } = require('../domain/qrSignature');
  const { UPLOAD_ROOT } = require('../terrainPhotoService');

  const db = await getDb();

  // --- Sélection de 2 réservations -------------------------------------
  let rows = [];
  const codesArg = argValue('--codes');
  const idsArg = argValue('--ids');
  if (codesArg) {
    rows = codesArg.split(',').map((c) => c.trim()).filter(Boolean)
      .map((code) => queryOne(db, 'SELECT * FROM reservations WHERE code_reservation = ? LIMIT 1', [code]))
      .filter(Boolean);
  } else if (idsArg) {
    rows = idsArg.split(',').map((s) => Number(s)).filter(Boolean)
      .map((id) => queryOne(db, 'SELECT * FROM reservations WHERE id = ? LIMIT 1', [id]))
      .filter(Boolean);
  } else {
    rows = queryAll(db, `SELECT * FROM reservations
      WHERE code_reservation IS NOT NULL AND code_reservation != ''
      ORDER BY CASE WHEN statut = 'confirme' THEN 0 ELSE 1 END, id DESC
      LIMIT 2`);
  }
  if (rows.length < 2) {
    throw new Error(`Il faut 2 réservations avec code pour tester l'unicité (trouvé : ${rows.length})`);
  }
  rows = rows.slice(0, 2);

  // --- Vérifications backend --------------------------------------------
  const problemes = [];
  const doublons = queryAll(db, `SELECT code_reservation, COUNT(*) AS n FROM reservations
    WHERE code_reservation IS NOT NULL GROUP BY code_reservation HAVING n > 1 LIMIT 5`);
  if (doublons.length) problemes.push(`codes en double en base : ${JSON.stringify(doublons)}`);

  const empreintes = new Set();
  const detailsTest = [];
  for (const row of rows) {
    const qrUrl = await notificationService.assurerQrCodeUrl(row.id);
    const apres = queryOne(db, 'SELECT code_reservation, qr_code_url, qr_code_payload FROM reservations WHERE id = ?', [row.id]);
    const relative = String(qrUrl || '').replace(/^\/uploads\//, '');
    const fichier = path.join(UPLOAD_ROOT, relative);
    const existe = Boolean(qrUrl) && fs.existsSync(fichier) && fs.statSync(fichier).size > 0;
    const empreinte = existe ? crypto.createHash('sha256').update(fs.readFileSync(fichier)).digest('hex').slice(0, 16) : null;
    const verif = apres?.qr_code_payload ? verifyQrPayload(apres.qr_code_payload) : { ok: false };
    const associe = Boolean(verif.ok
      && verif.reservation_id === Number(row.id)
      && verif.code === String(apres.code_reservation).toUpperCase()
      && verif.terrain_id === Number(row.terrain_id));
    if (!existe) problemes.push(`résa #${row.id} (${apres?.code_reservation}) : PNG QR absent`);
    if (!associe) problemes.push(`résa #${row.id} (${apres?.code_reservation}) : payload QR non signé ou mal associé`);
    if (empreinte && empreintes.has(empreinte)) problemes.push(`résa #${row.id} : PNG identique à une autre réservation`);
    if (empreinte) empreintes.add(empreinte);
    detailsTest.push({
      id: row.id,
      code: apres?.code_reservation,
      qrUrl,
      fichier: existe ? path.basename(fichier) : null,
      empreinte,
      payloadAssocie: associe,
      lienPublic: notificationService.qrImagePublicUrl(qrUrl),
    });
  }
  const codesDistincts = new Set(detailsTest.map((d) => d.code)).size === detailsTest.length;
  if (!codesDistincts) problemes.push('les 2 réservations de test partagent le même code');

  console.log('— Vérification backend QR —');
  for (const d of detailsTest) {
    console.log(`  résa #${d.id} code=${d.code} fichier=${d.fichier} sha256=${d.empreinte} payload_associé=${d.payloadAssocie ? 'OUI' : 'NON'}`);
    console.log(`    lien public : ${d.lienPublic}`);
  }
  console.log(`  codes distincts : ${codesDistincts ? 'OUI' : 'NON'} | doublons en base : ${doublons.length}`);
  if (problemes.length) throw new Error(`Vérification QR en échec : ${problemes.join(' ; ')}`);
  console.log('✅ Backend OK : QR uniques, signés et associés à leur réservation.');

  if (CHECK_ONLY) return;

  // --- Envoi WhatsApp réel ----------------------------------------------
  const statut = await whatsappClient.getStatus(FROM);
  console.log(`Session émettrice « ${FROM} » : connected=${statut.connected} phone=${statut.phone || '?'}`);
  if (!statut.connected) throw new Error(`Session ${FROM} non connectée sur OpenWA — envoi impossible`);

  const chatId = notificationService.formatNumero(TO);
  console.log(`Destinataire : ${TO} → ${chatId}`);

  await whatsappClient.sendTextForSession(FROM, chatId,
    `🔎 *TerrainSN — test QR code*\nTu vas recevoir ${detailsTest.length} QR de test (codes différents). `
    + 'Chaque image ou lien doit correspondre au code annoncé juste avant.');

  const resultats = [];
  for (const [index, d] of detailsTest.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await whatsappClient.sendTextForSession(FROM, chatId,
      `Test ${index + 1}/${detailsTest.length} — réservation #${d.id}, code *${d.code}* : le QR qui suit doit porter ce code.`);
    // eslint-disable-next-line no-await-in-loop
    const res = await notificationService.envoyerQrCodeWhatsApp({
      telephone: TO,
      sessionKey: FROM,
      codeReservation: d.code,
      qrUrl: d.qrUrl,
      reservationId: d.id,
    });
    console.log(`  [${d.code}] mode=${res.mode} ok=${Boolean(res.ok)}${res.messageId ? ` messageId=${res.messageId}` : ''}`);
    resultats.push({ code: d.code, ...res });
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 1500));
  }

  const images = resultats.filter((r) => r.mode === 'image').length;
  const liens = resultats.filter((r) => r.mode === 'lien').length;
  console.log(`Résultat : ${images} image(s) native(s), ${liens} repli(s) lien, ${resultats.length - images - liens} échec(s).`);
  if (images === 0 && liens > 0) {
    console.log('ℹ️ Le moteur média OpenWA a refusé les images (502 SEND_FAILED) : repli lien appliqué, aucun texte technique envoyé.');
  }
  if (resultats.some((r) => !r.ok)) process.exitCode = 2;
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((err) => {
    console.error('❌', err.message || err);
    process.exit(1);
  });
