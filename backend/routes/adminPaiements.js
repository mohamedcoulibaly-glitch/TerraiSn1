const express = require('express');
const { getDb, queryOne, queryAll, transaction } = require('../database');
const paytechService = require('../paytechService');
const notificationService = require('../notificationService');
const logger = require('../logger');
const {
  chargerContrat,
  enregistrerContrat,
  avenantsTerrain,
} = require('../services/contratService');
const { previewFormules } = require('../services/calculsPaiement');
const { portefeuilleTerrain } = require('../services/ledgerService');
const {
  kpisCaisse,
  fileFenetre,
  filePayableAuto,
  filePayable,
  rapprochement,
  revenusPlateforme,
} = require('../services/caisseService');
const {
  relancerPayoutAuto,
  traiterFenetresExpirees,
  historiquePayouts,
} = require('../services/payoutEngine');
const {
  fileRetraits,
  executerRetraitDynamique,
  marquerRetraitEnvoye,
  rejeterRetrait,
} = require('../services/retraitService');

const router = express.Router();

router.get('/terrains/:id/contrat', async (req, res) => {
  const db = await getDb();
  const contrat = chargerContrat(db, Number(req.params.id));
  if (!contrat) return res.status(404).json({ error: 'Terrain introuvable' });
  res.json({
    contrat,
    avenants: avenantsTerrain(db, contrat.terrain_id),
    bandeau: 'En mode retrait, 0 frais. En mode auto, appliquer cette politique.',
  });
});

