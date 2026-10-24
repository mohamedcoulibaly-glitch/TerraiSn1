const { getDb, queryOne, queryAll, transaction } = require('./database');
const { authMiddleware, requireRole } = require('./middleware/auth');
const { logActivite } = require('./services/auditService');
const scoreService = require('./services/scoreService');
const { assertFenetreScanQr, calculerFenetreCheckIn, DEFAULT_FENETRE_RETARD_MIN } = require('./services/checkInFenetre');
const { assertQrMatchesReservation } = require('./services/qrPayload');
const { assertScanSignature } = require('./domain/qrSignature');
const { notifyTerrain } = require('./realtimeHub');
const { assertStageTransition, playerGate, resolveOperationalStage } = require('./services/kanbanRules');
const {
  resoudreReservationParCode,
  assertGerantPeutValider,
} = require('./services/codeReservationService');
const { encaisserSoldeSurPlace } = require('./services/portefeuilleService');
const { rowsModified } = require('./reservationLockService');
const logger = require('./logger');

function localDateYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Fenêtre glissante de 7 jours à partir d'aujourd'hui ; toTech = +1 jour pour inclure la nuit prolongée du 7e jour. */
function next7DaysBoundsYmd(from = new Date()) {
  const d = new Date(from);
  d.setHours(12, 0, 0, 0);
  const end = new Date(d);
  end.setDate(d.getDate() + 6);
  const endTech = new Date(d);
  endTech.setDate(d.getDate() + 7);
  return { from: localDateYmd(d), to: localDateYmd(end), toTech: localDateYmd(endTech) };
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

/** Bornes date pour historique : periode (jour|semaine|mois|annee) ou from/to YYYY-MM-DD. */
function resolvePeriodBounds(query = {}) {
  const fromQ = String(query.from || '').trim();
  const toQ = String(query.to || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromQ)) {
    return {
      from: fromQ,
      to: /^\d{4}-\d{2}-\d{2}$/.test(toQ) ? toQ : localDateYmd(),
    };
  }
  const periode = String(query.periode || '').toLowerCase();
  const today = localDateYmd();
  if (periode === 'jour' || periode === 'aujourd_hui' || periode === 'day') {
    return { from: today, to: today, periode: 'jour' };
  }
  if (periode === 'semaine' || periode === 'week') {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return { from: localDateYmd(d), to: today, periode: 'semaine' };
  }
  if (periode === 'mois' || periode === 'month') {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return { from: localDateYmd(d), to: today, periode: 'mois' };
  }
  if (periode === 'annee' || periode === 'year') {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    d.setDate(d.getDate() + 1);
    return { from: localDateYmd(d), to: today, periode: 'annee' };
  }
  return null;
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
    operational_stage:
      row.statut === 'en_attente' || row.statut === 'en_attente_paiement'
        ? 'pending_payment'
        : resolveOperationalStage(row),
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
    terrain_ville: row.terrain_ville || null,
    creneau_id: row.creneau_id || null,
    format_terrain: row.format_terrain || 'entier',
    mode_paiement: row.mode_paiement || null,
    canal_paiement: row.canal_paiement || null,
    note_gerant: row.note_gerant || null,
    created_at: row.created_at || null,
    confirme_at: row.confirme_at || null,
    confirme_manuellement_at: row.confirme_manuellement_at || null,
    confirme_manuellement_par: row.confirme_manuellement_par || null,
    cree_par: row.cree_par || null,
    match_joue_at: row.match_joue_at || row.joue_at || null,
    match_solde_paye: row.match_solde_paye != null ? Number(row.match_solde_paye) : null,
    match_methode_solde: row.match_methode_solde || null,
    gerant_nom: row.gerant_nom || null,
    fenetre_retard,
    fenetre_debut: new Date(fenetre.debutFenetre).toISOString(),
    fenetre_fin: new Date(fenetre.finFenetre).toISOString(),
    dans_fenetre_checkin: Date.now() >= fenetre.debutFenetre && Date.now() <= fenetre.finFenetre,
    crm,
  };
}

