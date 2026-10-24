const {
  buildSlotsForOpenDay,
  addDaysYmd: scheduleAddDays,
  jourDepuisDate,
} = require('./scheduleService');

const PLAYED_STATUSES = ['match_joue', 'joue'];
/** Avances déjà payées : visibles proprio dès confirmation, pas seulement après le match. */
const REVENUE_STATUSES = ['confirme', 'acceptee', 'match_joue', 'joue'];
const ACTIVE_STATUSES = ['confirme', 'acceptee', 'match_joue', 'joue', 'en_attente'];

const PERIOD_LABELS = {
  aujourd_hui: "Aujourd'hui",
  semaine: 'Cette semaine',
  mois: 'Ce mois',
  annee: 'Cette année',
};

const VARIATION_LABELS = {
  aujourd_hui: 'vs hier',
  semaine: 'vs semaine dernière',
  mois: 'vs mois précédent',
  annee: 'vs année précédente',
};

function periodDays(period) {
  if (period === 'semaine') return 7;
  if (period === 'annee') return 365;
  return 31;
}

/** Fenêtre glissante (compat /revenus legacy). */
function periodStart(period) {
  const start = new Date();
  start.setDate(start.getDate() - periodDays(period) + 1);
  return start.toISOString().slice(0, 10);
}

function localDateYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(ymd) {
  const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function addDaysYmd(ymd, days) {
  return scheduleAddDays(String(ymd).slice(0, 10), days);
}

function daysInclusive(from, to) {
  const a = parseYmd(from);
  const b = parseYmd(to);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function normalizeOwnerPeriode(raw) {
  const p = String(raw || 'mois').toLowerCase();
  if (p === 'jour' || p === 'day' || p === 'aujourd_hui') return 'aujourd_hui';
  if (p === 'week' || p === 'semaine') return 'semaine';
  if (p === 'year' || p === 'annee' || p === 'année') return 'annee';
  if (p === 'month' || p === 'mois') return 'mois';
  return 'mois';
}

/**
 * Bornes calendaires + période précédente de même durée.
 * - aujourd_hui : jour civil
 * - semaine : lundi → aujourd'hui (ISO)
 * - mois : 1er du mois → aujourd'hui
 * - annee : 1er janvier → aujourd'hui
 */
function resolveOwnerPeriodBounds(periodeRaw = 'mois') {
  const periode = normalizeOwnerPeriode(periodeRaw);
  const today = localDateYmd();
  const now = parseYmd(today);
  let from = today;
  let to = today;

  let prevFrom;
  let prevTo;

  if (periode === 'aujourd_hui') {
    from = today;
    to = today;
    prevFrom = addDaysYmd(today, -1);
    prevTo = prevFrom;
  } else if (periode === 'semaine') {
    const dow = now.getDay(); // 0 = dimanche
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    from = addDaysYmd(today, mondayOffset);
    to = today;
    const span = daysInclusive(from, to);
    prevTo = addDaysYmd(from, -1);
    prevFrom = addDaysYmd(prevTo, -(span - 1));
  } else if (periode === 'mois') {
    from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    to = today;
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevFrom = localDateYmd(prevMonthDate);
    const dayOfMonth = now.getDate();
    const lastDayPrev = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const prevDay = Math.min(dayOfMonth, lastDayPrev);
    prevTo = localDateYmd(new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), prevDay));
  } else {
    from = `${now.getFullYear()}-01-01`;
    to = today;
    prevFrom = `${now.getFullYear() - 1}-01-01`;
    const prevYearSame = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    prevTo = localDateYmd(prevYearSame);
  }

  return {
    periode,
    from,
    to,
    prevFrom,
    prevTo,
    label: PERIOD_LABELS[periode],
    variationLabel: VARIATION_LABELS[periode],
  };
}

function playedStatusSql(alias = 'r') {
  return `${alias}.statut IN ('${PLAYED_STATUSES.join("','")}')`;
}

function revenueStatusSql(alias = 'r') {
  return `${alias}.statut IN ('${REVENUE_STATUSES.join("','")}')`;
}

function isRevenueStatus(statut) {
  return REVENUE_STATUSES.includes(String(statut || ''));
}

function isPlayedStatus(statut) {
  return PLAYED_STATUSES.includes(String(statut || ''));
}

function avanceOf(row) {
  return Number(row.montant_avance ?? row.acompte ?? 0) || 0;
}