router.put('/terrains/:id/contrat', async (req, res) => {
  const db = await getDb();
  try {
    const contrat = transaction(db, () => enregistrerContrat(db, Number(req.params.id), req.body || {}, {
      auteurId: req.user?.id,
    }));
    res.json({ contrat, avenants: avenantsTerrain(db, Number(req.params.id)) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.post('/terrains/:id/contrat/preview', async (req, res) => {
  const db = await getDb();
  const contrat = chargerContrat(db, Number(req.params.id));
  if (!contrat) return res.status(404).json({ error: 'Terrain introuvable' });
  const merged = { ...contrat, ...(req.body || {}) };
  const prix = Number(req.body?.prix || 40000);
  res.json(previewFormules(merged, prix));
});

router.post('/terrains/:id/canaux/:canal/test-100', async (req, res) => {
  const db = await getDb();
  const canal = String(req.params.canal || '').toLowerCase() === 'om' ? 'om' : 'wave';
  const contrat = chargerContrat(db, Number(req.params.id));
  if (!contrat) return res.status(404).json({ error: 'Terrain introuvable' });
  const numero = canal === 'om' ? contrat.om_numero : contrat.wave_numero;
  if (!numero) return res.status(400).json({ error: `Numéro ${canal} absent` });
  try {
    const result = await paytechService.ordonnerPayout({
      numero,
      montant: 100,
      canal,
      reservationId: `test-${contrat.terrain_id}`,
      motif: 'test_100',
    });
    const colStatut = canal === 'om' ? 'om_statut' : 'wave_statut';
    transaction(db, () => {
      db.run(
        `UPDATE terrains SET ${colStatut} = CASE WHEN ${colStatut} = 'verifie' THEN ${colStatut} ELSE 'test_envoye' END WHERE id = ?`,
        [contrat.terrain_id],
      );
      db.run(
        `INSERT INTO tests_canal_100 (terrain_id, canal, numero, montant, statut, ref_paytech)
         VALUES (?, ?, ?, 100, 'envoye', ?)`,
        [contrat.terrain_id, canal, numero, result.ref_paytech || result.reference],
      );
    });
    await notificationService.envoyerTest100({
      telephone: contrat.gerant_whatsapp,
      canal,
    }).catch((error) => logger.error('adminPaiements.js', 'Notif test 100', error));
    res.json({ ok: true, canal, numero, ref: result.ref_paytech || result.reference, statut: 'test_envoye' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Test 100 FCFA impossible' });
  }
});

router.post('/terrains/:id/canaux/:canal/verifier', async (req, res) => {
  const db = await getDb();
  const canal = String(req.params.canal || '').toLowerCase() === 'om' ? 'om' : 'wave';
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(req.params.id)]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  const numero = canal === 'om' ? terrain.om_numero : terrain.wave_numero;
  if (!numero) return res.status(400).json({ error: `Numéro ${canal} absent` });
  const now = new Date().toISOString();
  if (canal === 'om') {
    db.run('UPDATE terrains SET om_statut = ?, om_verifie_at = ? WHERE id = ?', ['verifie', now, terrain.id]);
  } else {
    db.run('UPDATE terrains SET wave_statut = ?, wave_verifie_at = ? WHERE id = ?', ['verifie', now, terrain.id]);
  }
  require('../database').saveDb();
  res.json(chargerContrat(db, terrain.id));
});

router.get('/caisse/dashboard', async (_req, res) => {
  const db = await getDb();
  res.json(kpisCaisse(db));
});

router.get('/caisse/fenetre', async (_req, res) => {
  const db = await getDb();
  res.json(fileFenetre(db));
});

router.get('/caisse/payable-auto', async (_req, res) => {
  const db = await getDb();
  res.json(filePayableAuto(db));
});

router.get('/caisse/payable', async (_req, res) => {
  const db = await getDb();
  res.json(filePayable(db));
});

router.get('/caisse/retraits', async (req, res) => {
  const db = await getDb();
  const statut = req.query.statut == null ? 'en_attente' : String(req.query.statut);
  res.json(fileRetraits(db, statut === 'tous' ? null : statut));
});

router.post('/caisse/retraits/:id/envoyer', async (req, res) => {
  const db = await getDb();
  try {
    const modeManuel = Boolean(req.body?.mode_manuel || req.body?.manuel);
    let result;
    if (modeManuel) {
      // Fallback hors API (réf. manuelle) — conserve le comportement historique
      result = transaction(db, () => marquerRetraitEnvoye(db, Number(req.params.id), {
        traitePar: req.user?.id,
        refManuelle: req.body?.ref_manuelle,
      }));
      result = {
        ...result,
        ok: true,
        manuel: true,
        message_lisible: 'Retrait marqué envoyé (manuel)',
      };
    } else {
      result = await executerRetraitDynamique(db, Number(req.params.id), {
        traitePar: req.user?.id,
        refManuelle: req.body?.ref_manuelle,
        modeManuel: false,
      });
    }
    const contrat = chargerContrat(db, result.terrain_id);
    if (result.ok && !result.pending) {
      await notificationService.envoyerPayoutManuelOk({
        contrat,
        montant: result.montant_verse || result.montant,
        numero: result.wave_numero || result.om_numero,
      }).catch((error) => logger.error('adminPaiements.js', 'Notif retrait envoyé', error));
    }
    res.json(result);
  } catch (error) {
    logger.error('adminPaiements.js', 'Envoi retrait', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Erreur serveur',
      message_lisible: error.message || 'Erreur serveur',
    });
  }
});

router.post('/caisse/retraits/:id/rejeter', async (req, res) => {
  const db = await getDb();
  try {
    const demande = transaction(db, () => rejeterRetrait(db, Number(req.params.id), {
      traitePar: req.user?.id,
      motif: req.body?.motif,
    }));
    res.json(demande);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.post('/caisse/dus/:id/verser', async (req, res) => {
  const db = await getDb();
  try {
    const result = await relancerPayoutAuto(db, Number(req.params.id), {
      force: true,
      traitePar: req.user?.id,
    });
    if (result.ok && !result.pending) {
      const contrat = chargerContrat(db, result.du.terrain_id);
      await notificationService.envoyerPayoutAutoOk({
        contrat,
        du: result.du,
        dest: result.dest,
      }).catch((error) => logger.error('adminPaiements.js', 'Notif verser', error));
    }
    res.json({
      ...result,
      message_lisible: result.message_lisible
        || (result.ok ? (result.pending ? 'En attente prestataire' : 'Versement traité') : (result.error || result.raison)),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: error.message || 'Erreur serveur',
      message_lisible: error.message || 'Erreur serveur',
    });
  }
});

router.post('/caisse/tick-fenetres', async (_req, res) => {
  const db = await getDb();
  try {
    const results = await traiterFenetresExpirees(db);
    res.json({ processed: results.length, results });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.get('/caisse/historique', async (req, res) => {
  const db = await getDb();
  res.json(historiquePayouts(db, {
    terrainId: req.query.terrain_id ? Number(req.query.terrain_id) : null,
    limit: Number(req.query.limit || 100),
  }));
});

router.get('/rapprochement', async (_req, res) => {
  const db = await getDb();
  res.json(rapprochement(db));
});

router.get('/revenus-paiements', async (_req, res) => {
  const db = await getDb();
  res.json(revenusPlateforme(db));
});

router.get('/demandes-numero', async (_req, res) => {
  const db = await getDb();
  res.json(queryAll(
    db,
    `SELECT d.*, t.nom AS terrain_nom, e.nom AS gerant_nom
     FROM demandes_changement_numero d
     JOIN terrains t ON t.id = d.terrain_id
     LEFT JOIN employes e ON e.id = d.gerant_id
     ORDER BY d.created_at DESC`,
  ));
});

router.post('/demandes-numero/:id/valider', async (req, res) => {
  const db = await getDb();
  try {
    const demande = queryOne(db, 'SELECT * FROM demandes_changement_numero WHERE id = ?', [Number(req.params.id)]);
    if (!demande) return res.status(404).json({ error: 'Demande introuvable' });
    if (demande.statut !== 'en_attente') return res.status(409).json({ error: 'Déjà traitée' });
    const contrat = transaction(db, () => {
      db.run(
        `UPDATE demandes_changement_numero SET statut = 'validee', traite_par = ?, traite_at = ? WHERE id = ?`,
        [req.user?.id, new Date().toISOString(), demande.id],
      );
      return enregistrerContrat(db, demande.terrain_id, {
        wave_numero: demande.wave_numero,
        om_numero: demande.om_numero,
        numeros_identiques_whatsapp: demande.numeros_identiques_whatsapp,
      }, { auteurId: req.user?.id });
    });
    res.json({ demande: queryOne(db, 'SELECT * FROM demandes_changement_numero WHERE id = ?', [demande.id]), contrat });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
});

router.post('/demandes-numero/:id/refuser', async (req, res) => {
  const db = await getDb();
  const demande = queryOne(db, 'SELECT * FROM demandes_changement_numero WHERE id = ?', [Number(req.params.id)]);
  if (!demande) return res.status(404).json({ error: 'Demande introuvable' });
  db.run(
    `UPDATE demandes_changement_numero SET statut = 'refusee', traite_par = ?, motif = ?, traite_at = ? WHERE id = ?`,
    [req.user?.id, String(req.body?.motif || '').slice(0, 500), new Date().toISOString(), demande.id],
  );
  require('../database').saveDb();
  res.json(queryOne(db, 'SELECT * FROM demandes_changement_numero WHERE id = ?', [demande.id]));
});

router.get('/terrains/:id/portefeuille', async (req, res) => {
  const db = await getDb();
  const terrain = queryOne(db, 'SELECT id FROM terrains WHERE id = ?', [Number(req.params.id)]);
  if (!terrain) return res.status(404).json({ error: 'Terrain introuvable' });
  res.json(portefeuilleTerrain(db, terrain.id));
});

module.exports = router;
