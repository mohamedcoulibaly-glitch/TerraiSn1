/**
 * Ventilation financière — formules concordantes (période).
 *
 * total_avances          = Σ avances ledger `dus` (payé en ligne)
 *                          + Σ paiements avance cash (MANUEL-GERANT-*)
 * soldes_encaissees      = Σ paiements `SOLDE-*` réellement encaissés
 *                          (jamais prix−avance aveugle sur match_joue)
 * total_commission       = Σ commission dus (plateforme)
 * frais_payout_gerant    = Σ frais dus
 *
 * montant_touche (« Chiffre d'affaires »)
 *   = total_avances + soldes_encaissees − total_commission − frais
 *
 * solde_a_retirer (indicatif KPI « reste cash »)
 *   = soldes_encaissees
 *   NB : le montant Wave réellement retirable = portefeuilleTerrain.solde_disponible
 *
 * matchs_joues = nombre de résas match_joue / joue (pas un montant)
 *
 * @param {string} sinceYmd inclusive
 * @param {string|null} [untilYmd] inclusive — aujourd'hui = since===until
 */
const { queryOne, queryAll } = require('../database');

function agregatsNetTerrains(db, terrainIds, sinceYmd, untilYmd = null) {
  const ids = (Array.isArray(terrainIds) ? terrainIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) {
    return {
      total_avances: 0,
      total_commission: 0,
      frais_payout_gerant: 0,
      montant_net: 0,
      net_recu: 0,
      soldes_encaissees: 0,
      montant_touche: 0,
      solde_a_retirer: 0,
      valeur_totale_matchs: 0,
      matchs_joues: 0,
    };
  }

  const placeholders = ids.map(() => '?').join(',');
  const until = untilYmd || null;
  const dateFilterDu = until
    ? 'AND (r.date IS NULL OR (r.date >= ? AND r.date <= ?))'
    : 'AND (r.date IS NULL OR r.date >= ?)';
  const dateFilterResa = until
    ? 'AND r.date >= ? AND r.date <= ?'
    : 'AND r.date >= ?';
  const dateParams = until ? [sinceYmd, until] : [sinceYmd];

  const row = queryOne(
    db,
    `SELECT
       COALESCE(SUM(CASE WHEN d.statut != 'annule_rembourse' THEN d.avance ELSE 0 END), 0) AS total_avances,
       COALESCE(SUM(CASE WHEN d.statut != 'annule_rembourse' THEN d.commission ELSE 0 END), 0) AS total_commission,
       COALESCE(SUM(CASE WHEN d.statut != 'annule_rembourse' THEN d.frais_gerant ELSE 0 END), 0) AS frais_payout_gerant,
       COALESCE(SUM(CASE WHEN d.statut != 'annule_rembourse' THEN d.du_gerant ELSE 0 END), 0) AS montant_net,
       COALESCE(SUM(CASE WHEN d.statut = 'verse' THEN d.du_gerant ELSE 0 END), 0) AS net_recu
     FROM dus d
     LEFT JOIN reservations r ON r.id = d.reservation_id
     WHERE d.terrain_id IN (${placeholders})
       ${dateFilterDu}`,
    [...ids, ...dateParams],
  );

  // Avances cash guichet (hors dus) — commission suivie via dettes_commissions, pas ici.
  const cashAvancesRow = queryOne(
    db,
    `SELECT COALESCE(SUM(p.montant), 0) AS total
     FROM paiements p
     JOIN reservations r ON r.id = p.reservation_id
     WHERE r.terrain_id IN (${placeholders})
       ${dateFilterResa}
       AND LOWER(COALESCE(p.statut, '')) = 'paye'
       AND (
         COALESCE(p.reference_externe, '') LIKE 'MANUEL-GERANT-%'
         OR LOWER(COALESCE(p.methode, '')) = 'manuel'
       )`,
    [...ids, ...dateParams],
  );

  // Soldes réellement encaissés (événement SOLDE-*), jamais prix−avance sur match non soldé.
  const soldesRow = queryOne(
    db,
    `SELECT COALESCE(SUM(p.montant), 0) AS soldes_encaissees
     FROM paiements p
     JOIN reservations r ON r.id = p.reservation_id
     WHERE r.terrain_id IN (${placeholders})
       ${dateFilterResa}
       AND LOWER(COALESCE(p.statut, '')) = 'paye'
       AND COALESCE(p.reference_externe, '') LIKE 'SOLDE-%'`,
    [...ids, ...dateParams],
  );

  const jouesRow = queryOne(
    db,
    `SELECT
       COALESCE(SUM(COALESCE(r.prix_total, r.montant, 0)), 0) AS valeur_totale_matchs,
       COUNT(*) AS matchs_joues
     FROM reservations r
     WHERE r.terrain_id IN (${placeholders})
       ${dateFilterResa}
       AND LOWER(COALESCE(r.statut, '')) IN ('match_joue', 'joue')`,
    [...ids, ...dateParams],
  );

  const avancesOnline = Number(row?.total_avances || 0);
  const avancesCash = Number(cashAvancesRow?.total || 0);
  const totalAvances = avancesOnline + avancesCash;
  const totalCommission = Number(row?.total_commission || 0);
  const frais = Number(row?.frais_payout_gerant || 0);
  const montantNetLedger = Number(row?.montant_net || 0);
  const montantNet = Math.max(0, montantNetLedger || (avancesOnline - totalCommission - frais));
  const soldesEncaissees = Number(soldesRow?.soldes_encaissees || 0);

  const montantTouche = Math.max(0, totalAvances + soldesEncaissees - totalCommission - frais);
  // KPI « reste encaissé sur place » (hors payout Wave) — distinct de solde_disponible dus.
  const soldeARetirer = soldesEncaissees;

  return {
    total_avances: totalAvances,
    total_commission: totalCommission,
    frais_payout_gerant: frais,
    montant_net: montantNet,
    net_recu: Number(row?.net_recu || 0),
    soldes_encaissees: soldesEncaissees,
    montant_touche: montantTouche,
    solde_a_retirer: soldeARetirer,
    valeur_totale_matchs: Number(jouesRow?.valeur_totale_matchs || 0),
    matchs_joues: Number(jouesRow?.matchs_joues || 0),
  };
}

