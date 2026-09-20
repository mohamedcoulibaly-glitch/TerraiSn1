/**
 * Tests d'intégration — parcours HTTP API (mini Express + SQLite tmp).
 * Couvre : terrains publics, devis, auth JWT, lock conflit via services montés.
 * Usage: node scripts/test-integration-api-parcours.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');

const tmpDb = path.join(os.tmpdir(), `terrainsn-int-api-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.WHATSAPP_MOCK = 'true';
process.env.PAYMENT_MODE = 'simulation';
process.env.JWT_SECRET = 'integration_jwt_secret';
process.env.JWT_REFRESH_SECRET = 'integration_jwt_refresh';

const { createHarness } = require('../test/helpers/harness');
const { getDb, runSql, queryOne, transaction } = require('../database');
const { genererAccessToken, middlewareAuth, requireRole } = require('../middleware/auth');
const { calculerDevis } = require('../pricingService');
const { lockCreneauxAtomique } = require('../reservationLockService');
const { seedMohamedCompte } = require('../test/helpers/dbFixtures');

const h = createHarness('integration-api-parcours');

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

async function demarrerApp(fx) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/terrains', async (_req, res) => {
    const db = await getDb();
    const rows = require('../database').queryAll(
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

  app.post('/api/reservations', middlewareAuth, async (req, res) => {
    try {
      if (req.user.role !== 'joueur' && req.user.accountType !== 'user') {
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
          statut, creneau_id, format_terrain
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?, ?)`,
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

  app.get('/api/gerant/me', middlewareAuth, requireRole('gerant', 'employe'), (req, res) => {
    res.json({ id: req.user.id, role: req.user.role, terrain_id: req.user.terrain_id });
  });

  app.get('/api/admin/ping', middlewareAuth, requireRole('super_admin'), (_req, res) => {
    res.json({ ok: true, role: 'super_admin' });
  });

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
      return res.json({ token, role: user.role });
    }
    const emp = queryOne(db, 'SELECT * FROM employes WHERE email = ?', [email]);
    if (emp) {
      const token = genererAccessToken({
        id: emp.id,
        role: 'gerant',
        email: emp.email,
        telephone: emp.telephone,
        terrain_id: emp.terrain_id,
        accountType: 'employe',
      });
      return res.json({ token, role: 'gerant' });
    }
    return res.status(401).json({ error: 'Identifiants invalides' });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve)),
    fx,
  };
}

async function main() {
  const db = await getDb();
  const passwordHash = await bcrypt.hash('password123', 8);
  const fx = seedMohamedCompte(db);
  runSql(db, 'UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, fx.joueurId]);
  runSql(db, 'UPDATE employes SET password_hash = ? WHERE id = ?', [passwordHash, fx.gerantId]);

  // Super admin
  const saId = runSql(
    db,
    `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active)
     VALUES ('Admin', 'SA', 'sa@test.sn', ?, '221700000099', 'super_admin', 1)`,
    [passwordHash],
  ).lastInsertRowid;

  const { baseUrl, close } = await demarrerApp(fx);

  try {
    // Health
    const health = await request(baseUrl, 'GET', '/health');
    h.assertEqual('INT health', health.status, 200);

    // Liste terrains publics
    const terrains = await request(baseUrl, 'GET', '/api/terrains');
    h.assertEqual('INT terrains 200', terrains.status, 200);
    h.assert('INT au moins 1 terrain', Array.isArray(terrains.body) && terrains.body.length >= 1);

    // Fiche + devis
    const fiche = await request(baseUrl, 'GET', `/api/terrains/${fx.terrainId}`);
    h.assertEqual('INT fiche 200', fiche.status, 200);
    h.assertEqual('INT fiche nom', fiche.body.nom, 'Arena Mohamed Parcelles');

    const devis = await request(
      baseUrl,
      'GET',
      `/api/terrains/${fx.terrainId}/devis?date=2026-12-01&heure_debut=18:00&heure_fin=19:00&format=entier`,
    );
    h.assertEqual('INT devis 200', devis.status, 200);
    h.assertEqual('INT devis montant', devis.body.montant, 40000);
    h.assertEqual('INT devis avance', devis.body.montant_avance, 5000);

    // Auth joueur + réservation
    const loginJ = await request(baseUrl, 'POST', '/api/auth/login-test', {
      body: { email: queryOne(db, 'SELECT email FROM users WHERE id = ?', [fx.joueurId]).email },
    });
    h.assertEqual('INT login joueur', loginJ.status, 200);
    h.assert('INT token joueur', Boolean(loginJ.body.token));

    const resa = await request(baseUrl, 'POST', '/api/reservations', {
      token: loginJ.body.token,
      body: {
        terrain_id: fx.terrainId,
        date: '2026-12-01',
        heure_debut: '18:00',
        heure_fin: '19:00',
        format_terrain: 'entier',
      },
    });
    h.assertEqual('INT résa créée', resa.status, 201);
    h.assertEqual('INT résa en_attente', resa.body.statut, 'en_attente');
    h.assertEqual('INT résa avance', resa.body.montant_avance, 5000);

    // Double booking via API
    const resa2 = await request(baseUrl, 'POST', '/api/reservations', {
      token: loginJ.body.token,
      body: {
        terrain_id: fx.terrainId,
        date: '2026-12-01',
        heure_debut: '18:00',
        heure_fin: '19:00',
        format_terrain: 'entier',
      },
    });
    h.assertEqual('INT double booking 409', resa2.status, 409);
    h.assertEqual('INT code conflit', resa2.body.code, 'CRENEAU_CONFLIT');

    // Sans auth
    const noAuth = await request(baseUrl, 'POST', '/api/reservations', {
      body: { terrain_id: fx.terrainId, date: '2026-12-02', heure_debut: '10:00', heure_fin: '11:00' },
    });
    h.assertEqual('INT résa sans auth 401', noAuth.status, 401);

    // Gérant accès
    const loginG = await request(baseUrl, 'POST', '/api/auth/login-test', {
      body: { email: queryOne(db, 'SELECT email FROM employes WHERE id = ?', [fx.gerantId]).email },
    });
    const gerantMe = await request(baseUrl, 'GET', '/api/gerant/me', { token: loginG.body.token });
    h.assertEqual('INT gerant me 200', gerantMe.status, 200);
    h.assertEqual('INT gerant terrain', gerantMe.body.terrain_id, fx.terrainId);

    // Joueur ne peut pas accéder gérant
    const deny = await request(baseUrl, 'GET', '/api/gerant/me', { token: loginJ.body.token });
    h.assertEqual('INT joueur refus gerant', deny.status, 403);

    // Super admin
    const saToken = genererAccessToken({
      id: saId,
      role: 'super_admin',
      email: 'sa@test.sn',
      accountType: 'user',
    });
    const adminPing = await request(baseUrl, 'GET', '/api/admin/ping', { token: saToken });
    h.assertEqual('INT SA ping', adminPing.status, 200);

    const gerantDenyAdmin = await request(baseUrl, 'GET', '/api/admin/ping', { token: loginG.body.token });
    h.assertEqual('INT gerant refus admin', gerantDenyAdmin.status, 403);

    // Devis invalide
    const badDevis = await request(
      baseUrl,
      'GET',
      `/api/terrains/${fx.terrainId}/devis?date=2026-12-01&heure_debut=18:00&heure_fin=18:00`,
    );
    h.assertEqual('INT devis invalide 400', badDevis.status, 400);
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
