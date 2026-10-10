/**
 * Tests unitaires — écarts P0/P1/P2 (rappels, anonymisation, validation, rate-limit, logger).
 * Usage: node scripts/test-gaps-p0-p2.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `terrainsn-gaps-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.WHATSAPP_MOCK = 'true';
process.env.AUTH_RATE_LIMIT = '1';
process.env.LOG_JSON = '0';

const { createHarness } = require('../test/helpers/harness');
const {
  parseReservationDateTime,
  isInReminderWindow,
  buildRappelWhatsAppMessage,
} = require('../services/reminderWindow');
const {
  validateRegisterBody,
  validateVerifyOtpBody,
  validateReservationCreateBody,
} = require('../middleware/validate');
const {
  rateLimit,
  _resetRateLimitBuckets,
  rateLimitEnabled,
} = require('../middleware/rateLimit');
const { anonymiserCompteJoueur, buildAnonymizedIdentity } = require('../services/anonymisationService');
const logger = require('../logger');
const { getDb, runSql, queryOne } = require('../database');

const h = createHarness('unit-gaps-p0-p2');

async function main() {
  // --- Reminder window ---
  const kickoff = parseReservationDateTime('2026-10-10', '18:00');
  const nowOk = new Date('2026-10-10T17:00:00'); // 60 min avant
  h.assert('fenêtre rappel 60 min OK', isInReminderWindow(kickoff, nowOk));
  h.assert(
    'hors fenêtre trop tôt',
    !isInReminderWindow(kickoff, new Date('2026-10-10T16:00:00')),
  );
  h.assert(
    'hors fenêtre trop tard',
    !isInReminderWindow(kickoff, new Date('2026-10-10T17:30:00')),
  );
  const msg = buildRappelWhatsAppMessage({
    prenom: 'Abdou',
    terrain_nom: 'Arena',
    date: '2026-10-10',
    heure_debut: '18:00',
    code_reservation: 'TS-1',
  });
  h.assert('message rappel contient terrain', msg.includes('Arena'));
  h.assert('message rappel contient code', msg.includes('TS-1'));

  // --- Validation ---
  const reg = validateRegisterBody({
    nom: 'Diop',
    prenom: 'Abdou',
    telephone: '771234567',
    password: 'secret1',
    email: 'a@b.sn',
  });
  h.assertEqual('register nom', reg.nom, 'Diop');
  h.assertThrows(
    'register password court',
    () => validateRegisterBody({ nom: 'X', telephone: '771234567', password: '123' }),
    'Mot de passe',
  );
  h.assertThrows(
    'OTP code non numérique',
    () => validateVerifyOtpBody({ telephone: '771234567', code: 'ab12' }),
    'OTP',
  );
  const otp = validateVerifyOtpBody({ telephone: '771234567', code: '123456' });
  h.assertEqual('OTP code', otp.code, '123456');
  const resa = validateReservationCreateBody({
    terrain_id: 3,
    date: '2026-10-12',
    heure_debut: '18:00',
    heure_fin: '19:00',
    joueur_nom: 'Test',
    joueur_telephone: '771234567',
    format_terrain: 'moitie',
  });
  h.assertEqual('resa format', resa.format_terrain, 'moitie');
  h.assertThrows(
    'resa date invalide',
    () =>
      validateReservationCreateBody({
        terrain_id: 1,
        date: '12/10/2026',
        heure_debut: '18:00',
        heure_fin: '19:00',
        joueur_nom: 'T',
        joueur_telephone: '771234567',
      }),
    'Date invalide',
  );

  // --- Rate limit ---
  h.assert('rate limit activé via AUTH_RATE_LIMIT', rateLimitEnabled());
  _resetRateLimitBuckets();
  const mw = rateLimit({ windowMs: 60_000, max: 2, keyPrefix: 'test' });
  let status429 = 0;
  const fakeRes = () => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json() {
        return this;
      },
      on() {
        return this;
      },
    };
    return res;
  };
  await new Promise((resolve) => {
    mw({ ip: '1.1.1.1', body: {} }, fakeRes(), resolve);
  });
  await new Promise((resolve) => {
    mw({ ip: '1.1.1.1', body: {} }, fakeRes(), resolve);
  });
  await new Promise((resolve) => {
    const res = fakeRes();
    mw({ ip: '1.1.1.1', body: {} }, res, () => resolve());
    if (res.statusCode === 429) status429 = 1;
    resolve();
  });
  h.assert('3e requête rate-limitée', status429 === 1);

  // --- Logger metrics ---
  logger.resetMetrics();
  logger.event('rappel_match', { id: 1 });
  logger.event('rappel_match', { id: 2 });
  logger.warn('test', 'attention');
  const metrics = logger.getMetrics();
  h.assertEqual('metric event.rappel_match', metrics['event.rappel_match'], 2);
  h.assertEqual('metric log.warn', metrics['log.warn'], 1);

  // --- Anonymisation (DB) ---
  const db = await getDb();
  const userId = runSql(
    db,
    `INSERT INTO users (nom, prenom, email, telephone, password_hash, role, telephone_verified, is_active)
     VALUES ('Diop', 'Abdou', 'abdou@test.sn', '+221771112233', 'hash', 'joueur', 1, 1)`,
  ).lastInsertRowid;
  const terrainOwner = runSql(
    db,
    `INSERT INTO proprietaires (nom, prenom, email, password_hash, telephone, statut)
     VALUES ('P', 'P', 'p@test.sn', 'x', '221770000001', 'actif')`,
  ).lastInsertRowid;
  const terrainId = runSql(
    db,
    `INSERT INTO terrains (
      proprietaire_id, nom, adresse, ville, sport, type, prix_heure, is_active
    ) VALUES (?, 'T', 'Dakar', 'Dakar', 'foot', '5v5', 10000, 1)`,
    [terrainOwner],
  ).lastInsertRowid;
  const pendingId = runSql(
    db,
    `INSERT INTO reservations (
      terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
      prix_total, statut
    ) VALUES (?, ?, 'Abdou Diop', '+221771112233', date('now', '+2 day'), '18:00', '19:00', 10000, 'en_attente')`,
    [terrainId, userId],
  ).lastInsertRowid;

  const identity = buildAnonymizedIdentity(userId);
  h.assert('identité anonymisée', identity.nom === 'Compte supprimé' && identity.telephone.startsWith('deleted_'));

  const result = anonymiserCompteJoueur(db, userId);
  h.assert('anonymisation ok', result.already === false && result.pending_cancelled === 1);
  const user = queryOne(db, 'SELECT * FROM users WHERE id = ?', [userId]);
  h.assertEqual('user inactif', Number(user.is_active), 0);
  h.assert('telephone anonymisé', String(user.telephone).startsWith('deleted_'));
  h.assert('email anonymisé', String(user.email).includes('@anonymized.local'));
  const pending = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [pendingId]);
  h.assertEqual('pending annulé', pending.statut, 'annule');

  const again = anonymiserCompteJoueur(db, userId);
  h.assert('idempotent already', again.already === true);

  h.assertThrows(
    'refuse anonymiser non-joueur',
    () => {
      const adminId = runSql(
        db,
        `INSERT INTO users (nom, email, telephone, password_hash, role, is_active)
         VALUES ('Admin', 'admin-gaps@test.sn', '770000099', 'x', 'super_admin', 1)`,
      ).lastInsertRowid;
      anonymiserCompteJoueur(db, adminId);
    },
    'joueur',
  );

  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }
  h.exitIfFailed();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
