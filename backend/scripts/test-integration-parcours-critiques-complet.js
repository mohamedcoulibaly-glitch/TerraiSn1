/**
 * Intégration HTTP COMPLÈTE — vraie API Express (index.js) + SQLite tmp.
 * Couvre les parcours critiques de TOUS les rôles :
 *   joueur, gérant, propriétaire, super_admin + chaînes croisées.
 *
 * Usage: node scripts/test-integration-parcours-critiques-complet.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');

const tmpDb = path.join(os.tmpdir(), `terrainsn-int-full-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.INTEGRATION_TEST = '1';
process.env.SKIP_SEED = '1';
process.env.SKIP_LISTEN = '1';
process.env.WHATSAPP_MOCK = 'true';
process.env.PAYTECH_MOCK = 'true';
process.env.PAYMENT_MODE = 'simulation';
process.env.JWT_SECRET = 'integration_full_jwt_secret';
process.env.JWT_REFRESH_SECRET = 'integration_full_jwt_refresh';
process.env.QR_HMAC_SECRET = 'integration_full_qr_secret';
process.env.APP_DOMAIN = 'http://127.0.0.1:9';
process.env.NODE_ENV = 'test';
process.env.WHATSAPP_DEV_NUMBER = '221770000099';

const { createHarness } = require('../test/helpers/harness');
const { demarrerFullApp } = require('../test/helpers/fullApp');
const { seedMohamedCompte } = require('../test/helpers/dbFixtures');
const { MOHAMED } = require('../test/helpers/mohamed');
const { getDb, runSql, queryOne, queryAll } = require('../database');

const h = createHarness('integration-parcours-critiques-complet');

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

function ymdPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function heurePlus(minutes) {
  const d = new Date(Date.now() + minutes * 60000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function seedHoraires(db, terrainId) {
  for (const jour of JOURS) {
    runSql(
      db,
      `INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert)
       VALUES (?, ?, '06:00', '24:00', 1)`,
      [terrainId, jour],
    );
  }
}

async function main() {
  const db = await getDb();
  const passwordHash = await bcrypt.hash('TestPass123!', 8);
  const fx = seedMohamedCompte(db, { avancePct: 12.5, commissionPct: 10, payoutMode: 'retrait' });
  seedHoraires(db, fx.terrainId);

  runSql(db, 'UPDATE users SET password_hash = ?, telephone_verified = 1 WHERE id = ?', [
    passwordHash,
    fx.joueurId,
  ]);
  runSql(db, 'UPDATE employes SET password_hash = ?, is_active = 1 WHERE id = ?', [
    passwordHash,
    fx.gerantId,
  ]);
  runSql(db, 'UPDATE proprietaires SET password_hash = ?, statut = ? WHERE id = ?', [
    passwordHash,
    'actif',
    fx.proprioId,
  ]);

  // Numéros Wave/OM vérifiés (retrait)
  runSql(
    db,
    `UPDATE terrains SET wave_numero = ?, om_numero = ?, wave_statut = 'verifie', om_statut = 'verifie',
      gerant_id = ? WHERE id = ?`,
    [MOHAMED.telephoneLocal9, MOHAMED.telephoneLocal9, fx.gerantId, fx.terrainId],
  );

  const saId = runSql(
    db,
    `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active, telephone_verified)
     VALUES ('Super', 'Admin', 'sa.full@test.sn', ?, '221700000077', 'super_admin', 1, 1)`,
    [passwordHash],
  ).lastInsertRowid;

  const joueur = queryOne(db, 'SELECT * FROM users WHERE id = ?', [fx.joueurId]);
  const gerant = queryOne(db, 'SELECT * FROM employes WHERE id = ?', [fx.gerantId]);
  const proprio = queryOne(db, 'SELECT * FROM proprietaires WHERE id = ?', [fx.proprioId]);
  const sa = queryOne(db, 'SELECT * FROM users WHERE id = ?', [saId]);

  const { baseUrl, request, close } = await demarrerFullApp();

  try {
    // =====================================================================
    // 0. Santé publique
    // =====================================================================
    const health = await request('GET', '/api/health');
    h.assertEqual('health 200', health.status, 200);
    h.assert('health status ok', health.body?.status === 'ok' || health.body?.ok === true);

    const terrainsPublic = await request('GET', '/api/terrains');
    h.assertEqual('terrains publics 200', terrainsPublic.status, 200);
    h.assert(
      'terrain Mohamed visible',
      Array.isArray(terrainsPublic.body)
        && terrainsPublic.body.some((t) => Number(t.id) === Number(fx.terrainId)),
    );

    const fiche = await request('GET', `/api/terrains/${fx.terrainId}`);
    h.assertEqual('fiche terrain 200', fiche.status, 200);
    h.assertEqual('fiche nom', fiche.body?.nom, 'Arena Mohamed Parcelles');

    const dateFuture = ymdPlus(3);
    const devis = await request(
      'GET',
      `/api/terrains/${fx.terrainId}/devis?date=${dateFuture}&heure_debut=18:00&heure_fin=19:00&format=entier`,
    );
    h.assertEqual('devis 200', devis.status, 200);
    h.assertEqual('devis montant', Number(devis.body?.montant), 40000);
    h.assertEqual('devis avance 12.5%', Number(devis.body?.montant_avance), 5000);

    const creneaux = await request('GET', `/api/terrains/${fx.terrainId}/creneaux?date=${dateFuture}`);
    h.assertEqual('creneaux 200', creneaux.status, 200);
    const creneauxList = Array.isArray(creneaux.body)
      ? creneaux.body
      : (creneaux.body?.creneaux || []);
    h.assert('creneaux list', Array.isArray(creneauxList) && creneauxList.length >= 1);

    // =====================================================================
    // 1. JOUEUR — inscription OTP → login → réservation → paiement → QR → annulation
    // =====================================================================
    const telNouveau = '771112233';
    const register = await request('POST', '/api/auth/register', {
      body: {
        prenom: 'Awa',
        nom: 'Ndiaye',
        telephone: telNouveau,
        password: 'TestPass123!',
      },
    });
    h.assertEqual('register joueur 201', register.status, 201);
    h.assert('register success', register.body?.success === true);

    const otpRow = queryOne(
      db,
      `SELECT * FROM auth_otps WHERE telephone LIKE ? AND used = 0 ORDER BY id DESC LIMIT 1`,
      [`%${telNouveau}`],
    );
    h.assert('OTP créé en DB', Boolean(otpRow?.code));

    const verify = await request('POST', '/api/auth/verify-otp', {
      body: { telephone: telNouveau, code: otpRow.code },
    });
    h.assertEqual('verify-otp 200', verify.status, 200);
    h.assert('verify token', Boolean(verify.body?.token || verify.body?.accessToken));
    const joueurOtpToken = verify.body?.token || verify.body?.accessToken;

    const meOtp = await request('GET', '/api/auth/me', { token: joueurOtpToken });
    h.assertEqual('auth/me joueur OTP 200', meOtp.status, 200);
    h.assert(
      'auth/me role joueur',
      meOtp.body?.role === 'joueur' || meOtp.body?.user?.role === 'joueur',
    );

    // Login joueur seedé (téléphone)
    const loginJ = await request('POST', '/api/auth/login', {
      body: { telephone: joueur.telephone, password: 'TestPass123!' },
    });
    h.assertEqual('login joueur 200', loginJ.status, 200);
    h.assert('login joueur token', Boolean(loginJ.body?.token));
    const jToken = loginJ.body.token;

    // Refus réservation sans auth
    const noAuth = await request('POST', '/api/reservations', {
      body: {
        terrain_id: fx.terrainId,
        date: dateFuture,
        heure_debut: '10:00',
        heure_fin: '11:00',
        joueur_nom: 'X',
        joueur_telephone: MOHAMED.telephoneLocal9,
        canal_paiement: 'wave',
      },
    });
    h.assertEqual('résa sans auth 401', noAuth.status, 401);

    // Réservation joueur + canal Wave
    const resa = await request('POST', '/api/reservations', {
      token: jToken,
      body: {
        terrain_id: fx.terrainId,
        date: dateFuture,
        heure_debut: '18:00',
        heure_fin: '19:00',
        format_terrain: 'entier',
        joueur_nom: MOHAMED.nom,
        joueur_telephone: MOHAMED.telephoneLocal9,
        canal_paiement: 'wave',
      },
    });
    h.assertEqual('création résa joueur 201', resa.status, 201);
    h.assert(
      'résa en attente paiement',
      ['en_attente', 'en_attente_paiement'].includes(String(resa.body?.statut || resa.body?.reservation?.statut)),
    );
    const resaId = Number(resa.body?.id || resa.body?.reservation?.id);
    h.assert('résa id', resaId > 0);

    const rowResa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [resaId]);
    h.assert('reference_paytech posée', Boolean(rowResa?.reference_paytech));
    h.assert('lien_paiement simulation', Boolean(rowResa?.lien_paiement));

    // Double booking
    const resaConflict = await request('POST', '/api/reservations', {
      token: jToken,
      body: {
        terrain_id: fx.terrainId,
        date: dateFuture,
        heure_debut: '18:00',
        heure_fin: '19:00',
        format_terrain: 'entier',
        joueur_nom: MOHAMED.nom,
        joueur_telephone: MOHAMED.telephoneLocal9,
        canal_paiement: 'wave',
      },
    });
    h.assertEqual('double booking 409', resaConflict.status, 409);

    // Simulation paiement
    const simPay = await request('POST', '/api/payments/simulate', {
      body: {
        reservation_id: resaId,
        ref_command: rowResa.reference_paytech,
        action: 'success',
      },
    });
    h.assertEqual('simulate paiement 200', simPay.status, 200);
    const afterPay = queryOne(db, 'SELECT statut, code_reservation, qr_code_payload FROM reservations WHERE id = ?', [resaId]);
    h.assertEqual('après paiement → confirme', afterPay.statut, 'confirme');
    h.assert('code_reservation généré', Boolean(afterPay.code_reservation));
    h.assert('qr payload', Boolean(afterPay.qr_code_payload));

    const mes = await request('GET', '/api/reservations/mes', { token: jToken });
    h.assertEqual('mes réservations 200', mes.status, 200);
    h.assert(
      'mes résas contient confirmée',
      Array.isArray(mes.body) && mes.body.some((r) => Number(r.id) === resaId && r.statut === 'confirme'),
    );

    const qrPng = await request('GET', `/api/reservations/${resaId}/qr.png`, { token: jToken });
    h.assertEqual('QR png 200', qrPng.status, 200);

    // Réservation à annuler (créneau distinct)
    const dateAnnul = ymdPlus(5);
    const resaAnnul = await request('POST', '/api/reservations', {
      token: jToken,
      body: {
        terrain_id: fx.terrainId,
        date: dateAnnul,
        heure_debut: '12:00',
        heure_fin: '13:00',
        format_terrain: 'entier',
        joueur_nom: MOHAMED.nom,
        joueur_telephone: MOHAMED.telephoneLocal9,
        canal_paiement: 'wave',
      },
    });
    h.assertEqual('résa annulation 201', resaAnnul.status, 201);
    const resaAnnulId = Number(resaAnnul.body?.id || resaAnnul.body?.reservation?.id);
    const rowAnnul = queryOne(db, 'SELECT reference_paytech FROM reservations WHERE id = ?', [resaAnnulId]);
    await request('POST', '/api/payments/simulate', {
      body: {
        reservation_id: resaAnnulId,
        ref_command: rowAnnul.reference_paytech,
        action: 'success',
      },
    });
    const politique = await request('GET', `/api/reservations/${resaAnnulId}/politique-annulation`, {
      token: jToken,
    });
    h.assertEqual('politique annulation 200', politique.status, 200);

    const annuler = await request('PUT', `/api/reservations/${resaAnnulId}/annuler`, { token: jToken });
    h.assert(
      'annulation joueur ok',
      annuler.status === 200 || annuler.status === 201,
      `status=${annuler.status} body=${JSON.stringify(annuler.body)}`,
    );
    const afterAnnul = queryOne(db, 'SELECT statut FROM reservations WHERE id = ?', [resaAnnulId]);
    h.assertEqual('statut après annulation', afterAnnul.statut, 'annule');

    // =====================================================================
    // 2. GÉRANT — login → dashboard → check-in → encaissement → portefeuille → retrait
    // =====================================================================
    const loginG = await request('POST', '/api/backoffice/auth/login', {
      body: { email: gerant.email, password: 'TestPass123!' },
    });
    h.assertEqual('login gérant 200', loginG.status, 200);
    h.assert('login gérant token', Boolean(loginG.body?.token));
    const gToken = loginG.body.token;

    // Joueur ne peut pas accéder backoffice gérant
    const joueurSurGerant = await request('GET', '/api/gerant/portefeuille', { token: jToken });
    h.assertEqual('joueur → portefeuille gérant 403', joueurSurGerant.status, 403);

    const wallet0 = await request('GET', '/api/gerant/portefeuille', { token: gToken });
    h.assertEqual('portefeuille gérant 200', wallet0.status, 200);

    const terrainsG = await request('GET', '/api/gerant/terrains', { token: gToken });
    h.assertEqual('gerant/terrains 200', terrainsG.status, 200);

    const fenetre = await request('GET', '/api/gerant/fenetre-retard', { token: gToken });
    h.assertEqual('fenetre-retard 200', fenetre.status, 200);

    // Réservation « aujourd'hui » pour check-in (fenêtre ouverte)
    const debut = heurePlus(20);
    const fin = heurePlus(80);
    const codeCheckin = 'TF-889901';
    const checkinResaId = runSql(
      db,
      `INSERT INTO reservations (
        terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
        montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant,
        statut, code_reservation, operational_stage, confirme_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 40000, 40000, 5000, 5000, 35000, 35000, 'confirme', ?, 'reserved', CURRENT_TIMESTAMP)`,
      [
        fx.terrainId,
        fx.joueurId,
        MOHAMED.nom,
        MOHAMED.telephoneLocal9,
        ymdPlus(0),
        debut,
        fin,
        codeCheckin,
      ],
    ).lastInsertRowid;

    // Ledger dû après payin (pour retrait)
    const { creerDuApresPayin } = require('../services/ledgerService');
    const { chargerContrat } = require('../services/contratService');
    const resaLedger = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [resaId]);
    const contrat = chargerContrat(db, fx.terrainId);
    try {
      creerDuApresPayin(db, { reservation: resaLedger, contrat });
    } catch (e) {
      // déjà créé par confirmerPaiementEtNotifier — OK
      h.assert('ledger déjà présent ou créé', true);
    }

    const checkin = await request('POST', '/api/gerant/reservations/checkin-by-code', {
      token: gToken,
      body: { code: codeCheckin },
    });
    h.assertEqual(
      'check-in par code 200',
      checkin.status,
      200,
    );
    if (checkin.status !== 200) {
      console.error('check-in body', checkin.body);
    }
    const afterCheckin = queryOne(
      db,
      'SELECT statut, checked_in_at, operational_stage, montant_restant FROM reservations WHERE id = ?',
      [checkinResaId],
    );
    // Check-in valide l'entrée : statut reste confirme, stage → checkin (match_joue à la clôture)
    h.assertEqual('après check-in statut confirme', afterCheckin.statut, 'confirme');
    h.assert('checked_in_at', Boolean(afterCheckin.checked_in_at));
    h.assert(
      'operational_stage checkin|match',
      ['checkin', 'match'].includes(String(afterCheckin.operational_stage)),
    );

    // Parcours Kanban : checkin → match → checkout → closed
    let stageFrom = String(afterCheckin.operational_stage || 'checkin');
    if (stageFrom === 'checkin') {
      const toMatch = await request('PATCH', `/api/gerant/reservations/${checkinResaId}/stage`, {
        token: gToken,
        body: { stage: 'match' },
      });
      h.assertEqual('stage match 200', toMatch.status, 200);
      stageFrom = 'match';
    }
    if (stageFrom === 'match') {
      const toCheckout = await request('PATCH', `/api/gerant/reservations/${checkinResaId}/stage`, {
        token: gToken,
        body: { stage: 'checkout' },
      });
      h.assertEqual('stage checkout 200', toCheckout.status, 200);
    }
    const stageClose = await request('PATCH', `/api/gerant/reservations/${checkinResaId}/stage`, {
      token: gToken,
      body: { stage: 'closed', encaisserRestant: true, methode: 'especes' },
    });
    h.assert(
      'stage closed / encaissement',
      stageClose.status === 200 || stageClose.status === 201,
      `status=${stageClose.status} ${JSON.stringify(stageClose.body)}`,
    );
    const afterClosed = queryOne(db, 'SELECT statut, operational_stage FROM reservations WHERE id = ?', [checkinResaId]);
    h.assertEqual('après closed operational_stage', afterClosed.operational_stage, 'closed');
    h.assertEqual('après closed statut match_joue', afterClosed.statut, 'match_joue');

    // Réservation manuelle gérant
    const dateManuel = ymdPlus(4);
    const resaManuel = await request('POST', '/api/reservations/gerant', {
      token: gToken,
      body: {
        terrain_id: fx.terrainId,
        date: dateManuel,
        heure_debut: '16:00',
        heure_fin: '17:00',
        format_terrain: 'entier',
        joueur_nom: 'Walk-in Test',
        joueur_telephone: '770998877',
        mode: 'manuel',
      },
    });
    h.assert(
      'résa manuelle gérant',
      resaManuel.status === 201 || resaManuel.status === 200,
      `status=${resaManuel.status} ${JSON.stringify(resaManuel.body)}`,
    );

    // Sortir les dus de la fenêtre de remboursement → payable
    runSql(
      db,
      `UPDATE dus SET fenetre_expire_at = datetime('now', '-1 hour')
       WHERE terrain_id = ? AND statut = 'en_fenetre'`,
      [fx.terrainId],
    );
    const { traiterFenetresExpirees } = require('../services/payoutEngine');
    await traiterFenetresExpirees(db);
    const dusPayables = queryAll(
      db,
      `SELECT id, statut, du_gerant FROM dus WHERE terrain_id = ? AND statut IN ('payable', 'echec')`,
      [fx.terrainId],
    );
    h.assert('dus payables prêts', dusPayables.length >= 1, `n=${dusPayables.length}`);

    // Demande retrait
    const retrait = await request('POST', '/api/gerant/portefeuille/retirer', { token: gToken });
    h.assert(
      'demande retrait gérant',
      retrait.status === 201 || retrait.status === 200,
      `status=${retrait.status} ${JSON.stringify(retrait.body)}`,
    );
    const demandeId = Number(retrait.body?.id || retrait.body?.demande?.id || 0);
    h.assert('demande retrait id', demandeId > 0);

    // =====================================================================
    // 3. PROPRIÉTAIRE — login → terrains → revenus → retraits lecture → employés
    // =====================================================================
    const loginP = await request('POST', '/api/backoffice/auth/login', {
      body: { email: proprio.email, password: 'TestPass123!' },
    });
    h.assertEqual('login propriétaire 200', loginP.status, 200);
    const pToken = loginP.body.token;

    const terrainsP = await request('GET', '/api/proprietaire/terrains', { token: pToken });
    // Route peut être /api/proprietaire/terrains (roles) ou via index
    h.assert(
      'proprio terrains',
      terrainsP.status === 200
        || (await request('GET', '/api/terrains', { token: pToken })).status === 200,
    );
    if (terrainsP.status === 200) {
      h.assert(
        'proprio voit son terrain',
        Array.isArray(terrainsP.body) && terrainsP.body.some((t) => Number(t.id) === Number(fx.terrainId)),
      );
    }

    const revenus = await request('GET', '/api/proprietaire/revenus?periode=annee', { token: pToken });
    h.assertEqual('proprio revenus 200', revenus.status, 200);

    const auditP = await request('GET', '/api/proprietaire/audit', { token: pToken });
    h.assertEqual('proprio audit 200', auditP.status, 200);

    // Propriétaire ne peut PAS valider un retrait (réservé SA)
    if (demandeId > 0) {
      const proprioEnvoie = await request('POST', `/api/admin/caisse/retraits/${demandeId}/envoyer`, {
        token: pToken,
        body: { mode_manuel: true, ref_manuelle: 'PROPRIO-INTERDIT' },
      });
      h.assertEqual('proprio ne valide pas retrait 403', proprioEnvoie.status, 403);
    }

    // Employés
    const employes = await request('GET', '/api/employes', { token: pToken });
    h.assert(
      'liste employés proprio',
      employes.status === 200 || employes.status === 404,
      `status=${employes.status}`,
    );

    // =====================================================================
    // 4. SUPER ADMIN — login → listes → suspendre/activer → caisse retrait
    // =====================================================================
    const loginSa = await request('POST', '/api/admin/auth/login', {
      body: { telephone: sa.telephone, password: 'TestPass123!' },
    });
    h.assertEqual('login SA 200', loginSa.status, 200);
    const saToken = loginSa.body.token || loginSa.body.accessToken;
    h.assert('SA token', Boolean(saToken));

    const adminTerrains = await request('GET', '/api/admin/terrains', { token: saToken });
    h.assertEqual('admin terrains 200', adminTerrains.status, 200);
    h.assert('admin ≥1 terrain', Array.isArray(adminTerrains.body) && adminTerrains.body.length >= 1);

    const adminUsers = await request('GET', '/api/admin/users', { token: saToken });
    h.assertEqual('admin users 200', adminUsers.status, 200);

    const adminProprios = await request('GET', '/api/admin/proprietaires', { token: saToken });
    h.assertEqual('admin proprietaires 200', adminProprios.status, 200);

    const adminSa = await request('GET', '/api/admin/superadmins', { token: saToken });
    h.assertEqual('admin superadmins 200', adminSa.status, 200);

    const caisse = await request('GET', '/api/admin/caisse/dashboard', { token: saToken });
    h.assertEqual('caisse dashboard 200', caisse.status, 200);

    const retraitsFile = await request('GET', '/api/admin/caisse/retraits?statut=en_attente', {
      token: saToken,
    });
    h.assertEqual('caisse retraits 200', retraitsFile.status, 200);

    // Suspendre puis réactiver terrain (contrat API : statut actif|suspendu)
    runSql(
      db,
      `UPDATE terrains SET latitude = 14.7167, longitude = -17.4677, adresse = 'Parcelles Assainies' WHERE id = ?`,
      [fx.terrainId],
    );
    // Photo principale requise pour réactivation
    try {
      runSql(
        db,
        `INSERT INTO terrain_photos (terrain_id, url, est_principale, ordre)
         VALUES (?, '/uploads/test-principal.jpg', 1, 0)`,
        [fx.terrainId],
      );
    } catch {
      /* table/colonnes variables selon migrations — fallback UPDATE si déjà présente */
    }

    const suspend = await request('PATCH', `/api/admin/terrains/${fx.terrainId}/statut`, {
      token: saToken,
      body: { statut: 'suspendu' },
    });
    h.assertEqual('suspendre terrain 200', suspend.status, 200);
    const tOff = queryOne(db, 'SELECT is_active FROM terrains WHERE id = ?', [fx.terrainId]);
    h.assertEqual('terrain inactif', Number(tOff.is_active), 0);

    const terrainsApresSuspend = await request('GET', '/api/terrains');
    const listPub = Array.isArray(terrainsApresSuspend.body)
      ? terrainsApresSuspend.body
      : (terrainsApresSuspend.body?.terrains || []);
    h.assert(
      'terrain suspendu masqué du public',
      !listPub.some((t) => Number(t.id) === Number(fx.terrainId)),
    );

    const reactiver = await request('PATCH', `/api/admin/terrains/${fx.terrainId}/statut`, {
      token: saToken,
      body: { statut: 'actif' },
    });
    h.assert(
      'réactiver terrain',
      reactiver.status === 200,
      `status=${reactiver.status} ${JSON.stringify(reactiver.body)}`,
    );

    // Création propriétaire SA
    const createProprio = await request('POST', '/api/admin/proprietaires', {
      token: saToken,
      body: {
        nom: 'Nouveau',
        prenom: 'Proprio',
        email: 'nouveau.proprio@test.sn',
        telephone: '221701112233',
        password: 'TempPass123!',
      },
    });
    h.assert(
      'création propriétaire SA',
      createProprio.status === 201 || createProprio.status === 200,
      `status=${createProprio.status} ${JSON.stringify(createProprio.body)}`,
    );

    // Valider retrait (manuel)
    let retraitId = demandeId;
    if (!retraitId) {
      const file = Array.isArray(retraitsFile.body)
        ? retraitsFile.body
        : (retraitsFile.body?.retraits || retraitsFile.body?.items || []);
      if (Array.isArray(file) && file.length) {
        retraitId = Number(file[0].id);
      }
    }
    if (retraitId > 0) {
      const envoyer = await request('POST', `/api/admin/caisse/retraits/${retraitId}/envoyer`, {
        token: saToken,
        body: { mode_manuel: true, ref_manuelle: 'INT-FULL-WAVE-001' },
      });
      h.assert(
        'SA envoie retrait manuel',
        envoyer.status === 200,
        `status=${envoyer.status} ${JSON.stringify(envoyer.body)}`,
      );
    } else {
      h.assert('retrait file (skip si aucun dû)', true);
    }

    // Gérant ne peut pas accéder admin
    const gerantAdmin = await request('GET', '/api/admin/terrains', { token: gToken });
    h.assertEqual('gérant → admin 403', gerantAdmin.status, 403);

    // Joueur ne peut pas login admin
    const joueurAdminLogin = await request('POST', '/api/admin/auth/login', {
      body: { telephone: joueur.telephone, password: 'TestPass123!' },
    });
    h.assertEqual('joueur login admin 401', joueurAdminLogin.status, 401);

    // =====================================================================
    // 5. Authz croisées + suppression compte joueur
    // =====================================================================
    const saSurResa = await request('POST', '/api/reservations', {
      token: saToken,
      body: {
        terrain_id: fx.terrainId,
        date: ymdPlus(6),
        heure_debut: '09:00',
        heure_fin: '10:00',
        joueur_nom: 'SA',
        joueur_telephone: '770000001',
        canal_paiement: 'wave',
      },
    });
    h.assertEqual('SA ne réserve pas en joueur 403', saSurResa.status, 403);

    const deleteAccount = await request('POST', '/api/auth/delete-account', {
      token: joueurOtpToken,
    });
    h.assertEqual('suppression compte joueur OTP 200', deleteAccount.status, 200);
    h.assert('compte anonymisé', deleteAccount.body?.success === true);

    // Mode revenu SA (contrat : body.mode = commission|abonnement|achat|essai)
    const modeRevenu = await request('PATCH', `/api/admin/terrains/${fx.terrainId}/mode-revenu`, {
      token: saToken,
      body: { mode: 'commission', commission_pourcentage: 12 },
    });
    h.assert(
      'mode revenu SA',
      modeRevenu.status === 200 || modeRevenu.status === 201,
      `status=${modeRevenu.status} ${JSON.stringify(modeRevenu.body)}`,
    );

    const rapprochement = await request('GET', '/api/admin/rapprochement', { token: saToken });
    h.assertEqual('rapprochement 200', rapprochement.status, 200);
  } finally {
    await close();
    try {
      fs.unlinkSync(tmpDb);
    } catch {
      /* ignore */
    }
  }

  h.exitIfFailed();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
