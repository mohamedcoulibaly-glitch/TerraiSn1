/**
 * Rappels d'échéances (in-app / push) — essai gratuit et dettes commission.
 *
 * Branché sur le cron quotidien existant (index.js, suspensions abonnements) : aucun nouveau cron.
 * Idempotent : les paliers J-7 / J-3 / J-1 / retard sont mémorisés
 *   - essai : terrains.notif_essai_fin_j7 / j3 / j1
 *   - dette : resume_dette_periode.notif_j7_envoyee / j3 / j1 / retard
 * Aucune logique de calcul paiement ici : lecture seule des montants + envoi de notifications.
 */
const { getDb, queryAll, queryOne, runSql } = require('../database');
const logger = require('../logger');

function ymd(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  const a = new Date(`${String(from).slice(0, 10)}T12:00:00`);
  const b = new Date(`${String(to).slice(0, 10)}T12:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function palier(jours) {
  if (jours < 0) return 'retard';
  if (jours <= 1) return 'j1';
  if (jours <= 3) return 'j3';
  if (jours <= 7) return 'j7';
  return null;
}

/** Essai gratuit : prévient gérants + propriétaire à J-7 / J-3 / J-1 avant essai_fin_at. */
async function rappelsFinEssai(today = ymd()) {
  const pushService = require('../pushService');
  const db = await getDb();
  const terrains = queryAll(
    db,
    `SELECT id, nom, essai_fin_at, notif_essai_fin_j7, notif_essai_fin_j3, notif_essai_fin_j1
       FROM terrains
      WHERE COALESCE(mode_essai, 0) = 1
        AND COALESCE(essai_suspendu_auto, 0) = 0
        AND essai_fin_at IS NOT NULL`,
  );
  let envoyes = 0;
  for (const terrain of terrains) {
    const jours = daysBetween(today, terrain.essai_fin_at);
    if (jours < 0) continue;
    const p = palier(jours);
    if (!p || p === 'retard') continue;
    const col = `notif_essai_fin_${p}`;
    if (Number(terrain[col]) === 1) continue;

    const label = jours === 0 ? "aujourd'hui" : `dans ${jours} jour${jours > 1 ? 's' : ''}`;
    await pushService.notifyTerrainTeam(terrain.id, {
      type: 'essai_expire',
      titre: 'Essai gratuit bientôt terminé',
      corps: `${terrain.nom} : l'essai gratuit se termine ${label}. Contacte TerrainSN pour la suite.`,
      url: '/backoffice',
      level: p === 'j7' ? 'info' : 'warning',
      tag: `essai-${terrain.id}-${p}`,
      prefColumn: 'push_abonnement',
    }, { gerants: true, proprietaire: true });

    // Marque ce palier et les plus lointains (évite un rattrapage en rafale)
    const flags = { j7: ['j7'], j3: ['j7', 'j3'], j1: ['j7', 'j3', 'j1'] }[p];
    const sets = flags.map((f) => `notif_essai_fin_${f} = 1`).join(', ');
    runSql(db, `UPDATE terrains SET ${sets} WHERE id = ?`, [terrain.id]);
    envoyes += 1;
  }
  return envoyes;
}

/** Dettes commission en attente : rappels J-7 / J-3 / J-1 / retard au gérant concerné. */
async function rappelsDettesCommission(today = ymd()) {
  const pushService = require('../pushService');
  const db = await getDb();
  const groupes = queryAll(
    db,
    `SELECT d.terrain_id, d.gerant_id, d.periode,
            MIN(d.date_echeance) AS echeance,
            COALESCE(SUM(MAX(0, d.montant_commission - COALESCE(d.montant_regle, 0))), 0) AS solde,
            t.nom AS terrain_nom
       FROM dettes_commissions d
       JOIN terrains t ON t.id = d.terrain_id
      WHERE d.statut = 'en_attente' AND d.date_echeance IS NOT NULL AND d.gerant_id IS NOT NULL
      GROUP BY d.terrain_id, d.gerant_id, d.periode`,
  );
  let envoyes = 0;
  for (const g of groupes) {
    if (Number(g.solde) <= 0) continue;
    const jours = daysBetween(today, g.echeance);
    const p = palier(jours);
    if (!p) continue;

    runSql(
      db,
      `INSERT OR IGNORE INTO resume_dette_periode
        (terrain_id, gerant_id, periode, total_commission, solde_restant, date_echeance)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [g.terrain_id, g.gerant_id, g.periode, g.solde, g.solde, String(g.echeance).slice(0, 10)],
    );
    const row = queryOne(
      db,
      `SELECT id, notif_j7_envoyee, notif_j3_envoyee, notif_j1_envoyee, notif_retard_envoyee
         FROM resume_dette_periode WHERE terrain_id = ? AND gerant_id = ? AND periode = ?`,
      [g.terrain_id, g.gerant_id, g.periode],
    );
    if (!row) continue;
    const flagCol = p === 'retard' ? 'notif_retard_envoyee' : `notif_${p}_envoyee`;
    // Met à jour le solde à chaque passage (lecture pure des dettes, pas de recalcul métier)
    runSql(
      db,
      `UPDATE resume_dette_periode
          SET solde_restant = ?, date_echeance = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [g.solde, String(g.echeance).slice(0, 10), row.id],
    );
    if (Number(row[flagCol]) === 1) continue;

    const montant = `${Number(g.solde).toLocaleString('fr-FR')} FCFA`;
    const echeanceTxt = String(g.echeance).slice(0, 10);
    const corps = p === 'retard'
      ? `${g.terrain_nom} : ${montant} de commission en retard (échéance ${echeanceTxt}).`
      : `${g.terrain_nom} : ${montant} de commission à régler avant le ${echeanceTxt}.`;
    await pushService.notifyAccount({
      userId: g.gerant_id,
      accountType: 'employe',
      type: p === 'retard' ? 'dette_retard' : 'dette_rappel',
      titre: p === 'retard' ? 'Commission en retard' : 'Rappel commission',
      corps,
      url: '/backoffice/gerant/finances',
      level: p === 'retard' ? 'error' : p === 'j7' ? 'info' : 'warning',
      tag: `dette-${g.terrain_id}-${g.gerant_id}-${g.periode}-${p}`,
      prefColumn: 'push_dette_rappel',
    });

    const flags = {
      j7: ['notif_j7_envoyee'],
      j3: ['notif_j7_envoyee', 'notif_j3_envoyee'],
      j1: ['notif_j7_envoyee', 'notif_j3_envoyee', 'notif_j1_envoyee'],
      retard: ['notif_j7_envoyee', 'notif_j3_envoyee', 'notif_j1_envoyee', 'notif_retard_envoyee'],
    }[p];
    runSql(db, `UPDATE resume_dette_periode SET ${flags.map((f) => `${f} = 1`).join(', ')} WHERE id = ?`, [row.id]);
    envoyes += 1;
  }
  return envoyes;
}