function deltaPct(current, previous) {
  const cur = Number(current || 0);
  const prev = Number(previous || 0);
  if (prev === 0) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 100);
}

function buildVariation(current, previous, label) {
  return {
    label: label || 'vs période précédente',
    total_encaisse_precedent: Number(previous || 0),
    delta_pct: deltaPct(current, previous),
  };
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

function parseHourValue(time) {
  const raw = String(time || '0').trim();
  if (raw === '24:00' || raw === '24') return 24;
  const h = parseInt(raw.split(':')[0], 10);
  return Number.isFinite(h) ? h : 0;
}

/** Durée en heures d'une réservation (min 1). */
function reservationHours(row) {
  const start = parseHourValue(row.heure_debut);
  let end = parseHourValue(row.heure_fin);
  if (end === 0 && String(row.heure_fin || '').startsWith('00')) end = 24;
  if (end > start) return Math.max(1, end - start);
  if (end < start) return Math.max(1, 24 - start + end);
  return 1;
}

function eachDateYmd(from, to) {
  const out = [];
  let cur = String(from).slice(0, 10);
  const end = String(to).slice(0, 10);
  let guard = 0;
  while (cur <= end && guard < 400) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
    guard += 1;
  }
  return out;
}

/**
 * Occupation réelle = heures réservées confirmées / créneaux ouverts (horaires).
 * Fallback : 12 h/jour si aucun horaire configuré.
 */
function computeOccupancyRate(db, queryAll, { terrainIds, from, to, reservations }) {
  const ids = (terrainIds || []).map(Number).filter(Boolean);
  if (!ids.length) return 0;

  const placeholders = ids.map(() => '?').join(',');
  const horaires = queryAll(
    db,
    `SELECT terrain_id, jour, heure_debut, heure_fin, est_ouvert
     FROM horaires WHERE terrain_id IN (${placeholders})`,
    ids,
  );
  const byTerrain = new Map();
  for (const h of horaires) {
    const tid = Number(h.terrain_id);
    if (!byTerrain.has(tid)) byTerrain.set(tid, []);
    byTerrain.get(tid).push(h);
  }

  let available = 0;
  for (const tid of ids) {
    const rows = byTerrain.get(tid) || [];
    for (const date of eachDateYmd(from, to)) {
      const jour = jourDepuisDate(date);
      const horaire = rows.find((r) => String(r.jour || '').toLowerCase() === jour && Number(r.est_ouvert) !== 0);
      if (horaire) {
        available += buildSlotsForOpenDay(date, horaire).length;
      } else if (!rows.length) {
        available += 12;
      }
    }
  }

  if (available <= 0) return 0;

  const booked = (reservations || [])
    .filter((r) => isRevenueStatus(r.statut))
    .reduce((sum, r) => sum + reservationHours(r), 0);

  return Math.min(100, Math.round((booked / available) * 100));
}

function hourBucketLabel(heure) {
  const h = parseHourValue(heure);
  const hh = String(h === 24 ? 0 : h).padStart(2, '0');
  return `${hh}h`;
}

function monthBucketLabel(ymd) {
  const d = parseYmd(ymd);
  return d.toLocaleDateString('fr-FR', { month: 'short' });
}

function dayBucketLabel(ymd) {
  const d = parseYmd(ymd);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
}

/**
 * Agrège des points { date, heure_debut?, montant, matchs, terrain_id? }
 * selon la granularité de la période. Remplit les buckets vides.
 */
function buildPeriodGraphique(periode, from, to, rows, { stackByTerrain = false, terrains = [] } = {}) {
  const buckets = new Map();
  const ensure = (key, label) => {
    if (!buckets.has(key)) {
      const base = { key, label, montant: 0, matchs: 0 };
      if (stackByTerrain) {
        for (const t of terrains) base[String(t.id)] = 0;
      }
      buckets.set(key, base);
    }
    return buckets.get(key);
  };

  if (periode === 'aujourd_hui') {
    for (let h = 0; h < 24; h += 1) {
      const key = String(h).padStart(2, '0');
      ensure(key, `${key}h`);
    }
  } else if (periode === 'annee') {
    const start = parseYmd(from);
    const end = parseYmd(to);
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      ensure(key, monthBucketLabel(`${key}-01`));
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    for (const date of eachDateYmd(from, to)) {
      ensure(date, dayBucketLabel(date));
    }
  }

  for (const r of rows || []) {
    if (!isRevenueStatus(r.statut) && r.montant == null) continue;
    const date = String(r.date || '').slice(0, 10);
    if (!date) continue;
    let key;
    if (periode === 'aujourd_hui') {
      key = String(parseHourValue(r.heure_debut)).padStart(2, '0');
      if (key === '24') key = '00';
    } else if (periode === 'annee') {
      key = date.slice(0, 7);
    } else {
      key = date;
    }
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const montant = Number(r.montant != null ? r.montant : avanceOf(r)) || 0;
    bucket.montant += montant;
    bucket.matchs += Number(r.matchs != null ? r.matchs : 1) || 0;
    if (stackByTerrain && r.terrain_id != null) {
      const tid = String(r.terrain_id);
      bucket[tid] = Number(bucket[tid] || 0) + montant;
    }
  }

  return [...buckets.values()].map(({ key, ...rest }) => rest);
}