async function marquerReservationJouee({ db, reservation, gerantId, methode, encaisser = true }) {
  const solde = Number(reservation.reste_a_payer ?? reservation.montant_restant ?? 0);
  const avancePayee = Number(reservation.montant_avance ?? reservation.acompte ?? 0);
  transaction(db, () => {
    // L'entrée est validée dans tous les cas ; le solde n'est soldé que si le
    // gérant a explicitement confirmé l'encaissement (jamais en silence).
    db.run(`UPDATE reservations
      SET statut = 'match_joue',
          ${encaisser ? 'reste_a_payer = 0, montant_restant = 0,' : ''}
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
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [reservation.id, reservation.terrain_id, gerantId, reservation.prix_total || reservation.montant, avancePayee, encaisser ? solde : 0, methode]);
    if (reservation.creneau_id) {
      db.run(`UPDATE creneaux SET statut = 'joue' WHERE id = ?`, [reservation.creneau_id]);
    }
    if (encaisser && solde > 0) {
      encaisserSoldeSurPlace(db, reservation, gerantId, methode);
    }
  });
}

/**
 * Règle « un seul créneau à la fois », tranchée CÔTÉ SERVEUR :
 * parmi les réservations confirmées non scannées du terrain dont la fenêtre
 * de scan est ouverte, la prioritaire est celle qui commence le plus tôt.
 */
function prioriteScanDuMoment(db, terrainId, maintenant = Date.now()) {
  const rows = queryAll(db, `
    SELECT r.id, r.date, r.heure_debut, r.heure_fin,
           COALESCE(r.joueur_nom, u.nom) AS joueur_nom,
           COALESCE(c.fenetre_retard, ${DEFAULT_FENETRE_RETARD_MIN}) AS fenetre_retard
    FROM reservations r
    LEFT JOIN users u ON u.id = r.joueur_id
    LEFT JOIN creneaux c ON c.id = r.creneau_id
    WHERE r.terrain_id = ? AND r.statut = 'confirme' AND r.qr_code_scanne_at IS NULL
  `, [terrainId]);
  const ouvertes = rows
    .map((row) => ({
      row,
      fenetre: calculerFenetreCheckIn({
        date: row.date,
        heure_debut: row.heure_debut,
        heure_fin: row.heure_fin,
        fenetre_retard: row.fenetre_retard,
      }),
    }))
    .filter(({ fenetre }) => maintenant >= fenetre.debutFenetre && maintenant <= fenetre.finFenetre)
    .sort((a, b) => a.fenetre.heureDebutMs - b.fenetre.heureDebutMs || a.row.id - b.row.id);
  return ouvertes[0]?.row || null;
}

/** Pose scannable_now (+ infos priorité) sur des lignes déjà mappées. */
function annoterPrioriteScan(db, terrainId, mappedRows) {
  const priorite = prioriteScanDuMoment(db, terrainId);
  for (const row of mappedRows) {
    if (!priorite || Number(row.id) === Number(priorite.id) || row.qr_code_scanne_at || row.statut !== 'confirme') {
      row.scannable_now = true;
      continue;
    }
    row.scannable_now = false;
    row.priorite_reservation_id = priorite.id;
    row.priorite_heure = String(priorite.heure_debut || '').slice(0, 5);
    row.priorite_joueur = priorite.joueur_nom || null;
  }
  return mappedRows;
}

async function traiterScanQrReservation(req, res, { manuelle = false, reservationPrechargee = null, via = null } = {}) {
  try {
    const db = await getDb();
    const reservationId = Number(req.params.id);
    // Check-in par code : le terrain qui compte est celui de la réservation
    // résolue par le code (le gérant a pu autoriser plusieurs terrains),
    // pas forcément le terrain « actif » sélectionné dans l'app.
    const terrainId = reservationPrechargee
      ? Number(reservationPrechargee.terrain_id)
      : req.user.terrain_id;

    const reservation = queryOne(db, `
      SELECT r.*, t.nom AS terrain_nom,
             c.date AS creneau_date, c.heure_debut AS creneau_heure_debut, c.heure_fin AS creneau_heure_fin,
             COALESCE(c.fenetre_retard, ${DEFAULT_FENETRE_RETARD_MIN}) AS fenetre_retard
      FROM reservations r
      JOIN terrains t ON t.id = r.terrain_id
      LEFT JOIN creneaux c ON c.id = r.creneau_id
      WHERE r.id = ? AND r.terrain_id = ?
    `, [reservationId, terrainId]);
    if (!reservation) {
      const elsewhere = queryOne(db, 'SELECT id, terrain_id FROM reservations WHERE id = ?', [reservationId]);
      if (elsewhere) {
        return res.status(403).json({
          error: 'Ce QR code ne correspond pas à ton terrain',
          code: 'QR_WRONG_TERRAIN',
        });
      }
      return res.status(404).json({ error: 'Reservation non trouvee', code: 'QR_NOT_FOUND' });
    }

    if (reservation.qr_code_scanne_at) {
      return res.status(403).json({
        error: `Erreur : Ce code QR a déjà été scanné le ${formatQrScanneAtFr(reservation.qr_code_scanne_at)}`,
        code: 'QR_ALREADY_SCANNED',
        qr_code_scanne_at: reservation.qr_code_scanne_at,
      });
    }
    if (reservation.statut !== 'confirme') {
      return res.status(400).json({
        error: `Cette réservation n'est pas confirmée (statut : ${reservation.statut}). Seule une réservation confirmée peut être validée.`,
        code: 'QR_BAD_STATUS',
        statut: reservation.statut,
      });
    }

    // En validation manuelle, le gérant authentifié valide depuis la fiche :
    // pas de QR à vérifier, mais terrain/statut/fenêtre/priorité restent exigés.
    let parsed = null;
    if (!manuelle) {
      const rawQr = req.body?.qr_data ?? req.body?.qrData ?? req.body?.raw_qr ?? null;
      if (!rawQr) {
        return res.status(400).json({
          error: 'QR code non reconnu. Demande au joueur de montrer celui reçu par WhatsApp.',
          code: 'QR_MISSING',
        });
      }
      try {
        parsed = assertScanSignature(rawQr);
        assertQrMatchesReservation(parsed, reservation);
      } catch (qrErr) {
        return res.status(qrErr.statusCode || 400).json({
          error: qrErr.message,
          code: qrErr.code,
        });
      }
      // Le QR a une durée de vie : après la fin de fenêtre il ne doit plus servir
      if (parsed.expire_at && Number(parsed.expire_at) * 1000 < Date.now()) {
        return res.status(400).json({
          error: 'Ce QR code a expiré. La fenêtre de validation de ce match est terminée.',
          code: 'QR_PAYLOAD_EXPIRED',
        });
      }
    }

    assertFenetreScanQr({
      date: reservation.creneau_date || reservation.date,
      heure_debut: reservation.creneau_heure_debut || reservation.heure_debut,
      heure_fin: reservation.creneau_heure_fin || reservation.heure_fin,
      fenetre_retard: reservation.fenetre_retard,
    });

    // Un seul créneau à la fois : si un match plus tôt attend son scan, il passe d'abord
    const priorite = prioriteScanDuMoment(db, terrainId);
    if (priorite && Number(priorite.id) !== Number(reservation.id)) {
      return res.status(409).json({
        error: `Scanne d'abord le match de ${String(priorite.heure_debut || '').slice(0, 5).replace(':', 'h')}${priorite.joueur_nom ? ` (${priorite.joueur_nom})` : ''} — un seul créneau à la fois.`,
        code: 'QR_SCAN_PRIORITY',
        priorite_reservation_id: priorite.id,
        priorite_heure: String(priorite.heure_debut || '').slice(0, 5),
        priorite_joueur: priorite.joueur_nom || null,
      });
    }

    const methode = ['especes', 'wave', 'orange_money'].includes(req.body?.methode) ? req.body.methode : 'especes';
    const montantRestantAvant = Number(
      reservation.reste_a_payer ?? reservation.montant_restant ?? 0,
    );
    // Encaissement EXPLICITE uniquement : le scan valide l'entrée, il ne solde
    // le reste que si le gérant l'a confirmé (encaisser_solde === true, après
    // choix montant + méthode côté front). Sinon le solde reste dû et
    // s'encaisse via POST /gerant/reservations/:id/encaisser.
    const encaisserSolde = req.body?.encaisser_solde === true;
    await marquerReservationJouee({
      db,
      reservation,
      gerantId: req.user.id,
      methode,
      encaisser: encaisserSolde,
    });
    notifyTerrain(reservation.terrain_id, 'checkin', { reservation_id: reservation.id });
    // Canal SSE gérant typé : le dashboard passe la résa en « en cours » sans refresh
    try {
      require('./services/sseManager').emettrePourTerrain(reservation.terrain_id, 'match_valide', {
        reservation_id: reservation.id,
        creneau_id: reservation.creneau_id || null,
      });
    } catch {
      // best-effort
    }
    await logActivite({
      gerant_id: req.user.id,
      terrain_id: reservation.terrain_id,
      // 'qr_scanne' reste l'action auditée (CHECK des bases existantes) ;
      // le mode d'entrée (code / manuel / qr) est tracé dans les détails.
      action: 'qr_scanne',
      reservation_id: reservation.id,
      details: { methode, qr_format: via || parsed?.format || 'manuel', encaisser_solde: encaisserSolde },
    }).catch((error) => logger.error('gerantCheckin.js', 'Log activite qr_scanne', error));
    await scoreService.recalculerScore(req.user.id, reservation.terrain_id)
      .catch((error) => logger.error('gerantCheckin.js', 'Recalcul score scan QR', error));

    try {
      const notificationService = require('./notificationService');
      await notificationService.envoyerCheckinValide(reservation.id);
      logger.event('checkin_whatsapp', { reservation_id: reservation.id });
    } catch (notifErr) {
      logger.warn('gerantCheckin.js', `Notif check-in WhatsApp #${reservation.id} : ${notifErr.message}`);
    }
    try {
      await require('./pushService').notifierCheckinValide(reservation.id);
    } catch (pushErr) {
      logger.warn('gerantCheckin.js', `Notif check-in push #${reservation.id} : ${pushErr.message}`);
    }

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
        // montant_restant = état APRÈS validation (source de vérité pour l'UI)
        montant_restant: Number(updated.montant_restant ?? updated.reste_a_payer ?? 0),
        // Solde dû avant validation (pour UX « Encaisse X FCFA sur place »)
        montant_restant_avant: montantRestantAvant,
        solde_encaisse: encaisserSolde && montantRestantAvant > 0,
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
      qr_code_scanne_at: err.qr_code_scanne_at,
    });
  }
}

