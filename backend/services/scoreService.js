const { getDb, queryAll, queryOne, runSql } = require('../database');
const notificationService = require('../notificationService');

const LOW_SCORE_THRESHOLD = 50;

function currentPeriod(date = new Date()) {
  return date.toISOString().substring(0, 7);
}

function sixtyDaysAgoIso() {
  return new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
}

function scoreColor(score) {
  if (score > 75) return 'vert';
  if (score >= 50) return 'orange';
  return 'rouge';
}

function scoreFromRates(tauxScan, tauxNonAnnulation) {
  return Math.max(0, Math.min(100, Math.round((tauxScan * 0.6) + (tauxNonAnnulation * 0.4))));
}

async function getScoreInputs(db, gerantId, terrainId, sinceIso = sixtyDaysAgoIso()) {
  const scanStats = (await queryOne(db, `
    SELECT
      COUNT(*) AS total_confirmes,
      SUM(CASE WHEN r.qr_code_scanne_at IS NOT NULL THEN 1 ELSE 0 END) AS total_scannes
    FROM reservations r
    WHERE r.terrain_id = ?
      AND r.statut IN ('confirme', 'joue', 'match_joue')
      AND r.created_at >= ?
  `, [terrainId, sinceIso])) || {};

  const annulationStats = (await queryOne(db, `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN statut IN ('annule', 'annulee', 'refusee') THEN 1 ELSE 0 END) AS annules
    FROM reservations
    WHERE terrain_id = ?
      AND created_at >= ?
  `, [terrainId, sinceIso])) || {};

  const totalConfirmes = Number(scanStats.total_confirmes || 0);
  const totalScannes = Number(scanStats.total_scannes || 0);
  const totalReservations = Number(annulationStats.total || 0);
  const annules = Number(annulationStats.annules || 0);
  const tauxScan = totalConfirmes > 0 ? (totalScannes / totalConfirmes) * 100 : 100;
  const tauxNonAnnulation = totalReservations > 0 ? ((totalReservations - annules) / totalReservations) * 100 : 100;

  return {
    reservations_confirmees: totalConfirmes,
    matchs_scannes: totalScannes,
    taux_scan: tauxScan,
    annulations_total: annules,
    score: scoreFromRates(tauxScan, tauxNonAnnulation),
  };
}

async function verifierAlerteScore(db, gerantId, terrainId, scoreCeMois) {
  if (scoreCeMois >= LOW_SCORE_THRESHOLD) return;

  const previous = new Date();
  previous.setMonth(previous.getMonth() - 1);
  const periodePrecedente = currentPeriod(previous);
  const periodeActuelle = currentPeriod();

  const scorePrecedent = await queryOne(db, `
    SELECT score FROM score_confiance
    WHERE gerant_id = ? AND terrain_id = ? AND periode = ?
  `, [gerantId, terrainId, periodePrecedente]);
  if (!scorePrecedent || Number(scorePrecedent.score) >= LOW_SCORE_THRESHOLD) return;

  const scoreActuel = await queryOne(db, `
    SELECT alerte_envoyee FROM score_confiance
    WHERE gerant_id = ? AND terrain_id = ? AND periode = ?
  `, [gerantId, terrainId, periodeActuelle]);
  if (Number(scoreActuel?.alerte_envoyee || 0) === 1) return;

  const infos = await queryOne(db, `
    SELECT
      p.telephone AS proprio_tel,
      COALESCE(p.prenom, p.nom) AS proprio_prenom,
      COALESCE(e.prenom, e.nom) AS gerant_prenom,
      t.nom AS terrain_nom
    FROM terrains t
    JOIN proprietaires p ON p.id = t.proprietaire_id
    JOIN employes e ON e.terrain_id = t.id AND e.id = ?
    WHERE t.id = ?
  `, [gerantId, terrainId]);
  if (!infos) return;

  await notificationService.envoyerAlerteSilencieuse({
    telephone: infos.proprio_tel,
    prenom: infos.proprio_prenom,
    gerant_prenom: infos.gerant_prenom,
    terrain_nom: infos.terrain_nom,
  });

  await runSql(db, `
    UPDATE score_confiance SET alerte_envoyee = 1
    WHERE gerant_id = ? AND terrain_id = ? AND periode = ?
  `, [gerantId, terrainId, periodeActuelle]);
}

