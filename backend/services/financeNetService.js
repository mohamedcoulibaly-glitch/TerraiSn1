/**
 * Ventilation financière — formules concordantes (période).
 *
 * total_avances          = Σ avances ledger `dus` (payé en ligne)
 * soldes_encaissees      = Σ (prix − avance) des matchs joués (reste encaissé)
 * total_commission       = Σ commission dus
 * frais_payout_gerant    = Σ frais dus
 *
 * montant_touche (« Chiffre d'affaires »)
 *   = total_avances + soldes_encaissees − total_commission − frais
 *
 * solde_a_retirer
 *   = montant_touche − total_avances
 *
 * matchs_joues = nombre de résas match_joue / joue (pas un montant)
 *
 * @param {string} sinceYmd inclusive
 * @param {string|null} [untilYmd] inclusive — aujourd'hui = since===until
 */
const { queryOne } = require('../database');

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

  const jouesRow = queryOne(
    db,
    `SELECT
       COALESCE(SUM(COALESCE(r.prix_total, r.montant, 0)), 0) AS valeur_totale_matchs,
       COALESCE(SUM(
         max(0,
           COALESCE(r.prix_total, r.montant, 0)
           - COALESCE(r.montant_avance, r.acompte, 0)
         )
       ), 0) AS soldes_encaissees,
       COUNT(*) AS matchs_joues
     FROM reservations r
     WHERE r.terrain_id IN (${placeholders})
       ${dateFilterResa}
       AND LOWER(COALESCE(r.statut, '')) IN ('match_joue', 'joue')`,
    [...ids, ...dateParams],
  );

  const totalAvances = Number(row?.total_avances || 0);
  const totalCommission = Number(row?.total_commission || 0);
  const frais = Number(row?.frais_payout_gerant || 0);
  const montantNetLedger = Number(row?.montant_net || 0);
  const montantNet = Math.max(0, montantNetLedger || (totalAvances - totalCommission - frais));
  const soldesEncaissees = Number(jouesRow?.soldes_encaissees || 0);

  const montantTouche = Math.max(0, totalAvances + soldesEncaissees - totalCommission - frais);
  const soldeARetirer = Math.max(0, montantTouche - totalAvances);

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

module.exports = {
  agregatsNetTerrains,
  deltaPctVsPrecedent,
};
