const { queryAll, queryOne } = require('../database');
const { encaissementsPeriode } = require('./blocagePeriodeService');

const FINANCE_STATUSES = ['confirme', 'acceptee', 'match_joue', 'joue'];
const FINANCE_PLAYED = ['match_joue', 'joue'];
const OCCUPY_STATUSES = ['confirme', 'acceptee', 'match_joue', 'joue', 'en_attente'];
const JOUR_COURT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS_COURT = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

function localDateYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymd, n) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return localDateYmd(new Date(y, m - 1, d + n));
}

function hourOf(value, fallback = 0) {
  const n = parseInt(String(value || fallback).split(':')[0], 10);
  return Number.isFinite(n) ? n : fallback;
}

function gerantFinancePeriod(raw) {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const today = localDateYmd(now);
  const periode = ['aujourd_hui', 'semaine', 'mois', 'annee'].includes(raw) ? raw : 'aujourd_hui';

  if (periode === 'aujourd_hui') {
    return { periode, from: today, to: today, bucket: 'heure' };
  }
  if (periode === 'semaine') {
    const mondayOffset = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { periode, from: localDateYmd(monday), to: localDateYmd(sunday), bucket: 'jour' };
  }
  if (periode === 'annee') {
    const y = now.getFullYear();
    return { periode, from: `${y}-01-01`, to: `${y}-12-31`, bucket: 'mois' };
  }
  const y = now.getFullYear();
  const month = now.getMonth();
  return {
    periode: 'mois',
    from: `${y}-${String(month + 1).padStart(2, '0')}-01`,
    to: localDateYmd(new Date(y, month + 1, 0)),
    bucket: 'semaine',
  };
}

function previousPeriodRange(range) {
  if (range.periode === 'aujourd_hui') {
    const y = addDaysYmd(range.from, -1);
    return { periode: 'aujourd_hui', from: y, to: y, bucket: 'heure' };
  }
  if (range.periode === 'semaine') {
    return {
      periode: 'semaine',
      from: addDaysYmd(range.from, -7),
      to: addDaysYmd(range.to, -7),
      bucket: 'jour',
    };
  }
  if (range.periode === 'annee') {
    const y = Number(String(range.from).slice(0, 4)) - 1;
    return { periode: 'annee', from: `${y}-01-01`, to: `${y}-12-31`, bucket: 'mois' };
  }
  const [yy, mm] = String(range.from).split('-').map(Number);
  const prev = new Date(yy, mm - 2, 1);
  return {
    periode: 'mois',
    from: localDateYmd(prev),
    to: localDateYmd(new Date(prev.getFullYear(), prev.getMonth() + 1, 0)),
    bucket: 'semaine',
  };
}

function variationLabel(periode) {
  if (periode === 'aujourd_hui') return 'vs hier';
  if (periode === 'semaine') return 'Cette semaine vs semaine dernière';
  if (periode === 'annee') return 'Cette année vs l’an dernier';
  return 'Ce mois vs mois dernier';
}

function deltaPct(current, previous) {
  const cur = Number(current || 0);
  const prev = Number(previous || 0);
  if (prev === 0 && cur === 0) return null;
  if (prev === 0) return 100;
  return Math.round(((cur - prev) / prev) * 100);
}

function emptyFinanceBuckets({ from, to, bucket }) {
  if (bucket === 'heure') {
    return Array.from({ length: 18 }, (_, i) => {
      const h = String(i + 6).padStart(2, '0');
      return { key: h, label: `${Number(h)}h`, montant: 0, matchs: 0, byTerrain: {} };
    });
  }
  if (bucket === 'mois') {
    const year = String(from).slice(0, 4);
    return MOIS_COURT.map((label, i) => ({
      key: `${year}-${String(i + 1).padStart(2, '0')}`,
      label,
      montant: 0,
      matchs: 0,
      byTerrain: {},
    }));
  }
  if (bucket === 'semaine') {
    const ym = String(from).slice(0, 7);
    return [1, 2, 3, 4].map((n) => ({
      key: `${ym}-S${n}`,
      label: `S${n}`,
      montant: 0,
      matchs: 0,
      byTerrain: {},
    }));
  }
  const out = [];
  for (let cur = from; cur <= to; cur = addDaysYmd(cur, 1)) {
    const [y, m, d] = cur.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    out.push({
      key: cur,
      label: `${JOUR_COURT[dt.getDay()]} ${d}`,
      montant: 0,
      matchs: 0,
      byTerrain: {},
    });
  }
  return out;
}