const HEATMAP_JOURS = [
  { key: 1, label: 'Lun' },
  { key: 2, label: 'Mar' },
  { key: 3, label: 'Mer' },
  { key: 4, label: 'Jeu' },
  { key: 5, label: 'Ven' },
  { key: 6, label: 'Sam' },
  { key: 0, label: 'Dim' },
];

/**
 * Heatmap créneaux : jour × heure (montants / matchs / intensité 0–1).
 * Heures affichées = plage couvrant l'activité, sinon 16h–23h (pic foot).
 */
function buildHeatmap(reservations = []) {
  const revenueRows = (reservations || []).filter((r) => isRevenueStatus(r.statut) || Number(r.montant) > 0);
  const byCell = new Map();
  let maxMontant = 0;
  let minH = 23;
  let maxH = 16;

  for (const r of revenueRows) {
    const date = String(r.date || '').slice(0, 10);
    if (!date) continue;
    const dow = parseYmd(date).getDay();
    let h = parseHourValue(r.heure_debut);
    if (h === 24) h = 0;
    const key = `${dow}-${h}`;
    const cur = byCell.get(key) || { jour: dow, heure: h, montant: 0, matchs: 0 };
    cur.montant += Number(r.montant != null ? r.montant : avanceOf(r)) || 0;
    cur.matchs += 1;
    byCell.set(key, cur);
    maxMontant = Math.max(maxMontant, cur.montant);
    minH = Math.min(minH, h);
    maxH = Math.max(maxH, h);
  }

  if (!revenueRows.length) {
    minH = 16;
    maxH = 23;
  } else {
    minH = Math.max(0, Math.min(minH, 16));
    maxH = Math.min(23, Math.max(maxH, 22));
  }

  const heures = [];
  for (let h = minH; h <= maxH; h += 1) {
    heures.push({ key: h, label: `${String(h).padStart(2, '0')}h` });
  }

  const cells = [];
  for (const jour of HEATMAP_JOURS) {
    for (const heure of heures) {
      const cur = byCell.get(`${jour.key}-${heure.key}`) || {
        jour: jour.key,
        heure: heure.key,
        montant: 0,
        matchs: 0,
      };
      const intensite = maxMontant > 0 ? Math.round((cur.montant / maxMontant) * 100) / 100 : 0;
      cells.push({
        jour: jour.key,
        jour_label: jour.label,
        heure: heure.key,
        heure_label: heure.label,
        montant: cur.montant,
        matchs: cur.matchs,
        intensite,
      });
    }
  }

  const top = [...cells]
    .filter((c) => c.montant > 0)
    .sort((a, b) => b.montant - a.montant)
    .slice(0, 3)
    .map((c) => ({
      label: `${c.jour_label} ${c.heure_label}`,
      montant: c.montant,
      matchs: c.matchs,
    }));

  // Créneaux « froids » : heures avec activité globale faible (bas de classement)
  const byHour = new Map();
  for (const c of cells) {
    const cur = byHour.get(c.heure) || { heure: c.heure, label: c.heure_label, montant: 0, matchs: 0 };
    cur.montant += c.montant;
    cur.matchs += c.matchs;
    byHour.set(c.heure, cur);
  }
  const cold = [...byHour.values()]
    .sort((a, b) => a.montant - b.montant || a.heure - b.heure)
    .slice(0, 3)
    .filter((h) => maxMontant === 0 || h.montant < maxMontant * 0.25)
    .map((h) => ({ label: h.label, montant: h.montant, matchs: h.matchs }));

  return {
    jours: HEATMAP_JOURS,
    heures,
    cells,
    top_creneaux: top,
    creneaux_froids: cold,
    max_montant: maxMontant,
    has_data: revenueRows.length > 0,
  };
}

