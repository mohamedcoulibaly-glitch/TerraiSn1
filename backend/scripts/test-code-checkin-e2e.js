/**
 * Test E2E — parcours complet du check-in par code numérique.
 * Simule le flux réel de bout en bout, modules réels enchaînés :
 *   réservation → confirmation paiement (code généré + QR signé stocké)
 *   → envoi WhatsApp joueur (message contenant le code, capturé en base)
 *   → le joueur communique SON code → le gérant le saisit (variante humaine)
 *   → entrée validée, match joué → le même code ne ressert jamais.
 * Usage: node scripts/test-code-checkin-e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const tmpDb = path.join(os.tmpdir(), `terrainsn-code-e2e-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.WHATSAPP_MOCK = 'true';
process.env.JWT_SECRET = 'e2e-code-secret';
process.env.JWT_REFRESH_SECRET = 'e2e-code-refresh';
process.env.QR_HMAC_SECRET = 'e2e-qr-secret';

const { createHarness } = require('../test/helpers/harness');
const h = createHarness('code-checkin-e2e');

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

async function main() {
  const { openDb, seedMonde, poserReservation, runSql, queryOne, transaction } = require('../test/helpers/fixtureDb');
  const { genererCodeReservation } = require('../services/codeReservationService');
  const { signQrPayload, verifyQrPayload } = require('../domain/qrSignature');
  const { calculerFenetreCheckIn } = require('../services/checkInFenetre');
  const notificationService = require('../notificationService');
  const { mountGerantCheckinRoutes, localDateYmd } = require('../gerantCheckin');
  const { genererAccessToken } = require('../middleware/auth');
  const { UPLOAD_ROOT } = require('../terrainPhotoService');

  const db = await openDb();
  const fx = await seedMonde(db);

  // --- 1. Le joueur réserve (créneau aujourd'hui, dans la fenêtre) ----------
  const { reservationId } = poserReservation(db, {
    terrainId: fx.terrainAvance,
    joueurId: fx.joueurA,
    date: localDateYmd(),
    heureDebut: heurePlus(30),
    heureFin: heurePlus(120),
    telephone: '771234567',
    nom: 'Joueur E2E',
  });
  let resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('réservation créée en attente de paiement', resa.statut, 'en_attente_paiement');
  h.assert('aucun code avant confirmation', !resa.code_reservation);

  // --- 2. Confirmation paiement (même logique que payments/flow) --------------
  const code = genererCodeReservation(db);
  const fenetre = calculerFenetreCheckIn({
    date: resa.date, heure_debut: resa.heure_debut, heure_fin: resa.heure_fin, fenetre_retard: 30,
  });
  const qrPayload = signQrPayload({
    reservation_id: reservationId,
    code,
    creneau_id: resa.creneau_id,
    terrain_id: resa.terrain_id,
    expire_at: Math.floor(fenetre.finFenetre / 1000),
  });
  transaction(db, () => {
    runSql(db, "UPDATE reservations SET statut = 'confirme' WHERE id = ?", [reservationId]);
    runSql(db, 'UPDATE reservations SET code_reservation = ?, qr_code_payload = ? WHERE id = ?', [code, qrPayload, reservationId]);
    runSql(db, "UPDATE creneaux SET statut = 'confirme' WHERE id = ?", [resa.creneau_id]);
  });
  h.assert('code généré au format TF-XXXXXX', /^TF-\d{6}$/.test(code), code);

  // --- 3. Envoi WhatsApp joueur : le code part dans le message ------------------
  await notificationService.envoyerConfirmation(reservationId);
  resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  h.assertEqual('code inchangé après envoi', resa.code_reservation, code);
  h.assert('URL QR persistée', Boolean(resa.qr_code_url));

  const fichierQr = path.join(UPLOAD_ROOT, String(resa.qr_code_url).replace(/^\/uploads\//, ''));
  h.assert('fichier PNG du QR présent', fs.existsSync(fichierQr) && fs.statSync(fichierQr).size > 0);

  const verif = verifyQrPayload(resa.qr_code_payload);
  h.assert('payload QR signé valide', verif.ok);
  h.assertEqual('payload QR ↔ même code que le message', verif.code, code);
  h.assertEqual('payload QR ↔ même réservation', verif.reservation_id, Number(reservationId));

  const notif = queryOne(
    db,
    `SELECT contenu FROM notifications WHERE type = 'confirmation' ORDER BY id DESC LIMIT 1`,
  );
  const codeRecuParJoueur = /TF-\d{6}/.exec(String(notif?.contenu || ''))?.[0] || null;
  h.assert('message WhatsApp joueur contient un code', Boolean(codeRecuParJoueur), String(notif?.contenu || '').slice(0, 120));
  h.assertEqual('code reçu par le joueur = code en base', codeRecuParJoueur, code);
  h.assert('message explique de donner le code au gérant', /donne ce code au gérant/i.test(String(notif?.contenu || '')));

  // --- 4. Le gérant saisit le code du joueur (variante humaine) -----------------
  const app = express();
  app.use(express.json());
  mountGerantCheckinRoutes(app);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = genererAccessToken({ id: fx.gerantId, role: 'gerant', terrain_id: fx.terrainAvance, accountType: 'employe' });

  try {
    const saisieGerant = codeRecuParJoueur.toLowerCase().replace('-', ' '); // "tf 123456"
    let r = await request(baseUrl, 'POST', '/api/gerant/reservations/checkin-by-code', {
      body: { code: saisieGerant, expected_reservation_id: reservationId },
      token,
    });
    h.assertEqual('saisie gérant : HTTP 200', r.status, 200);
    h.assertEqual('entrée validée pour la bonne réservation', Number(r.body?.reservation?.id), Number(reservationId));
    h.assertEqual('code renvoyé = code du joueur', r.body?.reservation?.code_reservation, code);

    resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
    h.assertEqual('parcours terminé : statut match_joue', resa.statut, 'match_joue');
    h.assert('check-in horodaté', Boolean(resa.checked_in_at));
    h.assert('scan horodaté', Boolean(resa.qr_code_scanne_at));
    h.assertEqual('code jamais modifié par le check-in', resa.code_reservation, code);
    h.assert('match enregistré', Boolean(queryOne(db, 'SELECT id FROM matchs WHERE reservation_id = ?', [reservationId])));

    // --- 5. Usage unique : le même code ne ressert jamais ------------------------
    r = await request(baseUrl, 'POST', '/api/gerant/reservations/checkin-by-code', {
      body: { code: codeRecuParJoueur },
      token,
    });
    h.assertEqual('seconde utilisation : HTTP 403', r.status, 403);
    h.assertEqual('seconde utilisation : QR_ALREADY_SCANNED', r.body?.code, 'QR_ALREADY_SCANNED');
  } finally {
    server.close();
    if (fs.existsSync(fichierQr)) fs.rmSync(fichierQr, { force: true });
    fs.rmSync(tmpDb, { force: true });
  }
  h.exitIfFailed();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