/**
 * @param {'avance'|'net'|'touche'} metric
 */
function deltaPctVsPrecedent(db, terrainIds, fromYmd, toYmd, currentTotal, metric = 'avance') {
  const ids = (Array.isArray(terrainIds) ? terrainIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length || !fromYmd || !toYmd) return null;

  const from = new Date(`${fromYmd}T12:00:00`);
  const to = new Date(`${toYmd}T12:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  const spanMs = Math.max(24 * 60 * 60 * 1000, to.getTime() - from.getTime() + 24 * 60 * 60 * 1000);
  const prevTo = new Date(from.getTime() - 24 * 60 * 60 * 1000);
  const prevFrom = new Date(prevTo.getTime() - spanMs + 24 * 60 * 60 * 1000);
  const prevFromYmd = prevFrom.toISOString().slice(0, 10);
  const prevToYmd = prevTo.toISOString().slice(0, 10);

  let prevTotal = 0;
  if (metric === 'touche') {
    const prev = agregatsNetTerrains(db, ids, prevFromYmd, prevToYmd);
    prevTotal = Number(prev.montant_touche || 0);
  } else {
    const col = metric === 'net' ? 'du_gerant' : 'avance';
    const placeholders = ids.map(() => '?').join(',');
    const prev = queryOne(
      db,
      `SELECT COALESCE(SUM(CASE WHEN d.statut != 'annule_rembourse' THEN d.${col} ELSE 0 END), 0) AS total
       FROM dus d
       LEFT JOIN reservations r ON r.id = d.reservation_id
       WHERE d.terrain_id IN (${placeholders})
         AND r.date >= ? AND r.date <= ?`,
      [...ids, prevFromYmd, prevToYmd],
    );
    prevTotal = Number(prev?.total || 0);
  }

  const cur = Number(currentTotal || 0);
  if (prevTotal <= 0) {
    return cur > 0 ? 100 : null;
  }
  return Math.round(((cur - prevTotal) / prevTotal) * 100);
}

/**
 * Encaissements abonnements / tournois (table encaissements_blocages).
 * @returns {{ encaisse_abonnements: number, encaisse_tournois: number, encaisse_blocages: number }}
 */
function agregatsEncaissementsBlocages(db, terrainIds, sinceYmd, untilYmd = null) {
  const ids = (Array.isArray(terrainIds) ? terrainIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length || !sinceYmd) {
    return { encaisse_abonnements: 0, encaisse_tournois: 0, encaisse_blocages: 0 };
  }
  const placeholders = ids.map(() => '?').join(',');
  const until = untilYmd || null;
  const dateFilter = until
    ? 'AND e.date_encaissement >= ? AND e.date_encaissement <= ?'
    : 'AND e.date_encaissement >= ?';
  const dateParams = until ? [sinceYmd, until] : [sinceYmd];
  const rows = queryAll(
    db,
    `SELECT UPPER(COALESCE(g.type_blocage, '')) AS type_blocage,
            COALESCE(SUM(e.montant), 0) AS total
     FROM encaissements_blocages e
     JOIN blocages_groupes g ON g.id = e.groupe_id
     WHERE e.terrain_id IN (${placeholders})
       ${dateFilter}
     GROUP BY UPPER(COALESCE(g.type_blocage, ''))`,
    [...ids, ...dateParams],
  );
  let abo = 0;
  let tournoi = 0;
  for (const row of rows || []) {
    const type = String(row.type_blocage || '');
    const total = Number(row.total || 0);
    if (type === 'ABONNEMENT') abo += total;
    else if (type === 'TOURNOI') tournoi += total;
  }
  return {
    encaisse_abonnements: abo,
    encaisse_tournois: tournoi,
    encaisse_blocages: abo + tournoi,
  };
}

module.exports = {
  agregatsNetTerrains,
  deltaPctVsPrecedent,
  agregatsEncaissementsBlocages,
};
