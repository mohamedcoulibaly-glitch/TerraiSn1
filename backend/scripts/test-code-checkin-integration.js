/**
 * Tests d'INTÉGRATION — check-in par code numérique (HTTP réel).
 * Monte les vraies routes gérant (gerantCheckin) sur SQLite temporaire et
 * vérifie la communication front → API → service codes → base :
 * succès, usage unique, mauvais code, format, autre terrain, multi-terrains,
 * fiche (expected_reservation_id), statut, fenêtre.
 * Usage: node scripts/test-code-checkin-integration.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const tmpDb = path.join(os.tmpdir(), `terrainsn-code-integ-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.WHATSAPP_MOCK = 'true';
process.env.JWT_SECRET = 'integration-code-secret';
process.env.JWT_REFRESH_SECRET = 'integration-code-refresh';
process.env.QR_HMAC_SECRET = 'integration-qr-secret';

const { createHarness } = require('../test/helpers/harness');
const h = createHarness('code-checkin-integration');

function request(baseUrl, method, urlPath, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, baseUrl);
    const payload = body != null ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch { json = { raw: data }; }
          resolve({ status: res.statusCode, body: json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function heurePlus(minutes) {
  const d = new Date(Date.now() + minutes * 60000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function datePlus(jours) {
  const d = new Date(Date.now() + jours * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const aujourdhui = () => datePlus(0);

async function main() {
  const { openDb, seedMonde, runSql, queryOne } = require('../test/helpers/fixtureDb');
  const { mountGerantCheckinRoutes, localDateYmd } = require('../gerantCheckin');
  const { genererAccessToken } = require('../middleware/auth');

  const db = await openDb();
  const fx = await seedMonde(db);

  // Terrain d'un AUTRE gérant (jamais autorisé pour notre gérant de test)
  const terrainAutre = runSql(
    db,
    `INSERT INTO terrains (proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_entier, prix_moitie,
       pourcentage_avance, commission_pourcentage, modele_revenus, is_active)
     VALUES (?, 'Arena Autre', 'Dakar', 'Dakar', 'foot', '5v5', 30000, 40000, 18000, 12.5, 10, 'commission', 1)`,
    [fx.proprioId],
  ).lastInsertRowid;

  function creerResa({ terrainId, code, statut = 'confirme', date = aujourdhui(), debut = heurePlus(30), fin = heurePlus(120), joueur = fx.joueurA }) {
    return runSql(
      db,
      `INSERT INTO reservations (terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
         montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant, statut, code_reservation)
       VALUES (?, ?, 'Joueur Integ', '771234567', ?, ?, ?, 30000, 30000, 5000, 5000, 25000, 25000, ?, ?)`,
      [terrainId, joueur, date, debut, fin, statut, code],
    ).lastInsertRowid;
  }

  const resaA = creerResa({ terrainId: fx.terrainAvance, code: 'TF-111111' });
  const resaB = creerResa({ terrainId: fx.terrainSans, code: 'TF-222222', debut: heurePlus(35), fin: heurePlus(125) });
  const resaC = creerResa({ terrainId: terrainAutre, code: 'TF-333333' });
  const resaD = creerResa({ terrainId: fx.terrainAvance, code: 'TF-444444', debut: heurePlus(40), fin: heurePlus(130) });
  const resaE = creerResa({ terrainId: fx.terrainAvance, code: 'TF-555555', statut: 'en_attente_paiement' });
  const resaF = creerResa({ terrainId: fx.terrainAvance, code: 'TF-666666', date: datePlus(1) });

  const app = express();
  app.use(express.json());
  mountGerantCheckinRoutes(app);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = genererAccessToken({ id: fx.gerantId, role: 'gerant', terrain_id: fx.terrainAvance, accountType: 'employe' });
  const post = (p, body, tok = token) => request(baseUrl, 'POST', p, { body, token: tok });
  const get = (p, tok = token) => request(baseUrl, 'GET', p, { token: tok });

  try {
    // 1. Succès — saisie « humaine » (minuscules + espace) normalisée serveur
    let r = await post('/api/gerant/reservations/checkin-by-code', { code: 'tf 111111' });
    h.assertEqual('check-in par code : HTTP 200', r.status, 200);
    h.assertEqual('réponse : bonne réservation', Number(r.body?.reservation?.id), Number(resaA));
    h.assertEqual('réponse : code confirmé', r.body?.reservation?.code_reservation, 'TF-111111');
    let row = queryOne(db, 'SELECT statut, qr_code_scanne_at, checked_in_at FROM reservations WHERE id = ?', [resaA]);
    h.assertEqual('base : statut match_joue', row.statut, 'match_joue');
    h.assert('base : qr_code_scanne_at posé', Boolean(row.qr_code_scanne_at));
    h.assert('base : ligne matchs créée', Boolean(queryOne(db, 'SELECT id FROM matchs WHERE reservation_id = ?', [resaA])));

    // 2. Usage unique — le même code une 2e fois est refusé
    r = await post('/api/gerant/reservations/checkin-by-code', { code: 'TF-111111' });
    h.assertEqual('même code rejoué : HTTP 403', r.status, 403);
    h.assertEqual('même code rejoué : QR_ALREADY_SCANNED', r.body?.code, 'QR_ALREADY_SCANNED');

    // 3. Code inexistant / format invalide / sans authentification
    r = await post('/api/gerant/reservations/checkin-by-code', { code: 'TF-999999' });
    h.assertEqual('code inexistant : HTTP 404', r.status, 404);
    h.assertEqual('code inexistant : QR_CODE_NOT_FOUND', r.body?.code, 'QR_CODE_NOT_FOUND');
    r = await post('/api/gerant/reservations/checkin-by-code', { code: 'bonjour' });
    h.assertEqual('format invalide : HTTP 400', r.status, 400);
    h.assertEqual('format invalide : CODE_FORMAT_INVALIDE', r.body?.code, 'CODE_FORMAT_INVALIDE');
    r = await request(baseUrl, 'POST', '/api/gerant/reservations/checkin-by-code', { body: { code: 'TF-444444' } });
    h.assertEqual('sans token : HTTP 401', r.status, 401);

    // 4. Code d'un autre terrain (gérant non autorisé) refusé, résa intacte
    r = await post('/api/gerant/reservations/checkin-by-code', { code: 'TF-333333' });
    h.assertEqual('autre terrain : HTTP 403', r.status, 403);
    h.assertEqual('autre terrain : QR_WRONG_TERRAIN', r.body?.code, 'QR_WRONG_TERRAIN');
    row = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [resaC]);
    h.assertEqual('autre terrain : réservation intacte', row.statut, 'confirme');

    // 5. Mode fiche : code d'une AUTRE réservation que celle présélectionnée
    r = await post('/api/gerant/reservations/checkin-by-code', { code: 'TF-444444', expected_reservation_id: resaA });
    h.assertEqual('fiche + mauvais code : HTTP 400', r.status, 400);
    h.assertEqual('fiche + mauvais code : QR_MISMATCH', r.body?.code, 'QR_MISMATCH');
    row = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [resaD]);
    h.assertEqual('fiche + mauvais code : aucune validation', row.statut, 'confirme');

    // 6. Mode fiche : le BON code valide la bonne réservation
    r = await post('/api/gerant/reservations/checkin-by-code', { code: '444444', expected_reservation_id: resaD });
    h.assertEqual('fiche + bon code (6 chiffres seuls) : HTTP 200', r.status, 200);
    h.assertEqual('fiche + bon code : bonne réservation', Number(r.body?.reservation?.id), Number(resaD));

    // 7. Multi-terrains : le gérant gère aussi terrainSans → son code passe
    //    même si le terrain « actif » du jeton est terrainAvance.
    // gerants_terrains fait foi : le gérant est lié à ses DEUX terrains
    // (principal = terrainAvance), comme en production.
    runSql(db, `INSERT INTO gerants_terrains (gerant_id, terrain_id, actif, est_principal) VALUES (?, ?, 1, 1)`, [fx.gerantId, fx.terrainAvance]);
    runSql(db, `INSERT INTO gerants_terrains (gerant_id, terrain_id, actif, est_principal) VALUES (?, ?, 1, 0)`, [fx.gerantId, fx.terrainSans]);
    r = await post('/api/gerant/reservations/checkin-by-code', { code: 'TF-222222' });
    h.assertEqual('multi-terrains : HTTP 200 malgré terrain actif différent', r.status, 200);
    h.assertEqual('multi-terrains : bonne réservation', Number(r.body?.reservation?.id), Number(resaB));

    // 8. Statut non confirmé et fenêtre fermée toujours refusés
    r = await post('/api/gerant/reservations/checkin-by-code', { code: 'TF-555555' });
    h.assertEqual('non confirmée : HTTP 400', r.status, 400);
    h.assertEqual('non confirmée : QR_BAD_STATUS', r.body?.code, 'QR_BAD_STATUS');
    r = await post('/api/gerant/reservations/checkin-by-code', { code: 'TF-666666' });
    h.assertEqual('match demain : HTTP 400', r.status, 400);
    h.assertEqual('match demain : QR_SCAN_TOO_EARLY', r.body?.code, 'QR_SCAN_TOO_EARLY');

    // 9. Résolution by-code alignée (lecture) : normalisation + autorisation
    r = await get('/api/gerant/reservations/by-code/tf-555555');
    h.assertEqual('by-code minuscules : HTTP 200', r.status, 200);
    h.assertEqual('by-code : bonne réservation', Number(r.body?.id), Number(resaE));
    r = await get('/api/gerant/reservations/by-code/TF-333333');
    h.assertEqual('by-code autre terrain : HTTP 403', r.status, 403);
    r = await get('/api/gerant/reservations/by-code/TF-999999');
    h.assertEqual('by-code inexistant : HTTP 404', r.status, 404);
  } finally {
    server.close();
    fs.rmSync(tmpDb, { force: true });
  }
  h.exitIfFailed();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