function financeBucketKey(bucket, date, heure) {
  if (bucket === 'heure') {
    const n = parseInt(String(heure || '0'), 10);
    return String(Number.isFinite(n) ? n : 0).padStart(2, '0');
  }
  if (bucket === 'mois') return String(date).slice(0, 7);
  if (bucket === 'semaine') {
    const ym = String(date).slice(0, 7);
    const day = parseInt(String(date).slice(8, 10), 10);
    const week = !Number.isFinite(day) || day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4;
    return `${ym}-S${week}`;
  }
  return String(date).slice(0, 10);
}

function normalizeIds(terrainIds) {
  return [...new Set((terrainIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
}

function addToBucket(buckets, bucketIndex, key, amount, terrainId, isMatch) {
  const idx = bucketIndex.get(key);
  if (idx == null) return;
  const bucket = buckets[idx];
  const value = Number(amount || 0);
  bucket.montant += value;
  if (isMatch) bucket.matchs += 1;
  if (terrainId) {
    const tid = String(terrainId);
    bucket.byTerrain[tid] = Number(bucket.byTerrain[tid] || 0) + value;
  }
}

function emptyFinanceResult(range, extras = {}) {
  return {
    periode: range.periode,
    from: range.from,
    to: range.to,
    encaisse_reservations: 0,
    encaisse_abonnements: 0,
    encaisse_tournois: 0,
    encaisse_blocages: 0,
    total_encaisse: 0,
    avances_recues: 0,
    matchs_joues: 0,
    a_venir: 0,
    mention_blocages: 'Les montants d’abonnement / tournoi ne sont pas pris en compte pour le moment',
    historique: [],
    graphique: emptyFinanceBuckets(range).map(({ label, montant, matchs }) => ({
      label,
      montant,
      matchs,
    })),
    series: [],
    variation: null,
    ...extras,
  };
}

async function computeFinancesInRange(db, ids, range) {
  if (ids.length === 0) return emptyFinanceResult(range);

  const placeholders = ids.map(() => '?').join(',');
  const statusList = FINANCE_STATUSES.map((s) => `'${s}'`).join(', ');
  const terrains = await queryAll(
    db,
    `SELECT id, nom FROM terrains WHERE id IN (${placeholders})`,
    ids,
  );
  const series = terrains.map((t) => ({
    id: Number(t.id),
    key: `t_${t.id}`,
    nom: t.nom,
  }));

  const rows = await queryAll(db, `
    SELECT r.id, r.date, r.heure_debut, r.statut, r.terrain_id, t.nom AS terrain_nom,
           COALESCE(r.montant_avance, r.acompte, 0) AS montant_avance,
           COALESCE(r.joueur_telephone, u.telephone) AS joueur_telephone,
           TRIM(CASE
             WHEN TRIM(COALESCE(u.prenom, '') || ' ' || COALESCE(u.nom, '')) <> ''
               THEN TRIM(COALESCE(u.prenom, '') || ' ' || COALESCE(u.nom, ''))
             WHEN TRIM(COALESCE(r.joueur_nom, '')) <> '' THEN r.joueur_nom
             ELSE 'Joueur'
           END) AS joueur_nom
    FROM reservations r
    JOIN terrains t ON t.id = r.terrain_id
    LEFT JOIN users u ON u.id = r.joueur_id
    WHERE r.terrain_id IN (${placeholders})
      AND r.date >= ? AND r.date <= ?
      AND r.statut IN (${statusList})
    ORDER BY r.date DESC, r.heure_debut DESC, r.id DESC
  `, [...ids, range.from, range.to]);

  const payments = await queryAll(db, `
    SELECT p.reservation_id, COALESCE(SUM(p.montant), 0) AS montant
    FROM paiements p
    JOIN reservations r ON r.id = p.reservation_id
    WHERE r.terrain_id IN (${placeholders})
      AND r.date >= ? AND r.date <= ?
      AND r.statut IN (${statusList})
      AND p.statut = 'paye'
    GROUP BY p.reservation_id
  `, [...ids, range.from, range.to]);

  const paidByResa = new Map(
    payments.map((p) => [Number(p.reservation_id), Number(p.montant || 0)]),
  );
  const buckets = emptyFinanceBuckets(range);
  const bucketIndex = new Map(buckets.map((b, i) => [b.key, i]));

  let totalEncaisse = 0;
  let avancesRecues = 0;
  let matchsJoues = 0;
  let aVenir = 0;

  for (const row of rows) {
    const avance = Number(row.montant_avance || 0);
    const encaisse = paidByResa.has(Number(row.id)) ? paidByResa.get(Number(row.id)) : avance;
    avancesRecues += avance;
    totalEncaisse += encaisse;
    if (FINANCE_PLAYED.includes(row.statut)) matchsJoues += 1;
    else aVenir += 1;

    const key = financeBucketKey(range.bucket, row.date, row.heure_debut);
    addToBucket(buckets, bucketIndex, key, encaisse, row.terrain_id, true);
  }

  let encaisse_abonnements = 0;
  let encaisse_tournois = 0;
  const historiqueBlocages = [];
  for (const terrainId of ids) {
    const enc = await encaissementsPeriode(db, terrainId, range.from, range.to);
    encaisse_abonnements += Number(enc.encaisse_abonnements || 0);
    encaisse_tournois += Number(enc.encaisse_tournois || 0);
    for (const ligne of enc.historique) {
      historiqueBlocages.push({
        ...ligne,
        terrain_id: Number(terrainId),
        terrain_nom: series.find((s) => s.id === Number(terrainId))?.nom || null,
        joueur_telephone: '',
        statut: ligne.source,
      });
      const key = financeBucketKey(range.bucket, ligne.date, ligne.heure_debut || '12:00');
      addToBucket(buckets, bucketIndex, key, ligne.montant_avance, terrainId, false);
    }
  }

  const encaisse_blocages = encaisse_abonnements + encaisse_tournois;
  const mention =
    encaisse_blocages > 0
      ? `Abonnements et tournois encaissés : ${encaisse_blocages.toLocaleString('fr-FR')} FCFA`
      : 'Les montants d’abonnement / tournoi ne sont pas pris en compte pour le moment';

  const historiqueResas = rows.map((row) => ({
    id: Number(row.id),
    date: row.date,
    heure_debut: String(row.heure_debut || '').slice(0, 5),
    joueur_nom: row.joueur_nom || 'Joueur',
    joueur_telephone: row.joueur_telephone || '',
    statut: row.statut,
    terrain_id: Number(row.terrain_id),
    terrain_nom: row.terrain_nom || null,
    montant_avance: Number(row.montant_avance || 0),
    source: 'match',
  }));

  const graphique = buckets.map((bucket) => {
    const point = {
      label: bucket.label,
      montant: bucket.montant,
      matchs: bucket.matchs,
    };
    for (const item of series) {
      point[item.key] = Number(bucket.byTerrain[String(item.id)] || 0);
    }
    return point;
  });

  return {
    periode: range.periode,
    from: range.from,
    to: range.to,
    encaisse_reservations: totalEncaisse,
    encaisse_abonnements,
    encaisse_tournois,
    encaisse_blocages,
    total_encaisse: totalEncaisse + encaisse_blocages,
    avances_recues: avancesRecues,
    matchs_joues: matchsJoues,
    a_venir: aVenir,
    mention_blocages: mention,
    historique: [...historiqueResas, ...historiqueBlocages].sort((a, b) => {
      const byDate = String(b.date || '').localeCompare(String(a.date || ''));
      if (byDate) return byDate;
      return String(b.heure_debut || '').localeCompare(String(a.heure_debut || ''));
    }),
    graphique,
    series,
  };
}

async function computeFinances(db, terrainIds, periodeRaw, options = {}) {
  const ids = normalizeIds(terrainIds);
  const range = gerantFinancePeriod(periodeRaw);
  const current = await computeFinancesInRange(db, ids, range);
  if (options.includeVariation === false) return current;

  const previous = await computeFinancesInRange(db, ids, previousPeriodRange(range));
  const pct = deltaPct(current.total_encaisse, previous.total_encaisse);
  current.variation = {
    label: variationLabel(range.periode),
    total_encaisse_precedent: Number(previous.total_encaisse || 0),
    delta_pct: pct,
    matchs_joues: Number(previous.matchs_joues || 0),
  };
  return current;
}

function slotOccupied(items, terrainId, date, slot) {
  return items.some((row) => {
    if (Number(row.terrain_id) !== Number(terrainId)) return false;
    if (String(row.date).slice(0, 10) !== date) return false;
    const debut = String(row.heure_debut || '00:00').slice(0, 5);
    const fin = String(row.heure_fin || '00:00').slice(0, 5);
    return slot >= debut && slot < fin;
  });
}

async function computeOccupancy(db, terrainIds, from, to) {
  const ids = normalizeIds(terrainIds);
  const empty = { rate: 0, booked: 0, total: 0, byTerrain: {} };
  if (!ids.length || !from || !to) return empty;

  const placeholders = ids.map(() => '?').join(',');
  const horaires = await queryAll(
    db,
    `SELECT terrain_id, jour, heure_debut, heure_fin, est_ouvert
     FROM horaires WHERE terrain_id IN (${placeholders})`,
    ids,
  );
  const horaireMap = new Map();
  for (const row of horaires) {
    horaireMap.set(`${Number(row.terrain_id)}:${String(row.jour || '').toLowerCase()}`, row);
  }

  const occupyList = OCCUPY_STATUSES.map((s) => `'${s}'`).join(', ');
  const reservations = await queryAll(db, `
    SELECT terrain_id, date, heure_debut, heure_fin
    FROM reservations
    WHERE terrain_id IN (${placeholders})
      AND date >= ? AND date <= ?
      AND statut IN (${occupyList})
  `, [...ids, from, to]);
  const blocages = await queryAll(db, `
    SELECT terrain_id, date, heure_debut, heure_fin
    FROM blocages_creneaux
    WHERE terrain_id IN (${placeholders})
      AND date >= ? AND date <= ?
  `, [...ids, from, to]);

  const byTerrain = Object.fromEntries(ids.map((id) => [id, { booked: 0, total: 0 }]));
  let booked = 0;
  let total = 0;

  for (let cur = from; cur <= to; cur = addDaysYmd(cur, 1)) {
    const [y, m, d] = cur.split('-').map(Number);
    const jour = JOURS[new Date(y, m - 1, d).getDay()];
    for (const id of ids) {
      const horaire = horaireMap.get(`${id}:${jour}`);
      const ouvert = horaire ? Number(horaire.est_ouvert) !== 0 : true;
      if (!ouvert) continue;
      const start = horaire ? hourOf(horaire.heure_debut, 8) : 8;
      const end = horaire ? hourOf(horaire.heure_fin, 23) : 23;
      if (end <= start) continue;
      const bucket = byTerrain[id];
      for (let h = start; h < end; h += 1) {
        const slot = `${String(h).padStart(2, '0')}:00`;
        bucket.total += 1;
        total += 1;
        if (slotOccupied(reservations, id, cur, slot) || slotOccupied(blocages, id, cur, slot)) {
          bucket.booked += 1;
          booked += 1;
        }
      }
    }
  }

  const rateOf = (b, t) => (t > 0 ? Math.min(100, Math.round((b / t) * 100)) : 0);
  Object.values(byTerrain).forEach((row) => {
    row.rate = rateOf(row.booked, row.total);
  });

  return { rate: rateOf(booked, total), booked, total, byTerrain };
}

async function computeOwnerDashboard(db, proprietaireId) {
  const terrains = await queryAll(db, 'SELECT id, nom, is_active FROM terrains WHERE proprietaire_id = ?', [proprietaireId]);
  const ids = terrains.map((t) => Number(t.id));
  if (!ids.length) {
    return {
      totalRevenue: 0,
      totalAvances: 0,
      occupancyRate: 0,
      totalReservations: 0,
      pendingReservations: 0,
      matchsJoues: 0,
      totalTerrains: 0,
      totalEmployes: 0,
      terrainStats: [],
      variation: null,
      from: gerantFinancePeriod('mois').from,
      to: gerantFinancePeriod('mois').to,
    };
  }

  const finances = await computeFinances(db, ids, 'mois');
  const occupancy = await computeOccupancy(db, ids, finances.from, finances.to);
  const placeholders = ids.map(() => '?').join(',');
  const pending = await queryOne(
    db,
    `SELECT COUNT(*) AS count FROM reservations
     WHERE terrain_id IN (${placeholders}) AND statut = 'en_attente'`,
    ids,
  );
  const employees = await queryOne(db, 'SELECT COUNT(*) AS count FROM employes WHERE proprietaire_id = ?', [proprietaireId]);

  const byTerrainFinances = new Map();
  for (const id of ids) {
    byTerrainFinances.set(id, await computeFinances(db, [id], 'mois'));
  }

  const terrainStats = terrains.map((t) => {
    const id = Number(t.id);
    const fin = byTerrainFinances.get(id);
    const occ = occupancy.byTerrain[id] || { rate: 0 };
    return {
      id,
      nom: t.nom,
      reservations: Number(fin?.matchs_joues || 0) + Number(fin?.a_venir || 0),
      revenue: Number(fin?.total_encaisse || 0),
      occupancy: Number(occ.rate || 0),
      matchsJoues: Number(fin?.matchs_joues || 0),
      variation: fin?.variation || null,
    };
  });

  return {
    totalRevenue: Number(finances.total_encaisse || 0),
    totalAvances: Number(finances.avances_recues || 0),
    occupancyRate: occupancy.rate,
    totalReservations: Number(finances.matchs_joues || 0) + Number(finances.a_venir || 0),
    pendingReservations: Number(pending?.count || 0),
    matchsJoues: Number(finances.matchs_joues || 0),
    totalTerrains: terrains.length,
    totalEmployes: Number(employees?.count || 0),
    terrainStats,
    variation: finances.variation || null,
    from: finances.from,
    to: finances.to,
  };
}

module.exports = {
  computeFinances,
  computeOccupancy,
  computeOwnerDashboard,
  gerantFinancePeriod,
};
