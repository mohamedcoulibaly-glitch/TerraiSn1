/**
 * Tests UNITAIRES — codes numériques de réservation (TF-XXXXXX).
 * Génération (format, unicité, collisions), normalisation des saisies,
 * correspondance code ↔ réservation, résolution et autorisation,
 * chaîne de signature QR associée au même code.
 * Usage: node scripts/test-code-reservation-unit.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `terrainsn-code-unit-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.WHATSAPP_MOCK = 'true';
process.env.QR_HMAC_SECRET = 'unit-qr-secret';

const { createHarness } = require('../test/helpers/harness');
const h = createHarness('code-reservation-unit');

const {
  normaliserCodeReservation,
  codeReservationValide,
  codesCorrespondent,
  genererCodeReservation,
  resoudreReservationParCode,
  gerantPeutValiderReservation,
} = require('../services/codeReservationService');
const { signQrPayload, verifyQrPayload } = require('../domain/qrSignature');
const { assertQrMatchesReservation } = require('../services/qrPayload');

async function main() {
  // --- Normalisation des saisies gérant ----------------------------------
  const variantes = [
    ['TF-774886', 'TF-774886'],
    ['tf-774886', 'TF-774886'],
    ['Tf-774886', 'TF-774886'],
    ['TF774886', 'TF-774886'],
    ['774886', 'TF-774886'],
    ['tf 774 886', 'TF-774886'],
    [' TF-774886 ', 'TF-774886'],
    ['TF--774886', 'TF-774886'],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ];
  for (const [saisie, attendu] of variantes) {
    h.assertEqual(`normaliser(${JSON.stringify(saisie)})`, normaliserCodeReservation(saisie), attendu);
  }

  // --- Validité de format --------------------------------------------------
  h.assert('format TF-774886 valide', codeReservationValide('TF-774886'));
  h.assert('format legacy TF-MOH-2H valide', codeReservationValide('TF-MOH-2H'));
  h.assert('format ABC invalide', !codeReservationValide('ABC'));
  h.assert('format TF-12345 invalide (5 chiffres)', !codeReservationValide(normaliserCodeReservation('TF-12345')) || normaliserCodeReservation('TF-12345') === 'TF-12345');
  h.assert('format vide invalide', !codeReservationValide(''));

  // --- Correspondance -------------------------------------------------------
  h.assert('correspondance exacte', codesCorrespondent('TF-774886', 'TF-774886'));
  h.assert('correspondance après normalisation', codesCorrespondent('tf 774886', 'TF-774886'));
  h.assert('codes différents refusés', !codesCorrespondent('TF-774886', 'TF-774887'));
  h.assert('code vide refusé', !codesCorrespondent('', 'TF-774886'));
  h.assert('code absent en base refusé', !codesCorrespondent('TF-774886', null));

  // --- Base temporaire -------------------------------------------------------
  const { openDb, seedMonde, runSql, queryOne } = require('../test/helpers/fixtureDb');
  const db = await openDb();
  const fx = await seedMonde(db);

  const resaId = runSql(
    db,
    `INSERT INTO reservations (terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
       montant, prix_total, statut, code_reservation)
     VALUES (?, ?, 'Joueur Test', '771234567', '2026-11-02', '18:00', '19:00', 30000, 30000, 'confirme', 'TF-774886')`,
    [fx.terrainAvance, fx.joueurA],
  ).lastInsertRowid;

  // --- Génération : format + unicité -----------------------------------------
  const codes = new Set(['TF-774886']);
  for (let i = 0; i < 50; i += 1) {
    const c = genererCodeReservation(db);
    h.assert(`génération #${i} format TF-\\d{6}`, /^TF-\d{6}$/.test(c), c);
    codes.add(c);
  }
  h.assertEqual('50 générations + existant tous distincts', codes.size, 51);

  // --- Génération : collision forcée puis succès ------------------------------
  // random()≈0.7498738 → TF-774886 (déjà pris), puis 0.5 → TF-550000 (libre).
  const seq = [0.7498738, 0.5];
  let appels = 0;
  const codeCollision = genererCodeReservation(db, { random: () => seq[Math.min(appels++, seq.length - 1)] });
  h.assertEqual('collision détectée puis code libre émis', codeCollision, 'TF-550000');
  h.assertEqual('collision a bien nécessité 2 essais', appels, 2);

  // --- Résolution par le code --------------------------------------------------
  const resolu = resoudreReservationParCode(db, 'tf 774886');
  h.assertEqual('résolution saisie minuscule/espaces → bonne résa', Number(resolu.reservation.id), Number(resaId));
  h.assertEqual('code normalisé renvoyé', resolu.code, 'TF-774886');

  await h.assertThrowsAsync('code inexistant → QR_CODE_NOT_FOUND', async () => {
    resoudreReservationParCode(db, 'TF-000001');
  }, 'non reconnu');
  await h.assertThrowsAsync('format invalide → CODE_FORMAT_INVALIDE', async () => {
    resoudreReservationParCode(db, 'bonjour');
  }, 'Format attendu');

  // Intégrité base : l'index unique rejette physiquement tout doublon de code
  // (le garde-fou CODE_RESERVATION_DUPLIQUE de resoudreReservationParCode
  // reste en protection des bases historiques créées sans cet index).
  let doublonRejete = false;
  try {
    runSql(
      db,
      `INSERT INTO reservations (terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
         montant, prix_total, statut, code_reservation)
       VALUES (?, ?, 'Doublon', '771234568', '2026-11-02', '20:00', '21:00', 30000, 30000, 'confirme', 'TF-774886')`,
      [fx.terrainAvance, fx.joueurB],
    );
  } catch (e) {
    doublonRejete = /UNIQUE/i.test(e.message);
  }
  h.assert('index unique : insertion d’un code en double rejetée', doublonRejete);
  const resoluApres = resoudreReservationParCode(db, 'TF-774886');
  h.assertEqual('résolution toujours unique après tentative de doublon', Number(resoluApres.reservation.id), Number(resaId));

  // --- Autorisation gérant (multi-terrains) -------------------------------------
  const resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [resaId]);
  h.assert('gérant du terrain autorisé (terrain_id simple)',
    gerantPeutValiderReservation({ id: fx.gerantId, terrain_id: fx.terrainAvance }, resa));
  h.assert('gérant autorisé via terrains_ids même si terrain actif différent',
    gerantPeutValiderReservation({ id: fx.gerantId, terrain_id: fx.terrainSans, terrains_ids: [fx.terrainSans, fx.terrainAvance] }, resa));
  h.assert('gérant d’un autre terrain refusé',
    !gerantPeutValiderReservation({ id: 999, terrain_id: fx.terrainSans }, resa));
  h.assert('gérant sans aucun terrain refusé',
    !gerantPeutValiderReservation({ id: fx.gerantId, terrain_id: null, terrains_ids: [] }, resa));

  // --- Chaîne code → QR signé : même code, même réservation ----------------------
  const payload = signQrPayload({
    reservation_id: resaId,
    code: 'TF-774886',
    creneau_id: null,
    terrain_id: fx.terrainAvance,
    expire_at: Math.floor(Date.now() / 1000) + 3600,
  });
  const verif = verifyQrPayload(payload);
  h.assert('payload signé vérifié', verif.ok);
  h.assertEqual('payload associé au code', verif.code, 'TF-774886');
  h.assertEqual('payload associé à la réservation', verif.reservation_id, Number(resaId));

  let mismatchCode = false;
  try {
    assertQrMatchesReservation(verif, { id: resaId, code_reservation: 'TF-325365', terrain_id: fx.terrainAvance, creneau_id: null });
  } catch (e) { mismatchCode = e.code === 'QR_MISMATCH'; }
  h.assert('QR d’un autre code → QR_MISMATCH', mismatchCode);

  let mismatchResa = false;
  try {
    assertQrMatchesReservation(verif, { id: Number(resaId) + 1, code_reservation: 'TF-774886', terrain_id: fx.terrainAvance, creneau_id: null });
  } catch (e) { mismatchResa = e.code === 'QR_MISMATCH'; }
  h.assert('QR d’une autre réservation → QR_MISMATCH', mismatchResa);

  fs.rmSync(tmpDb, { force: true });
  h.exitIfFailed();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