/**
 * Abonnements : rappels J-7 / J-3 / J-1 au propriétaire + notif si terrain suspendu (grâce expirée).
 * Flags : abonnements.notif_j7 / notif_j3 / notif_j1 / notif_suspendu.
 */
async function rappelsAbonnements(today = ymd()) {
  const pushService = require('../pushService');
  const { GRACE_DAYS } = require('../revenueModelService');
  const db = await getDb();
  const rows = queryAll(
    db,
    `SELECT a.id, a.terrain_id, a.date_echeance, a.statut, a.montant,
            a.notif_j7, a.notif_j3, a.notif_j1, a.notif_suspendu,
            t.nom AS terrain_nom, t.proprietaire_id, t.is_active
       FROM abonnements a
       JOIN terrains t ON t.id = a.terrain_id
      WHERE a.statut != 'paye'
        AND t.modele_revenus = 'abonnement'`,
  );
  let envoyes = 0;
  for (const row of rows) {
    const echeance = String(row.date_echeance || '').slice(0, 10);
    if (!echeance) continue;
    const jours = daysBetween(today, echeance);
    const graceEnd = new Date(`${echeance}T12:00:00`);
    graceEnd.setDate(graceEnd.getDate() + Number(GRACE_DAYS || 0));
    const graceYmd = graceEnd.toISOString().slice(0, 10);
    const joursGrace = daysBetween(today, graceYmd);
    const suspendu = Number(row.is_active) === 0 || joursGrace < 0;

    if (suspendu && Number(row.notif_suspendu) !== 1) {
      await pushService.notifyTerrainTeam(row.terrain_id, {
        type: 'abonnement_suspendu',
        titre: 'Terrain suspendu — abonnement',
        corps: `${row.terrain_nom} : l'abonnement n'est pas réglé. Le terrain est suspendu.`,
        url: '/backoffice/proprietaire',
        level: 'error',
        tag: `abo-suspendu-${row.id}`,
        prefColumn: 'push_abonnement',
      }, { gerants: false, proprietaire: true });
      runSql(db, 'UPDATE abonnements SET notif_suspendu = 1, notif_j7 = 1, notif_j3 = 1, notif_j1 = 1 WHERE id = ?', [row.id]);
      envoyes += 1;
      continue;
    }

    const p = palier(jours);
    if (!p || p === 'retard') continue;
    const col = `notif_${p}`;
    if (Number(row[col]) === 1) continue;

    const label = jours === 0 ? "aujourd'hui" : `dans ${jours} jour${jours > 1 ? 's' : ''}`;
    await pushService.notifyTerrainTeam(row.terrain_id, {
      type: 'abonnement_rappel',
      titre: 'Échéance abonnement',
      corps: `${row.terrain_nom} : échéance ${echeance} (${label}) — ${Number(row.montant || 0).toLocaleString('fr-FR')} FCFA.`,
      url: '/backoffice/proprietaire',
      level: p === 'j7' ? 'info' : 'warning',
      tag: `abo-${row.id}-${p}`,
      prefColumn: 'push_abonnement',
    }, { gerants: false, proprietaire: true });

    const flags = { j7: ['notif_j7'], j3: ['notif_j7', 'notif_j3'], j1: ['notif_j7', 'notif_j3', 'notif_j1'] }[p];
    runSql(db, `UPDATE abonnements SET ${flags.map((f) => `${f} = 1`).join(', ')} WHERE id = ?`, [row.id]);
    envoyes += 1;
  }
  return envoyes;
}

async function executerRappelsEcheances() {
  const out = { essai: 0, dettes: 0, abonnements: 0 };
  try {
    out.essai = await rappelsFinEssai();
  } catch (err) {
    logger.error('rappelsEcheances.js', 'Rappels fin essai', err);
  }
  try {
    out.dettes = await rappelsDettesCommission();
  } catch (err) {
    logger.error('rappelsEcheances.js', 'Rappels dettes commission', err);
  }
  try {
    out.abonnements = await rappelsAbonnements();
  } catch (err) {
    logger.error('rappelsEcheances.js', 'Rappels abonnements', err);
  }
  return out;
}

module.exports = {
  palier,
  daysBetween,
  rappelsFinEssai,
  rappelsDettesCommission,
  rappelsAbonnements,
  executerRappelsEcheances,
};
