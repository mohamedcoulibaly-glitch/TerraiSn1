const { getDb, queryOne, queryAll, transaction } = require('./database');
const { authMiddleware, requireRole } = require('./middleware/auth');
const { logActivite } = require('./services/auditService');
const scoreService = require('./services/scoreService');
const { assertFenetreScanQr, calculerFenetreCheckIn, DEFAULT_FENETRE_RETARD_MIN } = require('./services/checkInFenetre');
const { parseQrPayload, assertQrMatchesReservation } = require('./services/qrPayload');
const { assertStageTransition, playerGate, resolveOperationalStage } = require('./services/kanbanRules');
const { encaisserSoldeSurPlace } = require('./services/portefeuilleService');
const { rowsModified } = require('./reservationLockService');
const logger = require('./logger');

function localDateYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatQrScanneAtFr(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const date = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mapReservationGerantRow(row) {
  const montantTotal = Number(row.prix_total ?? row.montant ?? 0);
  const montantAvance = Number(row.montant_avance ?? row.acompte ?? 0);
  const montantRestant = Number(row.montant_restant ?? row.reste_a_payer ?? Math.max(0, montantTotal - montantAvance));
  const fenetre_retard = Number.isFinite(Number(row.fenetre_retard))
    ? Number(row.fenetre_retard)
    : DEFAULT_FENETRE_RETARD_MIN;
  const fenetre = calculerFenetreCheckIn({
    date: row.date,
    heure_debut: row.heure_debut,
    heure_fin: row.heure_fin,
    fenetre_retard,
  });
  const crm = playerGate({
    is_banned: Boolean(row.is_banned),
    solde_ouvert: montantRestant,
    politiqueImpaye: false,
  });
  return {
    id: row.id,
    code_reservation: row.code_reservation || null,
    joueur_id: row.joueur_id || null,
    joueur_nom: row.joueur_nom || null,
    joueur_telephone: row.joueur_telephone || null,
    date: row.date,
    heure_debut: String(row.heure_debut || '').slice(0, 5),
    heure_fin: String(row.heure_fin || '').slice(0, 5),
    statut: row.statut,
    operational_stage: resolveOperationalStage(row),
    checked_in_at: row.checked_in_at || null,
    checkout_at: row.checkout_at || null,
    montant_total: montantTotal,
    montant_avance: montantAvance,
    montant_restant: montantRestant,
    qr_code_scanne_at: row.qr_code_scanne_at || null,
    qr_code_payload: row.qr_code_payload || null,
    type_reservation: row.cree_par === 'gerant' ? 'manuelle' : 'en_ligne',
    terrain_id: row.terrain_id,
    terrain_nom: row.terrain_nom || null,
    creneau_id: row.creneau_id || null,
    fenetre_retard,
    fenetre_debut: new Date(fenetre.debutFenetre).toISOString(),
    fenetre_fin: new Date(fenetre.finFenetre).toISOString(),
    dans_fenetre_checkin: Date.now() >= fenetre.debutFenetre && Date.now() <= fenetre.finFenetre,
    crm,
  };
}

async function marquerReservationJouee({ db, reservation, gerantId, methode }) {
  const solde = Number(reservation.reste_a_payer ?? reservation.montant_restant ?? 0);
  const avancePayee = Number(reservation.montant_avance ?? reservation.acompte ?? 0);
  transaction(db, () => {
    db.run(`UPDATE reservations
      SET statut = 'match_joue',
          reste_a_payer = 0,
          montant_restant = 0,
          qr_code_scanne_at = COALESCE(qr_code_scanne_at, CURRENT_TIMESTAMP),
          checked_in_at = COALESCE(checked_in_at, CURRENT_TIMESTAMP),
          operational_stage = CASE
            WHEN operational_stage IN ('match', 'checkout', 'closed') THEN operational_stage
            ELSE 'match'
          END
      WHERE id = ? AND statut = 'confirme'`, [reservation.id]);
    if (rowsModified(db) !== 1) {
      const error = new Error('Seule une reservation confirmee peut etre scannee');
      error.statusCode = 400;
      throw error;
    }
    db.run(`INSERT INTO matchs (reservation_id, terrain_id, gerant_id, montant_total, acompte_paye, solde_paye, methode_solde)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [reservation.id, reservation.terrain_id, gerantId, reservation.prix_total || reservation.montant, avancePayee, solde, methode]);
    if (reservation.creneau_id) {
      db.run(`UPDATE creneaux SET statut = 'joue' WHERE id = ?`, [reservation.creneau_id]);
    }
    if (solde > 0) {
      encaisserSoldeSurPlace(db, reservation, gerantId, methode);
    }
  });
}

async function traiterScanQrReservation(req, res) {
  try {
    const db = await getDb();
    const reservationId = Number(req.params.id);
    const terrainId = req.user.terrain_id;

    const reservation = queryOne(db, `
      SELECT r.*, t.nom AS terrain_nom,
             c.date AS creneau_date, c.heure_debut AS creneau_heure_debut, c.heure_fin AS creneau_heure_fin,
             COALESCE(c.fenetre_retard, ${DEFAULT_FENETRE_RETARD_MIN}) AS fenetre_retard
      FROM reservations r
      JOIN terrains t ON t.id = r.terrain_id
      LEFT JOIN creneaux c ON c.id = r.creneau_id
      WHERE r.id = ? AND r.terrain_id = ?
    `, [reservationId, terrainId]);
    if (!reservation) return res.status(404).json({ error: 'Reservation non trouvee' });

    if (reservation.qr_code_scanne_at) {
      return res.status(403).json({
        error: `Erreur : Ce code QR a déjà été scanné le ${formatQrScanneAtFr(reservation.qr_code_scanne_at)}`,
        code: 'QR_ALREADY_SCANNED',
        qr_code_scanne_at: reservation.qr_code_scanne_at,
      });
    }
    if (reservation.statut !== 'confirme') {
      return res.status(400).json({
        error: "Cette réservation n'est pas dans un état valide.",
        code: 'QR_BAD_STATUS',
      });
    }

    const rawQr = req.body?.qr_data ?? req.body?.qrData ?? req.body?.raw_qr ?? null;
    if (!rawQr) {
      return res.status(400).json({
        error: 'QR code non reconnu. Demande au joueur de montrer celui reçu par WhatsApp.',
        code: 'QR_MISSING',
      });
    }
    const parsed = parseQrPayload(rawQr);
    try {
      assertQrMatchesReservation(parsed, reservation);
    } catch (qrErr) {
      return res.status(qrErr.statusCode || 400).json({
        error: qrErr.message,
        code: qrErr.code,
      });
    }

    assertFenetreScanQr({
      date: reservation.creneau_date || reservation.date,
      heure_debut: reservation.creneau_heure_debut || reservation.heure_debut,
      heure_fin: reservation.creneau_heure_fin || reservation.heure_fin,
      fenetre_retard: reservation.fenetre_retard,
    });

    const methode = ['especes', 'wave', 'orange_money'].includes(req.body?.methode) ? req.body.methode : 'especes';
    await marquerReservationJouee({ db, reservation, gerantId: req.user.id, methode });
    await logActivite({
      gerant_id: req.user.id,
      terrain_id: reservation.terrain_id,
      action: 'qr_scanne',
      reservation_id: reservation.id,
      details: { methode, qr_format: parsed.format },
    }).catch((error) => logger.error('gerantCheckin.js', 'Log activite qr_scanne', error));
    await scoreService.recalculerScore(req.user.id, reservation.terrain_id)
      .catch((error) => logger.error('gerantCheckin.js', 'Recalcul score scan QR', error));

    const updated = queryOne(db, `
      SELECT r.*, t.nom AS terrain_nom,
             COALESCE(r.joueur_nom, u.nom) AS joueur_nom,
             COALESCE(r.joueur_telephone, u.telephone) AS joueur_telephone
      FROM reservations r
      JOIN terrains t ON t.id = r.terrain_id
      LEFT JOIN users u ON u.id = r.joueur_id
      WHERE r.id = ?
    `, [reservation.id]);

    return res.json({
      message: 'QR code scanné et match validé',
      reservation: {
        id: updated.id,
        joueur_nom: updated.joueur_nom,
        terrain_nom: updated.terrain_nom,
        date: updated.date,
        heure_debut: String(updated.heure_debut || '').slice(0, 5),
        heure_fin: String(updated.heure_fin || '').slice(0, 5),
        code_reservation: updated.code_reservation,
        statut: updated.statut,
        qr_code_scanne_at: updated.qr_code_scanne_at,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(err.statusCode || 500).json({
      error: err.message || 'Erreur serveur',
      code: err.code,
      scannable_at: err.scannable_at,
      minutes_remaining: err.minutes_remaining,
      match_date: err.match_date,
      match_time: err.match_time,
    });
  }
}

function mountGerantCheckinRoutes(app) {
  app.put('/api/reservations/:id/jouer', authMiddleware, requireRole('gerant'), async (_req, res) => {
    return res.status(409).json({
      error: 'Le match se valide uniquement en scannant le QR depuis la fiche réservation.',
      code: 'QR_SCAN_REQUIRED',
    });
  });

  app.post('/api/reservations/:id(\\d+)/scan-qr', authMiddleware, requireRole('gerant'), traiterScanQrReservation);
  app.patch('/api/gerant/reservations/:id/scanner', authMiddleware, requireRole('gerant'), traiterScanQrReservation);

  app.patch('/api/gerant/reservations/:id(\\d+)/stage', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const db = await getDb();
      const terrainId = req.user.terrain_id;
      const reservationId = Number(req.params.id);
      const stage = String(req.body?.stage || '').trim();
      const waiverEncaissement = Boolean(req.body?.waiverEncaissement);
      const encaisserRestant = Boolean(req.body?.encaisserRestant);
      const methode = ['especes', 'wave', 'orange_money'].includes(req.body?.methode) ? req.body.methode : 'especes';

      const row = queryOne(db, `
        SELECT r.*, t.nom AS terrain_nom,
               COALESCE(r.joueur_nom, u.nom) AS joueur_nom,
               COALESCE(r.joueur_telephone, u.telephone) AS joueur_telephone,
               COALESCE(u.is_banned, 0) AS is_banned,
               COALESCE(c.fenetre_retard, ${DEFAULT_FENETRE_RETARD_MIN}) AS fenetre_retard,
               COALESCE(c.date, r.date) AS creneau_date,
               COALESCE(c.heure_debut, r.heure_debut) AS creneau_heure_debut,
               COALESCE(c.heure_fin, r.heure_fin) AS creneau_heure_fin
        FROM reservations r
        JOIN terrains t ON t.id = r.terrain_id
        LEFT JOIN users u ON u.id = r.joueur_id
        LEFT JOIN creneaux c ON c.id = r.creneau_id
        WHERE r.id = ? AND r.terrain_id = ?
      `, [reservationId, terrainId]);

      if (!row) return res.status(404).json({ error: 'Reservation non trouvee' });

      const mapped = mapReservationGerantRow({
        ...row,
        date: row.creneau_date || row.date,
        heure_debut: row.creneau_heure_debut || row.heure_debut,
        heure_fin: row.creneau_heure_fin || row.heure_fin,
      });

      assertStageTransition({
        stage: mapped.operational_stage,
        statut: mapped.statut,
        date: mapped.date,
        heure_debut: mapped.heure_debut,
        heure_fin: mapped.heure_fin,
        fenetre_retard: mapped.fenetre_retard,
        checked_in_at: mapped.checked_in_at,
        montant_restant: mapped.montant_restant,
        waiverEncaissement: waiverEncaissement || encaisserRestant,
        crm: mapped.crm,
      }, stage);

      const sets = {
        checkin: `operational_stage = 'checkin', checked_in_at = COALESCE(checked_in_at, CURRENT_TIMESTAMP)`,
        match: `operational_stage = 'match'`,
        checkout: `operational_stage = 'checkout'`,
        closed: `operational_stage = 'closed', checkout_at = COALESCE(checkout_at, CURRENT_TIMESTAMP), statut = CASE WHEN statut IN ('confirme', 'match_joue', 'joue') THEN 'match_joue' ELSE statut END`,
      };

      transaction(db, () => {
        if (stage === 'closed' && encaisserRestant && mapped.montant_restant > 0) {
          encaisserSoldeSurPlace(db, row, req.user.id, methode);
        }
        db.run(`UPDATE reservations SET ${sets[stage]} WHERE id = ? AND terrain_id = ?`, [reservationId, terrainId]);
      });

      await logActivite({
        gerant_id: req.user.id,
        terrain_id: terrainId,
        action: 'kanban_stage',
        reservation_id: reservationId,
        details: { from: mapped.operational_stage, to: stage, waiverEncaissement, encaisserRestant },
      }).catch((error) => logger.error('gerantCheckin.js', 'Log kanban_stage', error));

      const updated = queryOne(db, `
        SELECT r.*, t.nom AS terrain_nom,
               COALESCE(r.joueur_nom, u.nom) AS joueur_nom,
               COALESCE(r.joueur_telephone, u.telephone) AS joueur_telephone,
               COALESCE(u.is_banned, 0) AS is_banned,
               COALESCE(c.fenetre_retard, ${DEFAULT_FENETRE_RETARD_MIN}) AS fenetre_retard
        FROM reservations r
        JOIN terrains t ON t.id = r.terrain_id
        LEFT JOIN users u ON u.id = r.joueur_id
        LEFT JOIN creneaux c ON c.id = r.creneau_id
        WHERE r.id = ? AND r.terrain_id = ?
      `, [reservationId, terrainId]);

      return res.json({ reservation: mapReservationGerantRow(updated) });
    } catch (err) {
      console.error(err);
      return res.status(err.statusCode || 500).json({
        error: err.message || 'Erreur serveur',
        code: err.code,
      });
    }
  });

  app.get('/api/gerant/reservations/today', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const db = await getDb();
      const terrainId = req.user.terrain_id;
      if (!terrainId) return res.status(400).json({ error: 'Aucun terrain associé à ce gérant' });

      const dateParam = typeof req.query.date === 'string' ? req.query.date.trim() : '';
      const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : localDateYmd();

      const terrain = queryOne(db, 'SELECT id, nom FROM terrains WHERE id = ?', [terrainId]);
      if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });

      const rows = queryAll(db, `
        SELECT r.*, t.nom AS terrain_nom,
               COALESCE(r.joueur_nom, u.nom) AS joueur_nom,
               COALESCE(r.joueur_telephone, u.telephone) AS joueur_telephone,
               COALESCE(u.is_banned, 0) AS is_banned,
               COALESCE(c.fenetre_retard, ${DEFAULT_FENETRE_RETARD_MIN}) AS fenetre_retard
        FROM reservations r
        JOIN terrains t ON t.id = r.terrain_id
        LEFT JOIN users u ON u.id = r.joueur_id
        LEFT JOIN creneaux c ON c.id = r.creneau_id
        WHERE r.terrain_id = ?
          AND r.date = ?
          AND r.statut IN ('confirme', 'match_joue', 'joue')
        ORDER BY r.heure_debut ASC, r.heure_fin ASC
      `, [terrainId, date]);

      res.json({
        date,
        terrain_id: terrain.id,
        terrain_nom: terrain.nom,
        reservations: rows.map(mapReservationGerantRow),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.get('/api/gerant/reservations/:id(\\d+)', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const db = await getDb();
      const terrainId = req.user.terrain_id;
      const row = queryOne(db, `
        SELECT r.*, t.nom AS terrain_nom, t.ville AS terrain_ville,
               COALESCE(r.joueur_nom, u.nom) AS joueur_nom,
               COALESCE(r.joueur_telephone, u.telephone) AS joueur_telephone,
               COALESCE(u.is_banned, 0) AS is_banned,
               COALESCE(c.fenetre_retard, ${DEFAULT_FENETRE_RETARD_MIN}) AS fenetre_retard
        FROM reservations r
        JOIN terrains t ON t.id = r.terrain_id
        LEFT JOIN users u ON u.id = r.joueur_id
        LEFT JOIN creneaux c ON c.id = r.creneau_id
        WHERE r.id = ? AND r.terrain_id = ?
      `, [Number(req.params.id), terrainId]);

      if (!row) return res.status(404).json({ error: 'Reservation non trouvee' });
      res.json(mapReservationGerantRow(row));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });
}

module.exports = {
  mountGerantCheckinRoutes,
  mapReservationGerantRow,
  marquerReservationJouee,
  localDateYmd,
};
