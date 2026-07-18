const PLAYED_STATUSES = ['match_joue', 'joue'];

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

function paidAdvanceSql(paymentAlias = 'p', reservationAlias = 'r') {
  return `CASE
    WHEN ${paymentAlias}.statut = 'paye' AND ${paymentAlias}.montant_acompte IS NOT NULL THEN COALESCE(${paymentAlias}.montant_acompte, 0)
    WHEN ${paymentAlias}.statut = 'paye' AND ${paymentAlias}.montant_commission IS NOT NULL THEN COALESCE(${paymentAlias}.montant, ${reservationAlias}.montant_avance, 0)
    WHEN ${paymentAlias}.statut = 'paye' AND ${paymentAlias}.montant_reverse IS NOT NULL THEN COALESCE(${paymentAlias}.montant, ${reservationAlias}.montant_avance, 0)
    ELSE 0
  END`;
}

function commissionSql(terrainAlias = 't', paymentAlias = 'p', reservationAlias = 'r') {
  const advance = paidAdvanceSql(paymentAlias, reservationAlias);
  return `CASE
    WHEN ${terrainAlias}.modele_revenus = 'commission' THEN
      COALESCE(${paymentAlias}.montant_commission, ROUND((${advance}) * COALESCE(${terrainAlias}.commission_pourcentage, 0) / 100.0))
    ELSE 0
  END`;
}

function ownerRevenueRowsSql({ ownerWhere = 't.proprietaire_id = ?', dateWhere = 'AND r.date >= ?' } = {}) {
  const played = playedStatusSql('r');
  const advance = paidAdvanceSql('p', 'r');
  const commission = commissionSql('t', 'p', 'r');
  return `SELECT
      t.id,
      t.nom,
      t.modele_revenus,
      t.commission_pourcentage,
      t.abonnement_montant,
      t.achat_definitif_montant,
      t.achat_definitif_paye,
      COUNT(DISTINCT CASE WHEN ${played} THEN r.id END) AS reservations,
      COALESCE(SUM(CASE WHEN ${played} THEN ${advance} ELSE 0 END), 0) AS avances_encaissees,
      COALESCE(SUM(CASE WHEN ${played} THEN ${commission} ELSE 0 END), 0) AS commissions_prelevees,
      COALESCE(SUM(CASE WHEN ${played} THEN (${advance}) - (${commission}) ELSE 0 END), 0) AS montants_reverses
    FROM terrains t
    LEFT JOIN reservations r ON r.terrain_id = t.id ${dateWhere}
    LEFT JOIN paiements p ON p.reservation_id = r.id AND p.statut = 'paye'
    WHERE ${ownerWhere}
    GROUP BY t.id, t.nom, t.modele_revenus, t.commission_pourcentage, t.abonnement_montant, t.achat_definitif_montant, t.achat_definitif_paye`;
}

function summarizeOwnerRevenue(rows) {
  return {
    reservations: rows.reduce((sum, row) => sum + Number(row.reservations || 0), 0),
    avances_encaissees: rows.reduce((sum, row) => sum + Number(row.avances_encaissees || 0), 0),
    commissions_prelevees: rows.reduce((sum, row) => sum + Number(row.commissions_prelevees || 0), 0),
    montants_reverses: rows.reduce((sum, row) => sum + Number(row.montants_reverses || 0), 0),
  };
}

module.exports = {
  PLAYED_STATUSES,
  periodStart,
  playedStatusSql,
  ownerRevenueRowsSql,
  summarizeOwnerRevenue,
};
