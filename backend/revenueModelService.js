const { queryAll, queryOne } = require('./database');

const GRACE_DAYS = 3;

function prochaineEcheanceMensuelle(from = new Date()) {
  const date = new Date(from);
  date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function ensurePendingAbonnement(database, terrainId, montant) {
  const amount = Number(montant || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const existing = queryOne(database, "SELECT * FROM abonnements WHERE terrain_id = ? AND statut != 'paye' ORDER BY date_echeance DESC LIMIT 1", [terrainId]);
  if (existing) return existing;

  const dateEcheance = prochaineEcheanceMensuelle();
  database.run('INSERT INTO abonnements (terrain_id, montant, date_echeance, statut) VALUES (?, ?, ?, ?)', [terrainId, amount, dateEcheance, 'en_attente']);
  database.run('UPDATE terrains SET abonnement_prochain_paiement = ? WHERE id = ?', [dateEcheance, terrainId]);
  return queryOne(database, 'SELECT * FROM abonnements WHERE terrain_id = ? ORDER BY id DESC LIMIT 1', [terrainId]);
}

function marquerAbonnementPaye(database, abonnementId) {
  const abonnement = queryOne(database, `SELECT a.*, t.modele_revenus, t.abonnement_montant
    FROM abonnements a JOIN terrains t ON t.id = a.terrain_id
    WHERE a.id = ?`, [abonnementId]);
  if (!abonnement) {
    const error = new Error('Abonnement introuvable');
    error.statusCode = 404;
    throw error;
  }
  if (abonnement.statut === 'paye') return abonnement;

  const nextDueDate = prochaineEcheanceMensuelle();
  database.run("UPDATE abonnements SET statut = 'paye', paye_le = CURRENT_TIMESTAMP WHERE id = ?", [abonnementId]);
  database.run('UPDATE terrains SET is_active = 1, abonnement_prochain_paiement = ? WHERE id = ?', [nextDueDate, abonnement.terrain_id]);

  if (abonnement.modele_revenus === 'abonnement') {
    const nextAmount = Number(abonnement.abonnement_montant || abonnement.montant || 0);
    database.run('INSERT INTO abonnements (terrain_id, montant, date_echeance, statut) VALUES (?, ?, ?, ?)', [abonnement.terrain_id, nextAmount, nextDueDate, 'en_attente']);
  }

  return queryOne(database, 'SELECT * FROM abonnements WHERE id = ?', [abonnementId]);
}

function marquerAchatDefinitifPaye(database, terrainId, montantPaye = null) {
  const terrain = queryOne(database, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
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
  database.run(`UPDATE terrains
    SET modele_revenus = 'achat_definitif',
        achat_definitif_montant = ?,
        achat_definitif_paye = 1,
        commission_pourcentage = 0,
        abonnement_montant = 0,
        abonnement_prochain_paiement = NULL,
        is_active = 1
    WHERE id = ?`, [montant, terrainId]);
  database.run("UPDATE abonnements SET statut = 'paye', paye_le = COALESCE(paye_le, CURRENT_TIMESTAMP) WHERE terrain_id = ? AND statut != 'paye'", [terrainId]);
  return queryOne(database, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
}

function appliquerSuspensionsAbonnements(database) {
  database.run(`UPDATE abonnements
    SET statut = 'en_retard'
    WHERE statut = 'en_attente' AND date('now') > date(date_echeance)`);
  database.run(`UPDATE terrains
    SET is_active = 0
    WHERE modele_revenus = 'abonnement'
      AND id IN (
        SELECT terrain_id FROM abonnements
        WHERE statut != 'paye' AND date('now') > date(date_echeance, '+${GRACE_DAYS} days')
      )`);
}

function abonnementsAvecEtat(database) {
  return queryAll(database, `SELECT a.*, t.nom AS terrain_nom, t.is_active,
    CASE
      WHEN a.statut != 'paye' AND date('now') > date(a.date_echeance, '+${GRACE_DAYS} days') THEN 'suspension_due'
      WHEN a.statut != 'paye' AND date('now') > date(a.date_echeance) THEN 'grace'
      ELSE a.statut
    END AS etat_operationnel,
    date(a.date_echeance, '+${GRACE_DAYS} days') AS suspension_apres
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
