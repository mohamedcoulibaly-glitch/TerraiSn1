const express = require('express');
const { getDb, queryAll, queryOne, runSql } = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const {
  ownerRevenueRowsSql,
  periodStart,
  summarizeOwnerRevenue,
} = require('../ownerRevenueService');
const { logActivite } = require('../services/auditService');

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
  const result = runSql(db, 'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)', [req.user.terrain_id, date, heure_debut, heure_fin, 'libre']);
  await logActivite({
    gerant_id: req.user.id,
    terrain_id: req.user.terrain_id,
    action: 'creneau_cree',
    details: { creneau_id: result.lastInsertRowid, date, heure_debut, heure_fin },
  }).catch((error) => console.error('Log activite creneau_cree:', error));
  res.status(201).json(queryOne(db, 'SELECT * FROM creneaux WHERE id = ?', [result.lastInsertRowid]));
});

router.patch('/gerant/creneaux/:id', authMiddleware, requireRole('gerant'), async (req, res) => {
  const db = await getDb();
  if (!['libre', 'en_attente_paiement', 'reserve'].includes(req.body.statut)) return res.status(400).json({ error: 'Statut invalide' });
  runSql(db, 'UPDATE creneaux SET statut = ? WHERE id = ? AND terrain_id = ?', [req.body.statut, Number(req.params.id), req.user.terrain_id]);
  res.json({ message: 'Créneau mis à jour' });
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

module.exports = router;
