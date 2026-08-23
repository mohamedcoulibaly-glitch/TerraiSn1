const { queryAll, queryOne, runSql } = require('./database');

const GRACE_DAYS = 3;

function prochaineEcheanceMensuelle(from = new Date()) {
  const date = new Date(from);
  date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 10);
}

async function ensurePendingAbonnement(database, terrainId, montant) {
  const amount = Number(montant || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const existing = await queryOne(database, "SELECT * FROM abonnements WHERE terrain_id = ? AND statut != 'paye' ORDER BY date_echeance DESC LIMIT 1", [terrainId]);
  if (existing) return existing;

  const dateEcheance = prochaineEcheanceMensuelle();
  await runSql(database, 'INSERT INTO abonnements (terrain_id, montant, date_echeance, statut) VALUES (?, ?, ?, ?)', [terrainId, amount, dateEcheance, 'en_attente']);
  await runSql(database, 'UPDATE terrains SET abonnement_prochain_paiement = ? WHERE id = ?', [dateEcheance, terrainId]);
  return await queryOne(database, 'SELECT * FROM abonnements WHERE terrain_id = ? ORDER BY id DESC LIMIT 1', [terrainId]);
}

async function marquerAbonnementPaye(database, abonnementId) {
  const abonnement = await queryOne(database, `SELECT a.*, t.modele_revenus, t.abonnement_montant, t.is_active
    FROM abonnements a JOIN terrains t ON t.id = a.terrain_id
    WHERE a.id = ?`, [abonnementId]);
  if (!abonnement) {
    const error = new Error('Abonnement introuvable');
    error.statusCode = 404;
    throw error;
  }
  if (abonnement.statut === 'paye') return abonnement;

  const etaitSuspendu = Number(abonnement.is_active) === 0;
  const nextDueDate = prochaineEcheanceMensuelle();
  await runSql(database, "UPDATE abonnements SET statut = 'paye', paye_le = CURRENT_TIMESTAMP WHERE id = ?", [abonnementId]);
  await runSql(database, 'UPDATE terrains SET is_active = 1, abonnement_prochain_paiement = ? WHERE id = ?', [nextDueDate, abonnement.terrain_id]);

  if (abonnement.modele_revenus === 'abonnement') {
    const nextAmount = Number(abonnement.abonnement_montant || abonnement.montant || 0);
    await runSql(database, 'INSERT INTO abonnements (terrain_id, montant, date_echeance, statut) VALUES (?, ?, ?, ?)', [abonnement.terrain_id, nextAmount, nextDueDate, 'en_attente']);
  }

  if (etaitSuspendu) {
    try {
      const pushService = require('./pushService');
      await pushService.notifyTerrainReactive(abonnement.terrain_id);
    } catch (err) {
      console.warn('[PUSH] terrain reactive', err.message || err);
    }
  }

  return await queryOne(database, 'SELECT * FROM abonnements WHERE id = ?', [abonnementId]);
}

async function marquerAchatDefinitifPaye(database, terrainId, montantPaye = null) {
  const terrain = await queryOne(database, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) {
    const error = new Error('Terrain introuvable');
    error.statusCode = 404;
    throw error;
  }
  const montant = Number(montantPaye ?? terrain.achat_definitif_montant ?? 0);
  if (!Number.isFinite(montant) || montant < 0) {
    const error = new Error('Montant achat definitif invalide');
    error.statusCode = 400;
    throw error;
  }
  await runSql(database, `UPDATE terrains
    SET modele_revenus = 'achat_definitif',
        achat_definitif_montant = ?,
        achat_definitif_paye = 1,
        commission_pourcentage = 0,
        abonnement_montant = 0,
        abonnement_prochain_paiement = NULL,
        is_active = 1
    WHERE id = ?`, [montant, terrainId]);
  await runSql(database, "UPDATE abonnements SET statut = 'paye', paye_le = COALESCE(paye_le, CURRENT_TIMESTAMP) WHERE terrain_id = ? AND statut != 'paye'", [terrainId]);
  return await queryOne(database, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
}

async function appliquerSuspensionsAbonnements(database) {
  await runSql(database, `UPDATE abonnements
    SET statut = 'en_retard'
    WHERE statut = 'en_attente' AND CURRENT_DATE > date_echeance`);

  const aSuspendre = await queryAll(database, `
    SELECT t.id, t.nom
      FROM terrains t
     WHERE t.modele_revenus = 'abonnement'
       AND COALESCE(t.is_active, 1) = 1
       AND t.id IN (
         SELECT terrain_id FROM abonnements
         WHERE statut != 'paye' AND CURRENT_DATE > (date_echeance + INTERVAL '${GRACE_DAYS} days')
       )
  `);

  await runSql(database, `UPDATE terrains
    SET is_active = 0
    WHERE modele_revenus = 'abonnement'
      AND id IN (
        SELECT terrain_id FROM abonnements
        WHERE statut != 'paye' AND CURRENT_DATE > (date_echeance + INTERVAL '${GRACE_DAYS} days')
      )`);

  for (const row of aSuspendre) {
    try {
      const pushService = require('./pushService');
      await pushService.notifyTerrainSuspendu(row.id, { motif: 'abonnement' });
    } catch (err) {
      console.warn('[PUSH] terrain suspendu', err.message || err);
    }
  }
  return aSuspendre.length;
}

async function abonnementsAvecEtat(database) {
  return await queryAll(database, `SELECT a.*, t.nom AS terrain_nom, t.is_active,
    CASE
      WHEN a.statut != 'paye' AND CURRENT_DATE > (a.date_echeance + INTERVAL '${GRACE_DAYS} days') THEN 'suspension_due'
      WHEN a.statut != 'paye' AND CURRENT_DATE > a.date_echeance THEN 'grace'
      ELSE a.statut
    END AS etat_operationnel,
    (a.date_echeance + INTERVAL '${GRACE_DAYS} days')::date AS suspension_apres
    FROM abonnements a
    JOIN terrains t ON t.id = a.terrain_id
    ORDER BY a.date_echeance ASC`);
}

module.exports = {
  GRACE_DAYS,
  prochaineEcheanceMensuelle,
  ensurePendingAbonnement,
  marquerAbonnementPaye,
  marquerAchatDefinitifPaye,
  appliquerSuspensionsAbonnements,
  abonnementsAvecEtat,
};
