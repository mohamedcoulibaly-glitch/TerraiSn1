const { getDb, queryOne, queryAll, runSql } = require('./database');
const { authMiddleware, requireRole } = require('./middleware/auth');
const { playerGate } = require('./services/kanbanRules');

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function displayName(row) {
  const prenom = String(row.prenom || '').trim();
  const nom = String(row.nom || '').trim();
  return [prenom, nom].filter(Boolean).join(' ') || nom || 'Joueur';
}

function mapListRow(row, todayYmd) {
  const solde = Number(row.solde_ouvert || 0);
  const gate = playerGate({
    is_banned: Boolean(row.is_banned),
    solde_ouvert: solde,
    politiqueImpaye: false,
    abonnement: row.abonnement_statut ? { statut: row.abonnement_statut } : null,
  });
  return {
    id: row.id,
    nom: row.nom,
    prenom: row.prenom || null,
    display_nom: displayName(row),
    telephone: row.telephone || null,
    email: row.email || null,
    photo_url: row.photo_url || null,
    is_banned: Boolean(row.is_banned),
    notes_internes: row.notes_internes || null,
    matches_joues: Number(row.matches_joues || 0),
    no_shows: Number(row.no_shows || 0),
    last_match_at: row.last_match_at || null,
    solde_ouvert: solde,
    reservations_30j: Number(row.reservations_30j || 0),
    matches_30j: Number(row.matches_30j || 0),
    assiduite_30j: Number(row.reservations_30j || 0) > 0
      ? Math.round((Number(row.matches_30j || 0) / Number(row.reservations_30j)) * 100)
      : 0,
    crm: gate,
    statut: row.is_banned ? 'banni' : solde > 0 ? 'dette' : 'actif',
    a_joue_aujourd_hui: row.last_match_at === todayYmd,
  };
}

function listJoueursSql(todayYmd, since30) {
  return `
    SELECT
      u.id, u.nom, u.prenom, u.telephone, u.email, u.photo_url,
      COALESCE(u.is_banned, 0) AS is_banned,
      u.notes_internes, u.banned_reason, u.banned_at,
      COUNT(r.id) AS reservations_total,
      SUM(CASE WHEN r.statut IN ('match_joue', 'joue') THEN 1 ELSE 0 END) AS matches_joues,
      SUM(CASE WHEN r.statut = 'confirme' AND r.date < ? THEN 1 ELSE 0 END) AS no_shows,
      MAX(CASE WHEN r.statut IN ('match_joue', 'joue') THEN r.date ELSE NULL END) AS last_match_at,
      SUM(CASE WHEN r.statut IN ('confirme', 'match_joue', 'joue')
        THEN COALESCE(r.montant_restant, r.reste_a_payer, 0) ELSE 0 END) AS solde_ouvert,
      SUM(CASE WHEN r.date >= ? THEN 1 ELSE 0 END) AS reservations_30j,
      SUM(CASE WHEN r.date >= ? AND r.statut IN ('match_joue', 'joue') THEN 1 ELSE 0 END) AS matches_30j
    FROM users u
    INNER JOIN reservations r ON r.joueur_id = u.id
    WHERE r.terrain_id = ?
      AND COALESCE(u.role, 'joueur') = 'joueur'
    GROUP BY u.id
  `;
}