async function recalculerScore(gerant_id, terrain_id, options = {}) {
  if (!gerant_id || !terrain_id) return null;
  const db = await getDb();
  const inputs = await getScoreInputs(db, Number(gerant_id), Number(terrain_id));
  const periode = currentPeriod();

  const existant = await queryOne(db, `
    SELECT score FROM score_confiance
     WHERE gerant_id = ? AND terrain_id = ? AND periode = ?
  `, [Number(gerant_id), Number(terrain_id), periode]);
  const scoreAvant = existant ? Number(existant.score) : 100;

  await runSql(db, `
    INSERT INTO score_confiance
      (gerant_id, terrain_id, periode, reservations_confirmees,
       matchs_scannes, taux_scan, annulations_total, score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(gerant_id, terrain_id, periode) DO UPDATE SET
      reservations_confirmees = excluded.reservations_confirmees,
      matchs_scannes = excluded.matchs_scannes,
      taux_scan = excluded.taux_scan,
      annulations_total = excluded.annulations_total,
      score = excluded.score
  `, [
    Number(gerant_id),
    Number(terrain_id),
    periode,
    inputs.reservations_confirmees,
    inputs.matchs_scannes,
    inputs.taux_scan,
    inputs.annulations_total,
    inputs.score,
  ]);

  if (options.notify !== false) {
    await verifierAlerteScore(db, Number(gerant_id), Number(terrain_id), inputs.score);
    try {
      const infos = await queryOne(db, `
        SELECT t.nom AS terrain_nom, COALESCE(e.prenom, e.nom) AS gerant_prenom
          FROM terrains t
          LEFT JOIN employes e ON e.id = ?
         WHERE t.id = ?
      `, [Number(gerant_id), Number(terrain_id)]);
      const pushService = require('../pushService');
      await pushService.notifySanteTransition({
        terrainId: Number(terrain_id),
        gerantPrenom: infos?.gerant_prenom,
        score: inputs.score,
        scoreAvant,
        terrainNom: infos?.terrain_nom,
      });
    } catch (err) {
      console.warn('[PUSH] sante', err.message || err);
    }
  }

  try {
    const { notifyTerrain } = require('../realtimeHub');
    notifyTerrain(terrain_id, 'sante', {
      action: 'score_updated',
      score: inputs.score,
      gerant_id: Number(gerant_id),
    });
  } catch {
    /* hub optionnel au boot */
  }

  return inputs.score;
}

async function recalculerScoresTerrain(terrain_id, options = {}) {
  const db = await getDb();
  const gerants = await queryAll(db, 'SELECT id FROM employes WHERE terrain_id = ? AND is_active = 1', [Number(terrain_id)]);
  const scores = [];
  for (const gerant of gerants) {
    scores.push(await recalculerScore(gerant.id, Number(terrain_id), options));
  }
  return scores;
}

