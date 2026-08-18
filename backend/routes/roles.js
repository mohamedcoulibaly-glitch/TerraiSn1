const express = require('express');
const { getDb, queryAll, queryOne, runSql, transaction } = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const {
  ownerRevenueRowsSql,
  periodStart,
  summarizeOwnerRevenue,
} = require('../ownerRevenueService');
const { logActivite } = require('../services/auditService');
const { grilleTarifs, sauvegarderGrille, calculerDevis } = require('../pricingService');
const { normalizeHourString } = require('../reservationLockService');
const whatsappClient = require('../whatsappClient');
const { normalizeTelephoneStore } = require('../notificationService');

const router = express.Router();

router.get('/proprietaire/revenus', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  const db = await getDb();
  const from = periodStart(req.query.periode);
  const rows = queryAll(db, ownerRevenueRowsSql(), [from, req.user.id]);
  const totals = summarizeOwnerRevenue(rows);
  res.json({
    periode: req.query.periode || 'mois',
    depuis: from,
    avances_encaissees: Number(totals.avances_encaissees || 0),
    montants_reverses: Number(totals.montants_reverses || 0),
    reservations: Number(totals.reservations || 0),
    terrains: rows.map((terrain) => ({
      id: terrain.id,
      nom: terrain.nom,
      reservations: Number(terrain.reservations || 0),
      avances_encaissees: Number(terrain.avances_encaissees || 0),
      montants_reverses: Number(terrain.montants_reverses || 0),
    })),
  });
});

router.get('/gerant/portefeuille', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  const wallet = queryOne(db, `SELECT
    COALESCE(SUM(solde_disponible), 0) AS solde_disponible,
    COALESCE(SUM(total_encaisse), 0) AS total_encaisse,
    COALESCE(SUM(total_commission_prelevee), 0) AS total_commission_prelevee
    FROM portefeuille_gerant
    WHERE gerant_id = ?`, [req.user.id]) || {};
  const historique = queryAll(db, `SELECT reservation_id, montant, created_at AS date, statut
    FROM reversements
    WHERE gerant_id = ?
    ORDER BY created_at DESC
    LIMIT 50`, [req.user.id]);
  res.json({
    solde_disponible: Number(wallet.solde_disponible || 0),
    total_encaisse: Number(wallet.total_encaisse || 0),
    total_commission_prelevee: Number(wallet.total_commission_prelevee || 0),
    historique_reversements: historique,
  });
});

router.post('/gerant/creneaux', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  const { date, heure_debut, heure_fin } = req.body;
  if (!date || !heure_debut || !heure_fin) {
    return res.status(400).json({ error: 'date, heure_debut et heure_fin requis' });
  }
  const overlap = queryOne(
    db,
    `SELECT id FROM creneaux
      WHERE terrain_id = ? AND date = ?
        AND heure_debut < ? AND heure_fin > ?`,
    [req.user.terrain_id, date, heure_fin, heure_debut],
  );
  if (overlap) {
    return res.status(409).json({ error: 'Ce créneau chevauche un créneau existant', code: 'CRENEAU_CONFLIT' });
  }
  const overlapResa = queryOne(
    db,
    `SELECT id FROM reservations
      WHERE terrain_id = ? AND date = ?
        AND statut IN ('en_attente', 'confirme', 'match_joue', 'joue')
        AND heure_debut < ? AND heure_fin > ?`,
    [req.user.terrain_id, date, heure_fin, heure_debut],
  );
  if (overlapResa) {
    return res.status(409).json({ error: 'Ce créneau chevauche une réservation', code: 'CRENEAU_CONFLIT' });
  }
  const result = runSql(db, 'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)', [req.user.terrain_id, date, heure_debut, heure_fin, 'libre']);
  await logActivite({
    gerant_id: req.user.id,
    terrain_id: req.user.terrain_id,
    action: 'creneau_cree',
    details: { creneau_id: result.lastInsertRowid, date, heure_debut, heure_fin },
  }).catch((error) => console.error('Log activite creneau_cree:', error));
  res.status(201).json(queryOne(db, 'SELECT * FROM creneaux WHERE id = ?', [result.lastInsertRowid]));
});