function mountGerantCrmRoutes(app) {
  app.get('/api/gerant/joueurs', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const db = await getDb();
      const terrainId = req.user.terrain_id;
      if (!terrainId) return res.status(400).json({ error: 'Aucun terrain associé à ce gérant' });

      const q = String(req.query.q || '').trim().toLowerCase();
      const filter = String(req.query.filter || 'all');
      const today = new Date();
      const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const since = new Date(today);
      since.setDate(since.getDate() - 30);
      const since30 = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;

      let rows = queryAll(db, listJoueursSql(todayYmd, since30), [todayYmd, since30, since30, terrainId]);
      let mapped = rows.map((row) => mapListRow(row, todayYmd));

      if (q) {
        mapped = mapped.filter((j) => {
          const hay = `${j.display_nom} ${j.telephone || ''} ${j.email || ''}`.toLowerCase();
          return hay.includes(q) || digits(j.telephone).includes(digits(q));
        });
      }
      if (filter === 'bannis') mapped = mapped.filter((j) => j.is_banned);
      else if (filter === 'dette') mapped = mapped.filter((j) => j.solde_ouvert > 0 && !j.is_banned);
      else if (filter === 'actifs') mapped = mapped.filter((j) => !j.is_banned && j.matches_joues > 0);

      mapped.sort((a, b) => String(a.display_nom).localeCompare(String(b.display_nom), 'fr'));
      res.json({ joueurs: mapped, total: mapped.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.get('/api/gerant/joueurs/:id(\\d+)', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const db = await getDb();
      const terrainId = req.user.terrain_id;
      const joueurId = Number(req.params.id);
      const today = new Date();
      const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const since = new Date(today);
      since.setDate(since.getDate() - 30);
      const since30 = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;

      const user = queryOne(db, `
        SELECT id, nom, prenom, telephone, email, photo_url, quartier,
               COALESCE(is_banned, 0) AS is_banned, banned_at, banned_reason, notes_internes
        FROM users WHERE id = ? AND COALESCE(role, 'joueur') = 'joueur'
      `, [joueurId]);
      if (!user) return res.status(404).json({ error: 'Joueur introuvable' });

      const touch = queryOne(db, 'SELECT id FROM reservations WHERE joueur_id = ? AND terrain_id = ? LIMIT 1', [joueurId, terrainId]);
      if (!touch) return res.status(404).json({ error: 'Joueur introuvable' });

      const reservations = queryAll(db, `
        SELECT id, date, heure_debut, heure_fin, statut, code_reservation,
               COALESCE(prix_total, montant, 0) AS montant_total,
               COALESCE(montant_avance, acompte, 0) AS montant_avance,
               COALESCE(montant_restant, reste_a_payer, 0) AS montant_restant,
               operational_stage, qr_code_scanne_at
        FROM reservations
        WHERE joueur_id = ? AND terrain_id = ?
        ORDER BY date DESC, heure_debut DESC
      `, [joueurId, terrainId]);

      const statsRow = queryOne(db, `
        SELECT
          SUM(CASE WHEN statut IN ('match_joue', 'joue') THEN 1 ELSE 0 END) AS matches_joues,
          SUM(CASE WHEN statut = 'confirme' AND date < ? THEN 1 ELSE 0 END) AS no_shows,
          SUM(CASE WHEN date >= ? THEN 1 ELSE 0 END) AS reservations_30j,
          SUM(CASE WHEN date >= ? AND statut IN ('match_joue', 'joue') THEN 1 ELSE 0 END) AS matches_30j,
          SUM(CASE WHEN statut IN ('confirme', 'match_joue', 'joue')
            THEN COALESCE(montant_restant, reste_a_payer, 0) ELSE 0 END) AS solde_ouvert,
          SUM(COALESCE(prix_total, montant, 0)) AS ca_total,
          MAX(CASE WHEN statut IN ('match_joue', 'joue') THEN date ELSE NULL END) AS last_match_at
        FROM reservations WHERE joueur_id = ? AND terrain_id = ?
      `, [todayYmd, since30, since30, joueurId, terrainId]);

      const creneauFav = queryOne(db, `
        SELECT heure_debut, COUNT(*) AS n
        FROM reservations
        WHERE joueur_id = ? AND terrain_id = ? AND statut IN ('match_joue', 'joue')
        GROUP BY heure_debut
        ORDER BY n DESC
        LIMIT 1
      `, [joueurId, terrainId]);

      const paiements = queryAll(db, `
        SELECT p.id, p.montant, p.methode, p.statut, p.created_at, p.reservation_id
        FROM paiements p
        JOIN reservations r ON r.id = p.reservation_id
        WHERE r.joueur_id = ? AND r.terrain_id = ?
        ORDER BY p.id DESC
        LIMIT 20
      `, [joueurId, terrainId]);

      const listShape = mapListRow({
        ...user,
        ...statsRow,
      }, todayYmd);

      res.json({
        joueur: {
          ...user,
          display_nom: displayName(user),
          is_banned: Boolean(user.is_banned),
        },
        stats: {
          matches_joues: Number(statsRow?.matches_joues || 0),
          no_shows: Number(statsRow?.no_shows || 0),
          reservations_30j: Number(statsRow?.reservations_30j || 0),
          matches_30j: Number(statsRow?.matches_30j || 0),
          assiduite_30j: listShape.assiduite_30j,
          solde_ouvert: Number(statsRow?.solde_ouvert || 0),
          ca_total: Number(statsRow?.ca_total || 0),
          last_match_at: statsRow?.last_match_at || null,
          creneau_favori: creneauFav ? String(creneauFav.heure_debut).slice(0, 5) : null,
        },
        reservations,
        paiements,
        crm: listShape.crm,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.patch('/api/gerant/joueurs/:id(\\d+)', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const db = await getDb();
      const terrainId = req.user.terrain_id;
      const joueurId = Number(req.params.id);
      const touch = queryOne(db, 'SELECT id FROM reservations WHERE joueur_id = ? AND terrain_id = ? LIMIT 1', [joueurId, terrainId]);
      if (!touch) return res.status(404).json({ error: 'Joueur introuvable' });

      const notes = req.body?.notes_internes;
      const bannedReason = req.body?.banned_reason;
      if (typeof req.body?.is_banned === 'boolean') {
        if (req.body.is_banned) {
          runSql(db, `UPDATE users SET is_banned = 1, banned_at = CURRENT_TIMESTAMP, banned_reason = ? WHERE id = ?`, [
            String(bannedReason || 'Banni par le gérant').slice(0, 255),
            joueurId,
          ]);
        } else {
          runSql(db, `UPDATE users SET is_banned = 0, banned_at = NULL, banned_reason = NULL WHERE id = ?`, [joueurId]);
        }
      }
      if (typeof notes === 'string') {
        runSql(db, 'UPDATE users SET notes_internes = ? WHERE id = ?', [notes.slice(0, 4000), joueurId]);
      }
      const updated = queryOne(db, 'SELECT id, nom, prenom, is_banned, banned_reason, notes_internes FROM users WHERE id = ?', [joueurId]);
      res.json({ joueur: updated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/gerant/joueurs', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const db = await getDb();
      const nom = String(req.body?.nom || '').trim();
      const telephone = String(req.body?.telephone || '').trim();
      if (nom.length < 2) return res.status(400).json({ error: 'Nom requis', code: 'INVALID_NAME' });

      const phoneDigits = digits(telephone);
      if (phoneDigits) {
        const existing = queryOne(db, "SELECT id, nom FROM users WHERE REPLACE(REPLACE(telephone, ' ', ''), '+', '') LIKE ? AND COALESCE(role, 'joueur') = 'joueur'", [`%${phoneDigits.slice(-9)}`]);
        if (existing) {
          return res.status(409).json({
            error: 'Un joueur existe déjà avec ce téléphone',
            code: 'PLAYER_EXISTS',
            joueur_id: existing.id,
          });
        }
      }

      const email = `walkin.${phoneDigits || "x"}.${Date.now()}@joueur.terrainsn.local`;
      runSql(db, `INSERT INTO users (nom, email, telephone, role, is_active, telephone_verified)
        VALUES (?, ?, ?, 'joueur', 1, 0)`, [nom, email, telephone || null]);
      const created = queryOne(db, 'SELECT id, nom, prenom, telephone, email FROM users WHERE email = ?', [email]);
      res.status(201).json({ joueur: created });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/gerant/reservations/:id(\\d+)/lier-joueur', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const db = await getDb();
      const terrainId = req.user.terrain_id;
      const reservationId = Number(req.params.id);
      const reservation = queryOne(db, 'SELECT * FROM reservations WHERE id = ? AND terrain_id = ?', [reservationId, terrainId]);
      if (!reservation) return res.status(404).json({ error: 'Reservation non trouvee' });

      let joueurId = Number(req.body?.joueur_id || 0);
      if (!joueurId && req.body?.nom) {
        const nom = String(req.body.nom).trim();
        const telephone = String(req.body.telephone || '').trim();
        const email = `walkin.${digits(telephone) || "x"}.${Date.now()}@joueur.terrainsn.local`;
        runSql(db, `INSERT INTO users (nom, email, telephone, role, is_active) VALUES (?, ?, ?, 'joueur', 1)`, [
          nom, email, telephone || reservation.joueur_telephone || null,
        ]);
        const created = queryOne(db, 'SELECT id FROM users WHERE email = ?', [email]);
        joueurId = created.id;
      }
      if (!joueurId) return res.status(400).json({ error: 'joueur_id ou nom requis' });

      const joueur = queryOne(db, 'SELECT id, nom, prenom, telephone FROM users WHERE id = ?', [joueurId]);
      if (!joueur) return res.status(404).json({ error: 'Joueur introuvable' });

      const label = displayName(joueur);
      runSql(db, `UPDATE reservations SET joueur_id = ?, joueur_nom = ?, joueur_telephone = COALESCE(?, joueur_telephone) WHERE id = ? AND terrain_id = ?`, [
        joueurId, label, joueur.telephone, reservationId, terrainId,
      ]);
      res.json({
        ok: true,
        joueur_id: joueurId,
        joueur_nom: label,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });
}

module.exports = { mountGerantCrmRoutes };