/**
 * Croisement Santé opérationnelle × CA pour messages de pilotage.
 * Attend des lignes { id, nom, revenue, occupancy, score_confiance, taux_scan }.
 */
function buildSanteCaInsight(terrainRows = []) {
  const rows = (terrainRows || []).map((t) => ({
    id: Number(t.id),
    nom: t.nom || `Terrain #${t.id}`,
    revenue: Number(t.revenue || 0),
    occupancy: Number(t.occupancy || 0),
    score: Number(t.score_confiance ?? t.score ?? 100),
    taux_scan: Number(t.taux_scan ?? 100),
  }));

  if (!rows.length) {
    return {
      statut: 'neutre',
      resume: 'Pas encore assez de données pour croiser santé et CA.',
      score_moyen: null,
      ca_total: 0,
      alertes: [],
    };
  }

  const caTotal = rows.reduce((s, r) => s + r.revenue, 0);
  const scoreMoyen = Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length);
  const occMoyenne = Math.round(rows.reduce((s, r) => s + r.occupancy, 0) / rows.length);
  const alertes = [];

  for (const r of rows) {
    if (r.revenue > 0 && r.score < 50) {
      alertes.push({
        type: 'risque',
        terrain_id: r.id,
        terrain_nom: r.nom,
        message: `${r.nom} : CA correct mais score gérant bas (${r.score}/100)`,
      });
    } else if (r.revenue > 0 && r.score < 75 && r.taux_scan < 70) {
      alertes.push({
        type: 'attention',
        terrain_id: r.id,
        terrain_nom: r.nom,
        message: `${r.nom} : scans incomplets (${r.taux_scan}%) malgré de l'activité`,
      });
    }
    if (r.occupancy < 40 && r.score >= 75) {
      alertes.push({
        type: 'opportunite',
        terrain_id: r.id,
        terrain_nom: r.nom,
        message: `${r.nom} : gérant OK, occupation faible (${r.occupancy}%) — pousser les créneaux vides`,
      });
    }
    if (r.occupancy >= 70 && r.score < 50) {
      alertes.push({
        type: 'risque',
        terrain_id: r.id,
        terrain_nom: r.nom,
        message: `${r.nom} : fort remplissage mais conformité fragile — parlons au gérant`,
      });
    }
  }

  let statut = 'optimal';
  let resume = 'Santé et CA sont alignés : tu peux piloter sereinement.';
  if (alertes.some((a) => a.type === 'risque')) {
    statut = 'risque';
    resume = 'Du CA est en jeu : un ou plusieurs terrains ont un score gérant trop bas.';
  } else if (alertes.some((a) => a.type === 'attention')) {
    statut = 'attention';
    resume = 'L’activité est là, mais les scans / validations demandent un suivi.';
  } else if (alertes.some((a) => a.type === 'opportunite') || occMoyenne < 40) {
    statut = 'opportunite';
    resume = 'Les gérants tiennent le coup : l’enjeu est surtout de remplir les créneaux calmes.';
  } else if (scoreMoyen < 75) {
    statut = 'attention';
    resume = 'Score moyen à surveiller — croise avec les encaissements terrain par terrain.';
  }

  return {
    statut,
    resume,
    score_moyen: scoreMoyen,
    occupation_moyenne: occMoyenne,
    ca_total: caTotal,
    alertes: alertes.slice(0, 5),
  };
}

module.exports = {
  PLAYED_STATUSES,
  REVENUE_STATUSES,
  ACTIVE_STATUSES,
  PERIOD_LABELS,
  periodStart,
  localDateYmd,
  addDaysYmd,
  daysInclusive,
  normalizeOwnerPeriode,
  resolveOwnerPeriodBounds,
  playedStatusSql,
  revenueStatusSql,
  isRevenueStatus,
  isPlayedStatus,
  avanceOf,
  deltaPct,
  buildVariation,
  ownerRevenueRowsSql,
  summarizeOwnerRevenue,
  reservationHours,
  computeOccupancyRate,
  buildPeriodGraphique,
  hourBucketLabel,
  buildHeatmap,
  buildSanteCaInsight,
};
