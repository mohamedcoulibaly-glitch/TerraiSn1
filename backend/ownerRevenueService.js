const PLAYED_STATUSES = ['match_joue', 'joue'];
/** Avances déjà payées : visibles proprio dès confirmation, pas seulement après le match. */
const REVENUE_STATUSES = ['confirme', 'match_joue', 'joue'];

function periodDays(period) {
  if (period === 'semaine') return 7;
  if (period === 'annee') return 365;
  return 31;
}

function periodStart(period) {
  const start = new Date();
  start.setDate(start.getDate() - periodDays(period) + 1);
  return start.toISOString().slice(0, 10);
}

function playedStatusSql(alias = 'r') {
  return `${alias}.statut IN ('${PLAYED_STATUSES.join("','")}')`;
}

function revenueStatusSql(alias = 'r') {
  return `${alias}.statut IN ('${REVENUE_STATUSES.join("','")}')`;
}

/**
 * Revenus proprio = supervision du flux avance → gérant (ledger `dus`).
 * Le propriétaire ne reçoit rien : montants_reverses = dû gérant (versé + encore dû).
 */
function ownerRevenueRowsSql({ ownerWhere = 't.proprietaire_id = ?', dateWhere = 'AND r.date >= ?' } = {}) {
  const joinResa = dateWhere
    ? `LEFT JOIN reservations r ON r.id = d.reservation_id ${dateWhere}`
    : 'LEFT JOIN reservations r ON r.id = d.reservation_id';
  const inPeriod = dateWhere ? 'd.id IS NOT NULL AND r.id IS NOT NULL' : 'd.id IS NOT NULL';
  return `SELECT
      t.id,
      t.nom,
      t.modele_revenus,
      t.commission_pourcentage,
      t.pourcentage_avance,
      t.payout_mode,
      t.remboursement_autorise,
      t.delai_remboursement_heures,
      t.abonnement_montant,
      t.achat_definitif_montant,
      t.achat_definitif_paye,
      COUNT(DISTINCT CASE WHEN ${inPeriod} AND d.statut != 'annule_rembourse' THEN d.reservation_id END) AS reservations,
      COALESCE(SUM(CASE WHEN ${inPeriod} AND d.statut != 'annule_rembourse' THEN d.avance ELSE 0 END), 0) AS avances_encaissees,
      COALESCE(SUM(CASE WHEN ${inPeriod} AND d.statut != 'annule_rembourse' THEN d.commission ELSE 0 END), 0) AS commissions_prelevees,
      COALESCE(SUM(CASE WHEN ${inPeriod} AND d.statut = 'verse' THEN d.du_gerant ELSE 0 END), 0) AS verse_au_gerant,
      COALESCE(SUM(CASE WHEN ${inPeriod} AND d.statut IN ('en_fenetre','payable','demande_retrait','echec') THEN d.du_gerant ELSE 0 END), 0) AS encore_du,
      COALESCE(SUM(CASE WHEN ${inPeriod} AND d.statut != 'annule_rembourse' THEN d.du_gerant ELSE 0 END), 0) AS montants_reverses
    FROM terrains t
    LEFT JOIN dus d ON d.terrain_id = t.id
    ${joinResa}
    WHERE ${ownerWhere}
    GROUP BY t.id, t.nom, t.modele_revenus, t.commission_pourcentage, t.pourcentage_avance,
      t.payout_mode, t.remboursement_autorise, t.delai_remboursement_heures,
      t.abonnement_montant, t.achat_definitif_montant, t.achat_definitif_paye`;
}

function summarizeOwnerRevenue(rows) {
  return {
    reservations: rows.reduce((sum, row) => sum + Number(row.reservations || 0), 0),
    avances_encaissees: rows.reduce((sum, row) => sum + Number(row.avances_encaissees || 0), 0),
    commissions_prelevees: rows.reduce((sum, row) => sum + Number(row.commissions_prelevees || 0), 0),
    verse_au_gerant: rows.reduce((sum, row) => sum + Number(row.verse_au_gerant || 0), 0),
    encore_du: rows.reduce((sum, row) => sum + Number(row.encore_du || 0), 0),
    montants_reverses: rows.reduce((sum, row) => sum + Number(row.montants_reverses || 0), 0),
  };
}

module.exports = {
  PLAYED_STATUSES,
  REVENUE_STATUSES,
  periodStart,
  playedStatusSql,
  revenueStatusSql,
  ownerRevenueRowsSql,
  summarizeOwnerRevenue,
};
