/**
 * Tests d'intégration HTTP — tous rôles (mini Express + SQLite tmp).
 * Couvre : public, auth joueur/gérant/proprio/SA, authz négatives, stages gérant.
 * Usage: node scripts/test-integration-api-tous-roles.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');

const tmpDb = path.join(os.tmpdir(), `terrainsn-int-roles-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.WHATSAPP_MOCK = 'true';
process.env.PAYMENT_MODE = 'simulation';
process.env.JWT_SECRET = 'integration_roles_jwt_secret';
process.env.JWT_REFRESH_SECRET = 'integration_roles_jwt_refresh';

const { createHarness } = require('../test/helpers/harness');
const { getDb, runSql, queryOne, queryAll, transaction } = require('../database');
const { genererAccessToken, middlewareAuth, requireRole } = require('../middleware/auth');
const { calculerDevis } = require('../pricingService');
const { lockCreneauxAtomique, confirmerCreneauxReservation } = require('../reservationLockService');
const { seedMohamedCompte } = require('../test/helpers/dbFixtures');
const {
  assertStageTransition,
  resolveOperationalStage,
} = require('../services/kanbanRules');
const { encaisserSoldeSurPlace } = require('../services/portefeuilleService');
const { confirmerManuellement } = require('../services/detteCommissionService');
const { chargerContrat } = require('../services/contratService');
const { creerDuApresPayin, portefeuilleTerrain } = require('../services/ledgerService');
const { ownerRevenueRowsSql, summarizeOwnerRevenue, periodStart } = require('../ownerRevenueService');
const { applyMode, resolveMode } = require('../services/modeRevenuService');

const h = createHarness('integration-api-tous-roles');

function request(baseUrl, method, urlPath, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, baseUrl);
    const payload = body != null ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = { raw: data };
          }
          resolve({ status: res.statusCode, body: json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cardFromResa(resa, extras = {}) {
  return {
    stage: resolveOperationalStage(resa),
    statut: resa.statut,
    date: resa.date,
    heure_debut: resa.heure_debut,
    heure_fin: resa.heure_fin,
    fenetre_retard: 30,
    checked_in_at: resa.checked_in_at || null,
    montant_restant: Number(resa.montant_restant || 0),
    crm: { bloqueReservation: false },
    ...extras,
  };
}

async function demarrerApp() {
  const app = express();
  app.use(express.json());

  // —— Public ——
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'terrainsn' }));

  app.get('/api/terrains', async (_req, res) => {
    const db = await getDb();
    const rows = queryAll(
      db,
      'SELECT id, nom, ville, prix_entier, is_active FROM terrains WHERE is_active = 1',
    );
    res.json(rows);
  });

  app.get('/api/terrains/:id', async (req, res) => {
    const db = await getDb();
    const t = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Terrain introuvable' });
    res.json(t);
  });

  app.get('/api/terrains/:id/devis', async (req, res) => {
    try {
      const db = await getDb();
      const t = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [req.params.id]);
      if (!t) return res.status(404).json({ error: 'Terrain introuvable' });
      const devis = calculerDevis(db, t, {
        date: req.query.date,
        heure_debut: req.query.heure_debut,
        heure_fin: req.query.heure_fin,
        format_terrain: req.query.format || 'entier',
      });
      res.json(devis);
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  app.get('/api/terrains/:id/creneaux', async (req, res) => {
    const db = await getDb();
    const t = queryOne(db, 'SELECT id FROM terrains WHERE id = ? AND is_active = 1', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Terrain introuvable' });
    const date = req.query.date;
    const rows = date
      ? queryAll(db, 'SELECT * FROM creneaux WHERE terrain_id = ? AND date = ? ORDER BY heure_debut', [
          req.params.id,
          date,
        ])
      : queryAll(db, 'SELECT * FROM creneaux WHERE terrain_id = ? ORDER BY date, heure_debut LIMIT 100', [
          req.params.id,
        ]);
    res.json(rows);
  });

  // —— Auth login stub ——
  app.post('/api/auth/login-test', async (req, res) => {
    const db = await getDb();
    const { email } = req.body || {};
    const user = queryOne(db, 'SELECT * FROM users WHERE email = ?', [email]);
    if (user) {
      const token = genererAccessToken({
        id: user.id,
        role: user.role,
        email: user.email,
        telephone: user.telephone,
        accountType: 'user',
      });
      return res.json({ token, role: user.role, accountType: 'user' });
    }
    const emp = queryOne(db, 'SELECT * FROM employes WHERE email = ?', [email]);
    if (emp) {
      const token = genererAccessToken({
        id: emp.id,
        role: 'gerant',
        email: emp.email,
        telephone: emp.telephone,
        terrain_id: emp.terrain_id,
        proprietaire_id: emp.proprietaire_id,
        accountType: 'employe',
      });
      return res.json({ token, role: 'gerant', accountType: 'employe' });
    }
    const proprio = queryOne(db, 'SELECT * FROM proprietaires WHERE email = ?', [email]);
    if (proprio) {
      const token = genererAccessToken({
        id: proprio.id,
        role: 'proprietaire',
        email: proprio.email,
        telephone: proprio.telephone,
        accountType: 'proprietaire',
      });
      return res.json({ token, role: 'proprietaire', accountType: 'proprietaire' });
    }
    return res.status(401).json({ error: 'Identifiants invalides' });
  });

  // —— Joueur protégé ——
  app.get('/api/joueur/mes-reservations', middlewareAuth, async (req, res) => {
    if (req.user.role !== 'joueur' && req.user.accountType !== 'user') {
      return res.status(403).json({ error: 'Réservé aux joueurs' });
    }
    if (req.user.role === 'super_admin' || req.user.role === 'superadmin') {
      return res.status(403).json({ error: 'Réservé aux joueurs' });
    }
    const db = await getDb();
    const rows = queryAll(
      db,
      `SELECT id, terrain_id, date, heure_debut, heure_fin, statut, montant, montant_avance, operational_stage
       FROM reservations WHERE joueur_id = ? ORDER BY id DESC`,
      [req.user.id],
    );
    res.json(rows);
  });

  app.post('/api/reservations', middlewareAuth, async (req, res) => {
    try {
      if (req.user.role !== 'joueur' && req.user.accountType !== 'user') {
        return res.status(403).json({ error: 'Réservation joueur uniquement' });
      }
      if (['super_admin', 'superadmin', 'proprietaire', 'gerant'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Réservation joueur uniquement' });
      }
      const db = await getDb();
      const { terrain_id, date, heure_debut, heure_fin, format_terrain } = req.body || {};
      const t = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrain_id]);
      if (!t) return res.status(404).json({ error: 'Terrain introuvable' });
      const devis = calculerDevis(db, t, { date, heure_debut, heure_fin, format_terrain });
      let creneauId;
      transaction(db, () => {
        creneauId = lockCreneauxAtomique(db, terrain_id, date, heure_debut, heure_fin);
      });
      const id = runSql(
        db,
        `INSERT INTO reservations (
          terrain_id, joueur_id, joueur_nom, date, heure_debut, heure_fin,
          montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant,
          statut, creneau_id, format_terrain, operational_stage
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?, ?, 'reserved')`,
        [
          terrain_id,
          req.user.id,
          req.user.email || 'joueur',
          date,
          heure_debut,
          heure_fin,
          devis.montant,
          devis.montant,
          devis.montant_avance,
          devis.montant_avance,
          devis.montant_restant,
          devis.montant_restant,
          creneauId,
          format_terrain || 'entier',
        ],
      ).lastInsertRowid;
      res.status(201).json({ id, ...devis, creneau_id: creneauId, statut: 'en_attente' });
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message, code: e.code });
    }
  });

  app.post('/api/reservations/:id/confirmer-paiement', middlewareAuth, async (req, res) => {
    try {
      const db = await getDb();
      const resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ? AND joueur_id = ?', [
        req.params.id,
        req.user.id,
      ]);
      if (!resa) return res.status(404).json({ error: 'Réservation introuvable' });
      if (resa.statut !== 'en_attente') {
        return res.status(409).json({ error: 'Déjà traitée' });
      }
      runSql(
        db,
        `UPDATE reservations SET statut = 'confirme', operational_stage = 'reserved',
          confirme_at = CURRENT_TIMESTAMP, reference_paytech = ?, qr_code_payload = ?
         WHERE id = ?`,
        [`SIM-INT-${resa.id}`, `QR-INT-${resa.id}`, resa.id],
      );
      confirmerCreneauxReservation(db, resa);
      const updated = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [resa.id]);
      const contrat = chargerContrat(db, updated.terrain_id);
      const du = creerDuApresPayin(db, { reservation: updated, contrat });
      res.json({ reservation: updated, du });
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  // —— Gérant ——
  app.get('/api/gerant/me', middlewareAuth, requireRole('gerant', 'employe'), (req, res) => {
    res.json({
      id: req.user.id,
      role: req.user.role,
      terrain_id: req.user.terrain_id,
      accountType: req.user.accountType,
    });
  });

  app.get('/api/gerant/dashboard', middlewareAuth, requireRole('gerant', 'employe'), async (req, res) => {
    const db = await getDb();
    const terrainId = req.user.terrain_id;
    const reservations = queryAll(
      db,
      `SELECT id, date, heure_debut, statut, operational_stage, montant, montant_restant
       FROM reservations WHERE terrain_id = ? ORDER BY date DESC, heure_debut DESC LIMIT 50`,
      [terrainId],
    );
    const wallet = portefeuilleTerrain(db, terrainId, req.user.id);
    res.json({
      terrain_id: terrainId,
      nb_reservations: reservations.length,
      reservations,
      portefeuille: wallet,
    });
  });

  app.get('/api/gerant/reservations', middlewareAuth, requireRole('gerant', 'employe'), async (req, res) => {
    const db = await getDb();
    const rows = queryAll(
      db,
      `SELECT * FROM reservations WHERE terrain_id = ? ORDER BY id DESC`,
      [req.user.terrain_id],
    );
    res.json(rows);
  });

  app.post(
    '/api/gerant/reservations/:id/confirmer-manuellement',
    middlewareAuth,
    requireRole('gerant', 'employe'),
    async (req, res) => {
      try {
        const db = await getDb();
        const result = transaction(db, () =>
          confirmerManuellement(db, {
            reservationId: Number(req.params.id),
            gerantId: req.user.id,
            note: req.body?.note || 'Confirmation manuelle API',
          }),
        );
        res.json(result);
      } catch (e) {
        res.status(e.statusCode || 500).json({ error: e.message });
      }
    },
  );

  app.post(
    '/api/gerant/reservations/:id/stage',
    middlewareAuth,
    requireRole('gerant', 'employe'),
    async (req, res) => {
      try {
        const db = await getDb();
        const stage = req.body?.stage;
        const now = req.body?.now ? new Date(req.body.now).getTime() : Date.now();
        const row = queryOne(db, 'SELECT * FROM reservations WHERE id = ? AND terrain_id = ?', [
          req.params.id,
          req.user.terrain_id,
        ]);
        if (!row) return res.status(404).json({ error: 'Réservation introuvable' });
        if (stage === 'closed' && Number(row.montant_restant || 0) > 0 && req.body?.encaisserRestant) {
          encaisserSoldeSurPlace(db, row, req.user.id, req.body?.methode || 'especes');
        }
        const refreshed = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [row.id]);
        assertStageTransition(cardFromResa(refreshed), stage, now);
        runSql(db, 'UPDATE reservations SET operational_stage = ? WHERE id = ?', [stage, row.id]);
        if (stage === 'checkin') {
          runSql(
            db,
            `UPDATE reservations SET checked_in_at = ?, qr_code_scanne_at = COALESCE(qr_code_scanne_at, ?)
             WHERE id = ?`,
            [new Date(now).toISOString(), new Date(now).toISOString(), row.id],
          );
        }
        const updated = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [row.id]);
        res.json({ ok: true, stage: resolveOperationalStage(updated), reservation: updated });
      } catch (e) {
        res.status(e.statusCode || 400).json({ error: e.message, code: e.code });
      }
    },
  );

  app.post(
    '/api/gerant/reservations/:id/encaisser',
    middlewareAuth,
    requireRole('gerant', 'employe'),
    async (req, res) => {
      try {
        const db = await getDb();
        const row = queryOne(db, 'SELECT * FROM reservations WHERE id = ? AND terrain_id = ?', [
          req.params.id,
          req.user.terrain_id,
        ]);
        if (!row) return res.status(404).json({ error: 'Réservation introuvable' });
        const solde = Number(row.reste_a_payer ?? row.montant_restant ?? 0);
        if (solde <= 0) return res.status(400).json({ error: 'Aucun reste à encaisser' });
        const montant = transaction(db, () => encaisserSoldeSurPlace(db, row, req.user.id, req.body?.methode || 'especes'));
        res.json({ ok: true, montant });
      } catch (e) {
        res.status(e.statusCode || 500).json({ error: e.message });
      }
    },
  );

  app.get('/api/gerant/portefeuille', middlewareAuth, requireRole('gerant', 'employe'), async (req, res) => {
    const db = await getDb();
    const wallet = portefeuilleTerrain(db, req.user.terrain_id, req.user.id);
    res.json(wallet);
  });

  // —— Propriétaire ——
  app.get('/api/proprietaire/me', middlewareAuth, requireRole('proprietaire'), (req, res) => {
    res.json({ id: req.user.id, role: req.user.role, accountType: req.user.accountType });
  });

  app.get('/api/proprietaire/terrains', middlewareAuth, requireRole('proprietaire'), async (req, res) => {
    const db = await getDb();
    const rows = queryAll(
      db,
      `SELECT id, nom, ville, modele_revenus, commission_pourcentage, is_active
       FROM terrains WHERE proprietaire_id = ?`,
      [req.user.id],
    );
    res.json(rows);
  });

  app.get('/api/proprietaire/revenus', middlewareAuth, requireRole('proprietaire'), async (req, res) => {
    const db = await getDb();
    const start = periodStart(req.query.period || 'annee');
    // Param order: dateWhere in JOIN before ownerWhere in WHERE
    const rows = queryAll(db, ownerRevenueRowsSql({ dateWhere: 'AND r.date >= ?' }), [start, req.user.id]);
    res.json({ terrains: rows, summary: summarizeOwnerRevenue(rows) });
  });

  // —— Super admin ——
  app.get('/api/admin/ping', middlewareAuth, requireRole('super_admin'), (_req, res) => {
    res.json({ ok: true, role: 'super_admin' });
  });

  app.get('/api/admin/terrains', middlewareAuth, requireRole('super_admin'), async (_req, res) => {
    const db = await getDb();
    const rows = queryAll(
      db,
      `SELECT t.id, t.nom, t.ville, t.is_active, t.modele_revenus, t.commission_pourcentage,
              p.nom AS proprietaire_nom
       FROM terrains t
       LEFT JOIN proprietaires p ON p.id = t.proprietaire_id
       ORDER BY t.id DESC`,
    );
    res.json(rows);
  });

  app.get('/api/admin/users', middlewareAuth, requireRole('super_admin'), async (_req, res) => {
    const db = await getDb();
    const users = queryAll(db, 'SELECT id, email, role, is_active FROM users ORDER BY id DESC LIMIT 50');
    const employes = queryAll(db, 'SELECT id, email, terrain_id, is_active FROM employes ORDER BY id DESC LIMIT 50');
    const proprietaires = queryAll(
      db,
      'SELECT id, email, statut FROM proprietaires ORDER BY id DESC LIMIT 50',
    );
    res.json({ users, employes, proprietaires });
  });

  app.get('/api/admin/proprietaires', middlewareAuth, requireRole('super_admin'), async (_req, res) => {
    const db = await getDb();
    res.json(queryAll(db, 'SELECT id, nom, email, telephone, statut FROM proprietaires ORDER BY id DESC'));
  });

  app.get('/api/admin/superadmins', middlewareAuth, requireRole('super_admin'), async (_req, res) => {
    const db = await getDb();
    res.json(
      queryAll(
        db,
        `SELECT id, nom, email, telephone, role, is_active FROM users
         WHERE role IN ('super_admin', 'superadmin') ORDER BY id ASC`,
      ),
    );
  });

  app.get('/api/admin/terrains/:id/gerants', middlewareAuth, requireRole('super_admin'), async (req, res) => {
    const db = await getDb();
    const gerants = queryAll(
      db,
      `SELECT e.id, e.nom, e.telephone, e.is_active AS actif, 1 AS est_principal
       FROM employes e WHERE e.terrain_id = ?`,
      [req.params.id],
    );
    res.json({ gerants, garde_actuelle: gerants[0] || null, planning: [] });
  });

  app.get('/api/gerant/terrains', middlewareAuth, requireRole('gerant'), async (req, res) => {
    const db = await getDb();
    const terrain = queryOne(db, 'SELECT id, nom FROM terrains WHERE id = ?', [req.user.terrain_id]);
    res.json({
      terrains: terrain ? [{ id: terrain.id, nom: terrain.nom, est_principal: 1 }] : [],
      terrain_actif: terrain ? terrain.id : null,
    });
  });

  app.post('/api/gerant/heartbeat', middlewareAuth, requireRole('gerant'), async (req, res) => {
    res.json({ ok: true, terrain_id: Number(req.body?.terrain_id || req.user.terrain_id) || null });
  });

  app.post('/api/admin/terrains/:id/mode-revenu', middlewareAuth, requireRole('super_admin'), async (req, res) => {
    try {
      const db = await getDb();
      const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [req.params.id]);
      if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
      const updated = applyMode(db, terrain, req.body || {}, req.user.id);
      res.json({ terrain: updated, mode: resolveMode(updated) });
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function main() {
  const db = await getDb();
  const passwordHash = await bcrypt.hash('password123', 8);
  const fx = seedMohamedCompte(db);
  runSql(db, 'UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, fx.joueurId]);
  runSql(db, 'UPDATE employes SET password_hash = ? WHERE id = ?', [passwordHash, fx.gerantId]);
  runSql(db, 'UPDATE proprietaires SET password_hash = ? WHERE id = ?', [passwordHash, fx.proprioId]);

  const saId = runSql(
    db,
    `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active)
     VALUES ('Admin', 'SA', 'sa.roles@test.sn', ?, '221700000077', 'super_admin', 1)`,
    [passwordHash],
  ).lastInsertRowid;

  const joueurEmail = queryOne(db, 'SELECT email FROM users WHERE id = ?', [fx.joueurId]).email;
  const gerantEmail = queryOne(db, 'SELECT email FROM employes WHERE id = ?', [fx.gerantId]).email;
  const proprioEmail = queryOne(db, 'SELECT email FROM proprietaires WHERE id = ?', [fx.proprioId]).email;

  const { baseUrl, close } = await demarrerApp();

  try {
    // —— Public ——
    const health = await request(baseUrl, 'GET', '/health');
    h.assertEqual('INT health 200', health.status, 200);
    h.assert('INT health ok', health.body?.ok === true);

    const terrains = await request(baseUrl, 'GET', '/api/terrains');
    h.assertEqual('INT terrains 200', terrains.status, 200);
    h.assert('INT ≥1 terrain', Array.isArray(terrains.body) && terrains.body.length >= 1);

    const fiche = await request(baseUrl, 'GET', `/api/terrains/${fx.terrainId}`);
    h.assertEqual('INT fiche 200', fiche.status, 200);
    h.assertEqual('INT fiche nom', fiche.body.nom, 'Arena Mohamed Parcelles');

    const devis = await request(
      baseUrl,
      'GET',
      `/api/terrains/${fx.terrainId}/devis?date=2026-12-10&heure_debut=18:00&heure_fin=19:00&format=entier`,
    );
    h.assertEqual('INT devis 200', devis.status, 200);
    h.assertEqual('INT devis montant', devis.body.montant, 40000);
    h.assertEqual('INT devis avance', devis.body.montant_avance, 5000);

    const creneaux = await request(
      baseUrl,
      'GET',
      `/api/terrains/${fx.terrainId}/creneaux?date=2026-12-10`,
    );
    h.assertEqual('INT creneaux 200', creneaux.status, 200);
    h.assert('INT creneaux array', Array.isArray(creneaux.body));

    const badDevis = await request(
      baseUrl,
      'GET',
      `/api/terrains/${fx.terrainId}/devis?date=2026-12-10&heure_debut=18:00&heure_fin=18:00`,
    );
    h.assertEqual('INT devis invalide 400', badDevis.status, 400);

    // —— Auth joueur ——
    const loginJ = await request(baseUrl, 'POST', '/api/auth/login-test', {
      body: { email: joueurEmail },
    });
    h.assertEqual('INT login joueur', loginJ.status, 200);
    h.assert('INT token joueur', Boolean(loginJ.body.token));
    const jToken = loginJ.body.token;

    const resa = await request(baseUrl, 'POST', '/api/reservations', {
      token: jToken,
      body: {
        terrain_id: fx.terrainId,
        date: '2026-12-10',
        heure_debut: '18:00',
        heure_fin: '19:00',
        format_terrain: 'entier',
      },
    });
    h.assertEqual('INT résa 201', resa.status, 201);
    h.assertEqual('INT résa en_attente', resa.body.statut, 'en_attente');
    h.assertEqual('INT résa avance', resa.body.montant_avance, 5000);
    const resaId = resa.body.id;

    const confirm = await request(baseUrl, 'POST', `/api/reservations/${resaId}/confirmer-paiement`, {
      token: jToken,
    });
    h.assertEqual('INT confirm paiement 200', confirm.status, 200);
    h.assertEqual('INT confirm statut', confirm.body.reservation.statut, 'confirme');
    h.assert('INT confirm du', Boolean(confirm.body.du));

    const mesResas = await request(baseUrl, 'GET', '/api/joueur/mes-reservations', { token: jToken });
    h.assertEqual('INT mes-reservations 200', mesResas.status, 200);
    h.assert('INT mes-reservations ≥1', Array.isArray(mesResas.body) && mesResas.body.length >= 1);
    h.assert(
      'INT mes-reservations contient confirmée',
      mesResas.body.some((r) => r.id === resaId && r.statut === 'confirme'),
    );

    // Double booking
    const resa2 = await request(baseUrl, 'POST', '/api/reservations', {
      token: jToken,
      body: {
        terrain_id: fx.terrainId,
        date: '2026-12-10',
        heure_debut: '18:00',
        heure_fin: '19:00',
        format_terrain: 'entier',
      },
    });
    h.assertEqual('INT double booking 409', resa2.status, 409);
    h.assertEqual('INT code conflit', resa2.body.code, 'CRENEAU_CONFLIT');

    // —— 401 sans token ——
    const noAuthResa = await request(baseUrl, 'POST', '/api/reservations', {
      body: { terrain_id: fx.terrainId, date: '2026-12-11', heure_debut: '10:00', heure_fin: '11:00' },
    });
    h.assertEqual('INT résa sans auth 401', noAuthResa.status, 401);

    const noAuthGerant = await request(baseUrl, 'GET', '/api/gerant/me');
    h.assertEqual('INT gerant sans auth 401', noAuthGerant.status, 401);

    const noAuthAdmin = await request(baseUrl, 'GET', '/api/admin/ping');
    h.assertEqual('INT admin sans auth 401', noAuthAdmin.status, 401);

    const noAuthMes = await request(baseUrl, 'GET', '/api/joueur/mes-reservations');
    h.assertEqual('INT mes-resa sans auth 401', noAuthMes.status, 401);

    // —— Auth gérant ——
    const loginG = await request(baseUrl, 'POST', '/api/auth/login-test', {
      body: { email: gerantEmail },
    });
    h.assertEqual('INT login gerant', loginG.status, 200);
    const gToken = loginG.body.token;

    const gerantMe = await request(baseUrl, 'GET', '/api/gerant/me', { token: gToken });
    h.assertEqual('INT gerant me 200', gerantMe.status, 200);
    h.assertEqual('INT gerant terrain', gerantMe.body.terrain_id, fx.terrainId);

    const dash = await request(baseUrl, 'GET', '/api/gerant/dashboard', { token: gToken });
    h.assertEqual('INT gerant dashboard 200', dash.status, 200);
    h.assert('INT dashboard résas', Array.isArray(dash.body.reservations));
    h.assert('INT dashboard portefeuille', Boolean(dash.body.portefeuille));

    const gResas = await request(baseUrl, 'GET', '/api/gerant/reservations', { token: gToken });
    h.assertEqual('INT gerant résas 200', gResas.status, 200);
    h.assert('INT gerant voit résa joueur', gResas.body.some((r) => r.id === resaId));

    // Stage check-in (dans fenêtre)
    const stageCheckin = await request(baseUrl, 'POST', `/api/gerant/reservations/${resaId}/stage`, {
      token: gToken,
      body: { stage: 'checkin', now: '2026-12-10T17:45:00' },
    });
    h.assertEqual('INT stage checkin 200', stageCheckin.status, 200);
    h.assertEqual('INT stage = checkin', stageCheckin.body.stage, 'checkin');

    const stageMatch = await request(baseUrl, 'POST', `/api/gerant/reservations/${resaId}/stage`, {
      token: gToken,
      body: { stage: 'match', now: '2026-12-10T18:10:00' },
    });
    h.assertEqual('INT stage match 200', stageMatch.status, 200);

    const stageCheckout = await request(baseUrl, 'POST', `/api/gerant/reservations/${resaId}/stage`, {
      token: gToken,
      body: { stage: 'checkout', now: '2026-12-10T18:30:00' },
    });
    h.assertEqual('INT stage checkout 200', stageCheckout.status, 200);

    const encaisser = await request(baseUrl, 'POST', `/api/gerant/reservations/${resaId}/encaisser`, {
      token: gToken,
      body: { methode: 'especes' },
    });
    h.assertEqual('INT encaisser 200', encaisser.status, 200);
    h.assertEqual('INT encaisser montant', encaisser.body.montant, 35000);

    const stageClosed = await request(baseUrl, 'POST', `/api/gerant/reservations/${resaId}/stage`, {
      token: gToken,
      body: { stage: 'closed', now: '2026-12-10T19:05:00' },
    });
    h.assertEqual('INT stage closed 200', stageClosed.status, 200);
    h.assertEqual('INT stage = closed', stageClosed.body.stage, 'closed');

    const portefeuille = await request(baseUrl, 'GET', '/api/gerant/portefeuille', { token: gToken });
    h.assertEqual('INT portefeuille 200', portefeuille.status, 200);
    h.assert('INT portefeuille avances', Number(portefeuille.body.total_avances) >= 5000);

    // Confirmation manuelle (autre créneau)
    const resaManuelle = await request(baseUrl, 'POST', '/api/reservations', {
      token: jToken,
      body: {
        terrain_id: fx.terrainId,
        date: '2026-12-11',
        heure_debut: '10:00',
        heure_fin: '11:00',
        format_terrain: 'entier',
      },
    });
    h.assertEqual('INT résa manuelle 201', resaManuelle.status, 201);
    const manuel = await request(
      baseUrl,
      'POST',
      `/api/gerant/reservations/${resaManuelle.body.id}/confirmer-manuellement`,
      { token: gToken, body: { note: 'Cash reçu' } },
    );
    h.assertEqual('INT confirmer manuel 200', manuel.status, 200);
    h.assert('INT manuel code', Boolean(manuel.body.code));
    h.assertEqual('INT manuel commission', manuel.body.commission, 500);

    // —— Auth propriétaire ——
    const loginP = await request(baseUrl, 'POST', '/api/auth/login-test', {
      body: { email: proprioEmail },
    });
    h.assertEqual('INT login proprio', loginP.status, 200);
    const pToken = loginP.body.token;

    const proprioMe = await request(baseUrl, 'GET', '/api/proprietaire/me', { token: pToken });
    h.assertEqual('INT proprio me 200', proprioMe.status, 200);
    h.assertEqual('INT proprio id', proprioMe.body.id, fx.proprioId);

    const pTerrains = await request(baseUrl, 'GET', '/api/proprietaire/terrains', { token: pToken });
    h.assertEqual('INT proprio terrains 200', pTerrains.status, 200);
    h.assert('INT proprio voit terrain', pTerrains.body.some((t) => t.id === fx.terrainId));

    const pRevenus = await request(baseUrl, 'GET', '/api/proprietaire/revenus?period=annee', {
      token: pToken,
    });
    h.assertEqual('INT proprio revenus 200', pRevenus.status, 200);
    h.assert('INT proprio summary résas', Number(pRevenus.body.summary?.reservations) >= 1);
    h.assert('INT proprio avances > 0', Number(pRevenus.body.summary?.avances_encaissees) >= 5000);

    // —— Super admin ——
    const saToken = genererAccessToken({
      id: saId,
      role: 'super_admin',
      email: 'sa.roles@test.sn',
      accountType: 'user',
    });
    const adminPing = await request(baseUrl, 'GET', '/api/admin/ping', { token: saToken });
    h.assertEqual('INT SA ping 200', adminPing.status, 200);

    const adminTerrains = await request(baseUrl, 'GET', '/api/admin/terrains', { token: saToken });
    h.assertEqual('INT SA terrains 200', adminTerrains.status, 200);
    h.assert('INT SA voit terrain', adminTerrains.body.some((t) => t.id === fx.terrainId));

    const adminUsers = await request(baseUrl, 'GET', '/api/admin/users', { token: saToken });
    h.assertEqual('INT SA users 200', adminUsers.status, 200);
    h.assert('INT SA users list', Array.isArray(adminUsers.body.users));
    h.assert('INT SA employes list', Array.isArray(adminUsers.body.employes));

    const adminProprio = await request(baseUrl, 'GET', '/api/admin/proprietaires', { token: saToken });
    h.assertEqual('INT SA proprietaires 200', adminProprio.status, 200);
    h.assert('INT SA proprietaires list', Array.isArray(adminProprio.body) && adminProprio.body.length > 0);

    const adminSA = await request(baseUrl, 'GET', '/api/admin/superadmins', { token: saToken });
    h.assertEqual('INT SA superadmins 200', adminSA.status, 200);
    h.assert('INT SA superadmins list', Array.isArray(adminSA.body));

    const adminGerants = await request(baseUrl, 'GET', `/api/admin/terrains/${fx.terrainId}/gerants`, {
      token: saToken,
    });
    h.assertEqual('INT SA terrain gerants 200', adminGerants.status, 200);
    h.assert('INT SA terrain gerants array', Array.isArray(adminGerants.body.gerants));

    const gerantTerrains = await request(baseUrl, 'GET', '/api/gerant/terrains', { token: gToken });
    h.assertEqual('INT gerant terrains 200', gerantTerrains.status, 200);
    h.assert('INT gerant voit son terrain', gerantTerrains.body.terrains?.some((t) => t.id === fx.terrainId));

    const hb = await request(baseUrl, 'POST', '/api/gerant/heartbeat', {
      token: gToken,
      body: { terrain_id: fx.terrainId },
    });
    h.assertEqual('INT gerant heartbeat 200', hb.status, 200);
    h.assert('INT gerant heartbeat ok', hb.body.ok === true);

    const modeAbo = await request(baseUrl, 'POST', `/api/admin/terrains/${fx.terrainId}/mode-revenu`, {
      token: saToken,
      body: { mode: 'abonnement', abonnement_montant: 60000, note: 'test SA' },
    });
    h.assertEqual('INT SA mode abo 200', modeAbo.status, 200);
    h.assertEqual('INT SA mode = abonnement', modeAbo.body.mode, 'abonnement');

    const modeRest = await request(baseUrl, 'POST', `/api/admin/terrains/${fx.terrainId}/mode-revenu`, {
      token: saToken,
      body: { mode: 'commission', commission_pourcentage: 10 },
    });
    h.assertEqual('INT SA restore commission', modeRest.body.mode, 'commission');

    // —— Authz négatives ——
    const joueurDenyGerant = await request(baseUrl, 'GET', '/api/gerant/me', { token: jToken });
    h.assertEqual('INT joueur refus gerant 403', joueurDenyGerant.status, 403);

    const joueurDenyAdmin = await request(baseUrl, 'GET', '/api/admin/ping', { token: jToken });
    h.assertEqual('INT joueur refus admin 403', joueurDenyAdmin.status, 403);

    const joueurDenyProprio = await request(baseUrl, 'GET', '/api/proprietaire/terrains', {
      token: jToken,
    });
    h.assertEqual('INT joueur refus proprio 403', joueurDenyProprio.status, 403);

    const gerantDenyAdmin = await request(baseUrl, 'GET', '/api/admin/ping', { token: gToken });
    h.assertEqual('INT gerant refus admin 403', gerantDenyAdmin.status, 403);

    const gerantDenyProprio = await request(baseUrl, 'GET', '/api/proprietaire/me', { token: gToken });
    h.assertEqual('INT gerant refus proprio 403', gerantDenyProprio.status, 403);

    const proprioDenyGerant = await request(baseUrl, 'GET', '/api/gerant/dashboard', { token: pToken });
    h.assertEqual('INT proprio refus gerant 403', proprioDenyGerant.status, 403);

    const proprioDenyAdmin = await request(baseUrl, 'GET', '/api/admin/users', { token: pToken });
    h.assertEqual('INT proprio refus admin 403', proprioDenyAdmin.status, 403);

    const saDenyGerant = await request(baseUrl, 'GET', '/api/gerant/me', { token: saToken });
    h.assertEqual('INT SA refus gerant 403', saDenyGerant.status, 403);
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