router.patch('/gerant/creneaux/:id', authMiddleware, requireRole('gerant'), async (_req, res) => {
  return res.status(409).json({
    error: 'Le statut d’un créneau est géré par les réservations et le scan QR. Utilisez le calendrier ou une réservation manuelle.',
    code: 'SLOT_STATUS_LOCKED',
  });
});

router.delete('/gerant/creneaux/:id', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  const creneau = queryOne(db, "SELECT * FROM creneaux WHERE id = ? AND terrain_id = ? AND statut = 'libre'", [Number(req.params.id), req.user.terrain_id]);
  runSql(db, "DELETE FROM creneaux WHERE id = ? AND terrain_id = ? AND statut = 'libre'", [Number(req.params.id), req.user.terrain_id]);
  if (creneau) {
    await logActivite({
      gerant_id: req.user.id,
      terrain_id: req.user.terrain_id,
      action: 'creneau_supprime',
      details: { creneau_id: creneau.id, date: creneau.date, heure_debut: creneau.heure_debut, heure_fin: creneau.heure_fin },
    }).catch((error) => console.error('Log activite creneau_supprime:', error));
  }
  res.json({ message: 'Créneau supprimé' });
});

router.get('/gerant/tarifs', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [req.user.terrain_id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });
    res.json(grilleTarifs(db, terrain));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/gerant/devis', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [req.user.terrain_id]);
    if (!terrain) return res.status(404).json({ error: 'Terrain non trouvé' });
    const date = String(req.query.date || '');
    const heure_debut = normalizeHourString(req.query.heure_debut || '');
    const heure_fin = normalizeHourString(req.query.heure_fin || '');
    const format_terrain = req.query.format === 'moitie' ? 'moitie' : 'entier';
    if (!date || !heure_debut || !heure_fin) {
      return res.status(400).json({ error: 'date, heure_debut et heure_fin requis' });
    }
    res.json(calculerDevis(db, terrain, { date, heure_debut, heure_fin, format_terrain }));
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

router.put('/gerant/tarifs', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const grille = transaction(db, () => sauvegarderGrille(db, req.user.terrain_id, req.body || {}));
    await logActivite({
      gerant_id: req.user.id,
      terrain_id: req.user.terrain_id,
      action: 'tarifs_mis_a_jour',
      details: {
        prix_entier_base: grille.prix_entier_base,
        prix_moitie_base: grille.prix_moitie_base,
        cellules_perso: (grille.cellules || []).filter((c) => c.est_personnalise).length,
      },
    }).catch((error) => console.error('Log activite tarifs_mis_a_jour:', error));
    res.json(grille);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur serveur' });
  }
});

/** Fenêtre de retard check-in (appliquée à tous les créneaux du terrain). */
router.get('/gerant/fenetre-retard', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const row = queryOne(
      db,
      `SELECT fenetre_retard FROM creneaux WHERE terrain_id = ? AND fenetre_retard IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
      [req.user.terrain_id],
    );
    res.json({ fenetre_retard: Number(row?.fenetre_retard ?? 30) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/gerant/fenetre-retard', authMiddleware, requireRole('gerant'), async (req, res) => {
  try {
    const db = await getDb();
    const value = Number(req.body?.fenetre_retard);
    if (![0, 15, 30, 45, 60].includes(value)) {
      return res.status(400).json({ error: 'fenetre_retard invalide (0, 15, 30, 45 ou 60)' });
    }
    runSql(db, 'UPDATE creneaux SET fenetre_retard = ? WHERE terrain_id = ?', [value, req.user.terrain_id]);
    await logActivite({
      gerant_id: req.user.id,
      terrain_id: req.user.terrain_id,
      action: 'fenetre_retard_maj',
      details: { fenetre_retard: value },
    }).catch(() => {});
    res.json({ fenetre_retard: value });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

async function persistGerantWhatsapp(db, gerantId, phoneDigits) {
  if (!gerantId || !phoneDigits) return;
  let stored = String(phoneDigits);
  try {
    stored = normalizeTelephoneStore(phoneDigits);
  } catch {
    stored = `+${String(phoneDigits).replace(/\D/g, '')}`;
  }
  runSql(
    db,
    `UPDATE employes SET whatsapp_number = ?, whatsapp_wid = ?, whatsapp_connected_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [stored, String(phoneDigits).replace(/\D/g, ''), gerantId],
  );
}