async function getSanteTerrain(db, terrainId) {
  const month = currentPeriod();
  const row = (await queryOne(db, `
    SELECT
      COUNT(*) AS total_confirmes,
      SUM(CASE WHEN r.qr_code_scanne_at IS NOT NULL THEN 1 ELSE 0 END) AS matchs_scannes
    FROM reservations r
    WHERE r.terrain_id = ?
      AND r.statut IN ('confirme', 'joue', 'match_joue')
      AND substr(r.date, 1, 7) = ?
  `, [terrainId, month])) || {};

  const totalConfirmes = Number(row.total_confirmes || 0);
  const matchsScannes = Number(row.matchs_scannes || 0);
  const tauxScan = totalConfirmes > 0 ? Math.round((matchsScannes / totalConfirmes) * 100) : 100;
  const scoreRow = await queryOne(db, `
    SELECT score FROM score_confiance
    WHERE terrain_id = ? AND periode = ?
    ORDER BY created_at DESC LIMIT 1
  `, [terrainId, month]);
  const scoreInputs = await getScoreInputs(db, null, terrainId);
  const score = scoreRow ? Number(scoreRow.score || 100) : scoreInputs.score;
  const nonScannes = await queryAll(db, `
    SELECT id, joueur_nom, date, heure_debut, heure_fin, code_reservation
    FROM reservations
    WHERE terrain_id = ?
      AND statut = 'confirme'
      AND qr_code_scanne_at IS NULL
      AND substr(date, 1, 7) = ?
    ORDER BY date ASC, heure_debut ASC
    LIMIT 20
  `, [terrainId, month]);
  const historiqueScores = (await queryAll(db, `
    SELECT periode, score
    FROM score_confiance
    WHERE terrain_id = ?
    ORDER BY periode DESC
    LIMIT 6
  `, [terrainId])).reverse();
  const activiteRecente = await queryAll(db, `
    SELECT action, reservation_id, created_at
    FROM activite_gerant
    WHERE terrain_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `, [terrainId]);
  const reservationsNonScannees = nonScannes.map((reservation) => ({
    id: reservation.id,
    joueur_nom: reservation.joueur_nom,
    date: reservation.date,
    heure: reservation.heure_debut,
    heure_debut: reservation.heure_debut,
    heure_fin: reservation.heure_fin,
    code: reservation.code_reservation,
    code_reservation: reservation.code_reservation,
  }));

  return {
    score_confiance: score,
    couleur: scoreColor(score),
    taux_scan: tauxScan,
    matchs_scannes: matchsScannes,
    total_confirmes: totalConfirmes,
    matchs_non_scannes: Math.max(0, totalConfirmes - matchsScannes),
    annulations_total: scoreInputs.annulations_total,
    historique_scores: historiqueScores,
    activite_recente: activiteRecente,
    reservations_non_scannees: reservationsNonScannees,
    reservations_non_scannes: reservationsNonScannees,
  };
}

async function verifierAnnulationsRepetees() {
  const db = await getDb();
  const gerants = await queryAll(db, 'SELECT DISTINCT gerant_id, terrain_id FROM activite_gerant');
  for (const item of gerants) {
    const semaineCourante = (await queryOne(db, `
      SELECT COUNT(*) AS total FROM activite_gerant
      WHERE gerant_id = ? AND terrain_id = ?
        AND action = 'reservation_annulee'
        AND created_at >= NOW() - INTERVAL '7 days'
    `, [item.gerant_id, item.terrain_id])) || {};
    const semainePrecedente = (await queryOne(db, `
      SELECT COUNT(*) AS total FROM activite_gerant
      WHERE gerant_id = ? AND terrain_id = ?
        AND action = 'reservation_annulee'
        AND created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'
    `, [item.gerant_id, item.terrain_id])) || {};
    if (Number(semaineCourante.total || 0) > 5 && Number(semainePrecedente.total || 0) > 5) {
      await recalculerScore(item.gerant_id, item.terrain_id);
    }
  }
}

async function verifierInactiviteScan() {
  const db = await getDb();
  const gerants = await queryAll(db, `
    SELECT DISTINCT e.id AS gerant_id, t.id AS terrain_id
    FROM terrains t
    JOIN employes e ON e.terrain_id = t.id AND e.is_active = 1
    WHERE COALESCE(t.is_active, 1) = 1
      AND e.id NOT IN (
        SELECT gerant_id FROM activite_gerant
        WHERE action = 'qr_scanne'
          AND created_at >= NOW() - INTERVAL '21 days'
      )
  `);

  for (const item of gerants) {
    const reservationsConfirmees = (await queryOne(db, `
      SELECT COUNT(*) AS total FROM reservations
      WHERE terrain_id = ?
        AND statut = 'confirme'
        AND created_at >= NOW() - INTERVAL '21 days'
    `, [item.terrain_id])) || {};
    if (Number(reservationsConfirmees.total || 0) >= 5) {
      await recalculerScore(item.gerant_id, item.terrain_id);
    }
  }
}

module.exports = {
  recalculerScore,
  recalculerScoresTerrain,
  getSanteTerrain,
  verifierAnnulationsRepetees,
  verifierInactiviteScan,
};
