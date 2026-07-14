const express = require('express');
const { getDb, queryAll, queryOne, runSql } = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/proprietaire/revenus', authMiddleware, requireRole('proprietaire'), async (req, res) => {
  const db = await getDb();
  const days = req.query.periode === 'semaine' ? 7 : 31;
  const start = new Date(); start.setDate(start.getDate() - days + 1);
  const from = start.toISOString().slice(0, 10);
  const rows = queryAll(db, `SELECT t.id, t.nom,
    COUNT(DISTINCT r.id) AS reservations,
    COALESCE(SUM(CASE WHEN p.statut = 'paye' THEN p.montant_acompte ELSE 0 END), 0) AS acomptes_encaisses,
    COALESCE(SUM(CASE WHEN p.statut = 'paye' THEN p.montant_commission ELSE 0 END), 0) AS commissions_prelevees,
    COALESCE(SUM(CASE WHEN p.statut = 'paye' THEN p.montant_reverse ELSE 0 END), 0) AS montants_reverses
    FROM terrains t
    LEFT JOIN reservations r ON r.terrain_id = t.id AND r.date >= ?
    LEFT JOIN paiements p ON p.reservation_id = r.id
    WHERE t.proprietaire_id = ?
    GROUP BY t.id, t.nom`, [from, req.user.id]);
  res.json({
    depuis: from,
    reservations: rows.reduce((s, r) => s + Number(r.reservations), 0),
    acomptes_encaisses: rows.reduce((s, r) => s + Number(r.acomptes_encaisses), 0),
    commissions_prelevees: rows.reduce((s, r) => s + Number(r.commissions_prelevees), 0),
    montants_reverses: rows.reduce((s, r) => s + Number(r.montants_reverses), 0),
    terrains: rows,
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
  runSql(db, "DELETE FROM creneaux WHERE id = ? AND terrain_id = ? AND statut = 'libre'", [Number(req.params.id), req.user.terrain_id]);
  res.json({ message: 'Créneau supprimé' });
});

module.exports = router;