function gerantWaKey(req) {
  return whatsappClient.gerantSessionKey(req.user.id);
}

router.get('/gerant/whatsapp/status', authMiddleware, requireRole('gerant'), async (req, res) => {
  const key = gerantWaKey(req);
  const status = await whatsappClient.getStatus(key);
  if (status.connected && status.phone) {
    const db = await getDb();
    await persistGerantWhatsapp(db, req.user.id, status.phone);
  }
  const db = await getDb();
  const employe = queryOne(db, 'SELECT whatsapp_number, whatsapp_wid, whatsapp_connected_at FROM employes WHERE id = ?', [req.user.id]);
  res.json({
    ...status,
    configured_number: employe?.whatsapp_number || null,
    connected_wid: employe?.whatsapp_wid || status.phone || null,
    connected_at: employe?.whatsapp_connected_at || null,
  });
});

router.post('/gerant/whatsapp/connect', authMiddleware, requireRole('gerant'), async (req, res) => {
  const key = gerantWaKey(req);
  if (!key) {
    return res.status(400).json({ error: 'Session gérant invalide' });
  }
  const force = Boolean(req.body?.force || req.query?.force);
  const db = await getDb();
  const employe = queryOne(
    db,
    'SELECT whatsapp_number, telephone FROM employes WHERE id = ?',
    [req.user.id],
  );
  const phoneNumber =
    whatsappClient.toWaIntlDigits?.(employe?.whatsapp_number) ||
    whatsappClient.toWaIntlDigits?.(employe?.telephone) ||
    whatsappClient.toWaIntlDigits?.(req.body?.telephone) ||
    null;

  const started = await whatsappClient.ensureStarted(key, { force, phoneNumber });
  const qr = await whatsappClient.getQrPayload(key);
  if (started.mock || qr.mock) {
    return res.status(503).json({
      error:
        'WhatsApp est en mode mock (WHATSAPP_MOCK=true). Passez WHATSAPP_MOCK=false dans backend/.env puis redémarrez l’API pour générer un QR.',
      mock: true,
      session: key,
    });
  }
  if (started.ready && started.phone) {
    await persistGerantWhatsapp(db, req.user.id, started.phone);
  }
  if (!started.ready && !qr.dataUrl && !qr.pairingCode) {
    return res.status(503).json({
      error:
        qr.error ||
        'QR / code WhatsApp indisponible pour le moment. Réessayez (Nouveau QR).',
      ...started,
      ...qr,
      session: key,
    });
  }
  res.json({ ...started, ...qr, session: key });
});

router.get('/gerant/whatsapp/qr', authMiddleware, requireRole('gerant'), async (req, res) => {
  const key = gerantWaKey(req);
  const status = await whatsappClient.getStatus(key);
  // Ne démarrer une session que s'il n'y a ni QR ni init en cours
  if (!status.connected && !status.initializing && !status.hasQr) {
    await whatsappClient.ensureStarted(key);
  }
  res.json(await whatsappClient.getQrPayload(key));
});

router.post('/gerant/whatsapp/disconnect', authMiddleware, requireRole('gerant'), async (req, res) => {
  const key = gerantWaKey(req);
  const status = await whatsappClient.logoutSession(key);
  res.json({ ...status, message: 'Session WhatsApp gérant déconnectée' });
});

module.exports = router;