/**
 * Check-in par CODE NUMÉRIQUE (TF-XXXXXX) saisi par le gérant — atomique :
 * normalisation → résolution → correspondance exacte → autorisation terrain
 * (tous les terrains du gérant) → mêmes contrôles que le scan QR
 * (statut confirmé, fenêtre, priorité, usage unique).
 * Avant : résolution code→id puis validation par id en 2 appels, le code
 * n'était jamais comparé en mode fiche et la résolution était limitée au
 * terrain actif → codes corrects refusés / codes quelconques acceptés.
 */
async function traiterCheckinParCode(req, res) {
  try {
    const db = await getDb();
    const saisie = req.body?.code ?? req.body?.code_reservation ?? '';

    let resolved;
    try {
      resolved = resoudreReservationParCode(db, saisie);
      assertGerantPeutValider(req.user, resolved.reservation);
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message, code: err.code });
    }

    // Mode fiche : le code saisi doit correspondre à CETTE réservation.
    const expectedId = Number(req.body?.expected_reservation_id || 0);
    if (expectedId && expectedId !== Number(resolved.reservation.id)) {
      return res.status(400).json({
        error: 'Ce code ne correspond pas à ce match. Demande au joueur de montrer le bon code.',
        code: 'QR_MISMATCH',
      });
    }

    req.params.id = String(resolved.reservation.id);
    return traiterScanQrReservation(req, res, {
      manuelle: true,
      reservationPrechargee: resolved.reservation,
      via: 'code',
    });
  } catch (err) {
    console.error(err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur', code: err.code });
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

  /**
   * Validation manuelle (joueur sans batterie / QR illisible / saisie du code) :
   * mêmes contrôles que le scan (terrain, statut, fenêtre, priorité) mais sans
   * exiger un QR signé — le gérant authentifié valide depuis la fiche.
   * Avant, le front fabriquait un QR non signé, rejeté à 100 %.
   */
  app.post(
    '/api/gerant/reservations/:id(\\d+)/validation-manuelle',
    authMiddleware,
    requireRole('gerant'),
    (req, res) => traiterScanQrReservation(req, res, { manuelle: true }),
  );

  /**
   * Check-in par code numérique saisi (TF-XXXXXX) : résolution + correspondance
   * + validation en UN appel serveur (voir traiterCheckinParCode).
   */
  app.post(
    '/api/gerant/reservations/checkin-by-code',
    authMiddleware,
    requireRole('gerant'),
    traiterCheckinParCode,
  );

  /**
   * Mode A : résolution d'un code TF-… vers un id.
   * Recherche globale + autorisation sur TOUS les terrains du gérant
   * (avant : seul le terrain actif du JWT → codes corrects refusés).
   */
  app.get('/api/gerant/reservations/by-code/:code', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const db = await getDb();
      const { code, reservation } = resoudreReservationParCode(db, req.params.code);
      assertGerantPeutValider(req.user, reservation);
      return res.json({
        id: reservation.id,
        code_reservation: reservation.code_reservation || code,
        statut: reservation.statut,
        terrain_id: reservation.terrain_id,
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message, code: err.code });
      }
      console.error(err);
      return res.status(500).json({ error: err.message || 'Erreur serveur' });
    }
  });

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

  /** Liste filtrable (page Joueurs / Historique gérant). */
  app.get('/api/gerant/reservations', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const db = await getDb();
      const terrainId = req.user.terrain_id;
      if (!terrainId) return res.status(400).json({ error: 'Aucun terrain associé à ce gérant', reservations: [] });

      const statutFilter = String(req.query.statut || 'all').trim().toLowerCase();
      const q = String(req.query.q || '').trim().toLowerCase();
      const bounds = resolvePeriodBounds(req.query);
      const params = [terrainId];
      let where = 'r.terrain_id = ?';

      if (bounds) {
        where += ' AND r.date >= ? AND r.date <= ?';
        params.push(bounds.from, bounds.to);
      }

      if (statutFilter === 'confirme') {
        where += " AND r.statut IN ('confirme', 'acceptee')";
      } else if (statutFilter === 'en_attente') {
        where += " AND r.statut IN ('en_attente', 'en_attente_paiement')";
      } else if (statutFilter === 'joue') {
        where += " AND r.statut IN ('match_joue', 'joue')";
      } else if (statutFilter === 'annulee') {
        where += " AND r.statut IN ('annulee', 'refusee', 'expiree')";
      }

      if (q) {
        where += ' AND (LOWER(COALESCE(r.joueur_nom, \'\')) LIKE ? OR COALESCE(r.joueur_telephone, \'\') LIKE ? OR LOWER(COALESCE(r.code_reservation, \'\')) LIKE ?)';
        const like = `%${q}%`;
        params.push(like, like, like);
      }

      const rows = queryAll(
        db,
        `SELECT r.*, t.nom AS terrain_nom, t.ville AS terrain_ville,
                COALESCE(r.joueur_nom, u.nom) AS joueur_nom,
                COALESCE(r.joueur_telephone, u.telephone) AS joueur_telephone,
                COALESCE(u.is_banned, 0) AS is_banned,
                COALESCE(c.fenetre_retard, ${DEFAULT_FENETRE_RETARD_MIN}) AS fenetre_retard,
                m.joue_at AS match_joue_at,
                m.solde_paye AS match_solde_paye,
                m.methode_solde AS match_methode_solde
         FROM reservations r
         JOIN terrains t ON t.id = r.terrain_id
         LEFT JOIN users u ON u.id = r.joueur_id
         LEFT JOIN creneaux c ON c.id = r.creneau_id
         LEFT JOIN matchs m ON m.reservation_id = r.id
         WHERE ${where}
         ORDER BY r.date DESC, r.heure_debut DESC
         LIMIT 2000`,
        params,
      );

      res.json({
        terrain_id: terrainId,
        from: bounds?.from || null,
        to: bounds?.to || null,
        periode: bounds?.periode || null,
        reservations: rows.map(mapReservationGerantRow),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur', reservations: [] });
    }
  });

  app.get('/api/gerant/reservations/today', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const db = await getDb();
      const terrainId = req.user.terrain_id;
      if (!terrainId) return res.status(400).json({ error: 'Aucun terrain associé à ce gérant' });

      const dateParam = typeof req.query.date === 'string' ? req.query.date.trim() : '';
      // Jour PERÇU (culturel) : avant 05:00, on est encore dans la nuit de la veille.
      // Le jour perçu couvre [jour 05:00 → lendemain 04:59] : une résa stockée
      // avec la date technique du lendemain à 01:00 appartient à la file de la veille.
      let date;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        date = dateParam;
      } else {
        const now = new Date();
        date = localDateYmd(now);
        if (now.getHours() < 5) {
          const hier = new Date(now);
          hier.setDate(hier.getDate() - 1);
          date = localDateYmd(hier);
        }
      }
      const lendemainDate = new Date(`${date}T12:00:00`);
      lendemainDate.setDate(lendemainDate.getDate() + 1);
      const lendemain = localDateYmd(lendemainDate);

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
          AND (
            (r.date = ? AND CAST(SUBSTR(r.heure_debut, 1, 2) AS INTEGER) >= 5)
            OR (r.date = ? AND CAST(SUBSTR(r.heure_debut, 1, 2) AS INTEGER) < 5)
          )
          AND (
            r.statut IN ('confirme', 'match_joue', 'joue')
            OR (
              r.statut IN ('en_attente', 'en_attente_paiement')
              AND r.verrou_expire_at IS NOT NULL
              AND r.verrou_expire_at > ?
            )
          )
        ORDER BY CASE WHEN r.date = ? THEN 0 ELSE 1 END, r.heure_debut ASC, r.heure_fin ASC
      `, [terrainId, date, lendemain, Date.now(), date]);

      res.json({
        date,
        terrain_id: terrain.id,
        terrain_nom: terrain.nom,
        reservations: annoterPrioriteScan(db, terrainId, rows.map(mapReservationGerantRow)),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  /** Fenêtre glissante : les 7 prochains jours (aujourd'hui inclus), réservations confirmées / jouées / en attente de paiement valide. */
  app.get('/api/gerant/reservations/week', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const db = await getDb();
      const terrainId = req.user.terrain_id;
      if (!terrainId) return res.status(400).json({ error: 'Aucun terrain associé à ce gérant' });

      const terrain = queryOne(db, 'SELECT id, nom FROM terrains WHERE id = ?', [terrainId]);
      if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });

      const { from, to, toTech } = next7DaysBoundsYmd();
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
          AND r.date >= ? AND r.date <= ?
          AND (
            r.statut IN ('confirme', 'acceptee', 'match_joue', 'joue')
            OR (r.statut IN ('en_attente', 'en_attente_paiement') AND r.verrou_expire_at IS NOT NULL AND r.verrou_expire_at > ?)
          )
        ORDER BY r.date ASC, r.heure_debut ASC, r.heure_fin ASC
      `, [terrainId, from, toTech, Date.now()]);

      res.json({
        from,
        to,
        fenetre: '7_prochains_jours',
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
      res.json(annoterPrioriteScan(db, terrainId, [mapReservationGerantRow(row)])[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  /** Encaisser le reste sur place sans passer par le Kanban multi-étapes. */
  app.post('/api/gerant/reservations/:id(\\d+)/encaisser', authMiddleware, requireRole('gerant'), async (req, res) => {
    try {
      const db = await getDb();
      const terrainId = req.user.terrain_id;
      const reservationId = Number(req.params.id);
      const methode = ['especes', 'wave', 'orange_money'].includes(req.body?.methode)
        ? req.body.methode
        : 'especes';

      const row = queryOne(db, 'SELECT * FROM reservations WHERE id = ? AND terrain_id = ?', [
        reservationId,
        terrainId,
      ]);
      if (!row) return res.status(404).json({ error: 'Reservation non trouvee' });
      if (!['confirme', 'acceptee', 'match_joue', 'joue'].includes(row.statut)) {
        return res.status(400).json({ error: 'Encaissement impossible pour ce statut' });
      }
      const restant = Number(row.montant_restant ?? row.reste_a_payer ?? 0);
      if (!(restant > 0)) {
        return res.status(400).json({ error: 'Aucun reste à encaisser' });
      }

      const result = transaction(db, () => encaisserSoldeSurPlace(db, row, req.user.id, methode));
      await logActivite({
        gerant_id: req.user.id,
        terrain_id: terrainId,
        action: 'encaissement_sur_place',
        reservation_id: reservationId,
        details: { methode, montant: restant },
      }).catch((error) => logger.error('gerantCheckin.js', 'Log encaissement', error));

      const updated = queryOne(db, `
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
      `, [reservationId, terrainId]);

      res.json({
        ok: true,
        ...result,
        reservation: mapReservationGerantRow(updated),
      });
    } catch (err) {
      console.error(err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
    }
  });
}

module.exports = {
  mountGerantCheckinRoutes,
  traiterCheckinParCode,
  mapReservationGerantRow,
  resolvePeriodBounds,
  marquerReservationJouee,
  localDateYmd,
};
