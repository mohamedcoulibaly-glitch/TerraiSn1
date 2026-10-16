/**
 * Créneaux à durée variable — portage Babacar adapté SQLite sync (sql.js).
 * queryOne / queryAll sont synchrones : aucune fonction ici n'est async.
 *
 * Utilisé par :
 *  - POST /api/reservations/verifier-disponibilite  (getConflits)
 *  - GET  /api/gerant/disponibilites                 (getDisponibilitesPourJoueur)
 */
const { queryAll, queryOne } = require('../database');
const {
  buildSlotsForOpenDay,
  jourDepuisDate,
  addDaysYmd,
  parseEndHour,
  labelHeureSenegal,
  courtLabelHeureSenegal,
} = require('../scheduleService');
const { prixHoraireEffectif } = require('../pricingService');

const STATUTS_OCCUPES_CRENEAU = ['reserve', 'en_attente_paiement', 'bloque', 'tournoi', 'abonnement'];
const STATUTS_RESA_ACTIVES = ['confirme', 'acceptee', 'match_joue', 'joue', 'en_attente', 'en_attente_paiement'];

function hhmm(value) {
  return String(value || '').slice(0, 5);
}

function toYmd(value) {
  return String(value || '').slice(0, 10);
}

function timeToMinutes(value) {
  const [h, m] = hhmm(value).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToHhmm(total) {
  const n = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addMinutesHhmm(heure, minutes) {
  return minutesToHhmm(timeToMinutes(heure) + Number(minutes || 0));
}

function dureeMinutesOf(heureDebut, heureFin) {
  const debut = timeToMinutes(heureDebut);
  let fin = timeToMinutes(heureFin);
  if (fin === 0 && hhmm(heureFin) === '00:00') fin = 24 * 60;
  if (fin <= debut) fin += 24 * 60;
  return fin - debut;
}

function formatDuree(minutes) {
  const m = Math.max(0, Number(minutes) || 0);
  if (m <= 0) return '0 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest > 0 ? `${h}h${String(rest).padStart(2, '0')}` : `${h}h`;
}

/** Chevauchement de plages HH:MM (fin 00:00 = minuit, traité comme 24:00). */
function chevauche(aDebut, aFin, bDebut, bFin) {
  const aS = timeToMinutes(aDebut);
  let aE = timeToMinutes(aFin);
  const bS = timeToMinutes(bDebut);
  let bE = timeToMinutes(bFin);
  if (aE === 0) aE = 24 * 60;
  if (bE === 0) bE = 24 * 60;
  return aS < bE && aE > bS;
}

/**
 * Un créneau dont l'heure de début est passée n'est jamais proposé au joueur.
 * Ne s'applique qu'à la date du jour (calendrier local serveur).
 */
function exclureCreneauxHorairesPasses(creneaux, dateStr, maintenant = new Date()) {
  const list = Array.isArray(creneaux) ? creneaux : [];
  const ymd = toYmd(dateStr);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return list;

  const now = maintenant instanceof Date ? maintenant : new Date(maintenant);
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return list.filter((c) => {
    const slotDate = toYmd(c.date || ymd);
    if (slotDate > todayStr) return true;
    if (slotDate < todayStr) return false;
    const debut = hhmm(c.heure_debut || c.heure);
    if (!debut || !/^\d{2}:\d{2}$/.test(debut)) return true;
    return timeToMinutes(debut) > nowMinutes;
  });
}

/**
 * Plages déjà occupées qui chevauchent [heure_debut, heure_fin[ à une date donnée
 * (creneaux non libres + réservations actives, verrou paiement expiré ignoré).
 */
function getConflits(database, terrainId, date, heureDebut, heureFin, exclureReservationId = null) {
  const debut = hhmm(heureDebut);
  const fin = hhmm(heureFin);
  const finCmp = fin === '00:00' ? '24:00' : fin;
  const now = Date.now();
  const fromCreneaux = queryAll(
    database,
    `SELECT c.id, c.terrain_id, c.date, c.heure_debut, c.heure_fin, c.statut, c.duree_minutes,
            r.id AS reservation_id, r.joueur_id,
            COALESCE(r.joueur_nom, u.nom) AS joueur_nom
       FROM creneaux c
       LEFT JOIN reservations r ON r.creneau_id = c.id
         AND (
           r.statut IN ('confirme', 'acceptee', 'match_joue', 'joue')
           OR (r.statut = 'en_attente' AND r.verrou_expire_at IS NOT NULL AND r.verrou_expire_at > ?)
         )
       LEFT JOIN users u ON u.id = r.joueur_id
      WHERE c.terrain_id = ?
        AND c.date = ?
        AND (
          c.statut IN ('reserve', 'bloque', 'tournoi', 'abonnement')
          OR (
            c.statut = 'en_attente_paiement'
            AND r.id IS NOT NULL
          )
        )
        AND substr(c.heure_debut, 1, 5) < ?
        AND (CASE WHEN substr(c.heure_fin, 1, 5) = '00:00' THEN '24:00' ELSE substr(c.heure_fin, 1, 5) END) > ?
        ${exclureReservationId ? 'AND (r.id IS NULL OR r.id != ?)' : ''}`,
    exclureReservationId
      ? [now, terrainId, date, finCmp, debut, Number(exclureReservationId)]
      : [now, terrainId, date, finCmp, debut],
  );

  const fromResa = queryAll(
    database,
    `SELECT r.id AS reservation_id, r.creneau_id AS id, r.terrain_id, r.date,
            r.heure_debut, r.heure_fin, r.statut,
            COALESCE(r.joueur_nom, u.nom) AS joueur_nom,
            NULL AS duree_minutes
       FROM reservations r
       LEFT JOIN users u ON u.id = r.joueur_id
      WHERE r.terrain_id = ?
        AND r.date = ?
        AND (
          r.statut IN ('confirme', 'acceptee', 'match_joue', 'joue')
          OR (r.statut = 'en_attente' AND r.verrou_expire_at IS NOT NULL AND r.verrou_expire_at > ?)
        )
        AND substr(r.heure_debut, 1, 5) < ?
        AND (CASE WHEN substr(r.heure_fin, 1, 5) = '00:00' THEN '24:00' ELSE substr(r.heure_fin, 1, 5) END) > ?
        ${exclureReservationId ? 'AND r.id != ?' : ''}`,
    exclureReservationId
      ? [terrainId, date, now, finCmp, debut, Number(exclureReservationId)]
      : [terrainId, date, now, finCmp, debut],
  );

  const seen = new Set();
  const out = [];
  for (const row of [...fromCreneaux, ...fromResa]) {
    const key = row.reservation_id ? `r-${row.reservation_id}` : `c-${row.id}-${hhmm(row.heure_debut)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...row,
      heure_debut: hhmm(row.heure_debut),
      heure_fin: hhmm(row.heure_fin),
      duree_minutes: Number(row.duree_minutes) || dureeMinutesOf(row.heure_debut, row.heure_fin),
      joueur_nom: String(row.joueur_nom || '').trim() || null,
    });
  }
  return out;
}

/**
 * Disponibilités d'une journée : grille d'ouverture × chevauchements des plages occupées.
 * options.duree_minutes : durée demandée (défaut = durée du slot, 60 min).
 * options.inclure_passes : true pour le gérant (heures déjà passées conservées).
 */
function getDisponibilitesPourJoueur(database, terrainId, date, options = {}) {
  const dureeDemandee = options.duree_minutes != null ? Number(options.duree_minutes) : null;
  const inclurePasses = Boolean(options.inclure_passes);
  const dateStr = toYmd(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { creneaux: [], ferme: false, horaire: null, message: 'Date invalide' };
  }

  const terrain = queryOne(database, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) return { creneaux: [], ferme: false, horaire: null };
  if (Number(terrain.is_active) === 0) {
    return { creneaux: [], ferme: true, motif: 'Terrain temporairement fermé', is_active: 0 };
  }

  const jour = jourDepuisDate(dateStr);
  const horaire = queryOne(database, 'SELECT * FROM horaires WHERE terrain_id = ? AND jour = ?', [terrainId, jour]);
  let planned = buildSlotsForOpenDay(dateStr, horaire);

  // Minuit culturel de la veille : exposé aussi sur ce jour (même logique que /api/terrains/:id/creneaux)
  const prevDate = addDaysYmd(dateStr, -1);
  const prevJour = jourDepuisDate(prevDate);
  const prevHoraire = queryOne(database, 'SELECT * FROM horaires WHERE terrain_id = ? AND jour = ?', [terrainId, prevJour]);
  if (prevHoraire && Number(prevHoraire.est_ouvert) && parseEndHour(prevHoraire.heure_fin) === 24) {
    const hasMidnight = planned.some((s) => s.date === dateStr && s.heure_debut === '00:00');
    if (!hasMidnight) {
      planned = [
        {
          date: dateStr,
          heure_debut: '00:00',
          heure_fin: '01:00',
          label: labelHeureSenegal(dateStr, '00:00'),
          label_court: courtLabelHeureSenegal(dateStr, '00:00'),
          est_minuit_culturel: true,
          jour_tarif: prevJour,
          date_affichage: prevDate,
        },
        ...planned,
      ];
    }
  }

  if (!planned.length) {
    return { creneaux: [], message: 'Fermé ce jour', horaire: horaire || null, calendrier: 'senegal' };
  }

  const datesNeeded = [...new Set(planned.map((s) => toYmd(s.date)))];
  const placeholders = datesNeeded.map(() => '?').join(',');

  const now = Date.now();
  const reservations = queryAll(
    database,
    `SELECT date, heure_debut, heure_fin, statut, joueur_nom, verrou_expire_at FROM reservations
      WHERE terrain_id = ? AND date IN (${placeholders})
        AND (
          statut IN ('confirme', 'acceptee', 'match_joue', 'joue')
          OR (
            statut IN ('en_attente', 'en_attente_paiement')
            AND verrou_expire_at IS NOT NULL
            AND verrou_expire_at > ?
          )
        )`,
    [terrainId, ...datesNeeded, now],
  );
  const blocages = queryAll(
    database,
    `SELECT date, heure_debut, heure_fin, motif, type_blocage FROM blocages_creneaux
      WHERE terrain_id = ? AND date IN (${placeholders})`,
    [terrainId, ...datesNeeded],
  );
  const creneauxOccupes = queryAll(
    database,
    `SELECT date, heure_debut, heure_fin, statut FROM creneaux
      WHERE terrain_id = ? AND date IN (${placeholders})
        AND statut IN (${STATUTS_OCCUPES_CRENEAU.map((s) => `'${s}'`).join(', ')})`,
    [terrainId, ...datesNeeded],
  );

  const resaActives = reservations.map((r) => ({
    date: toYmd(r.date),
    heure_debut: hhmm(r.heure_debut),
    heure_fin: hhmm(r.heure_fin),
    statut: r.statut,
  }));

  const occupes = [
    ...reservations.map((r) => ({
      date: toYmd(r.date),
      heure_debut: hhmm(r.heure_debut),
      heure_fin: hhmm(r.heure_fin),
      kind: r.statut === 'en_attente' || r.statut === 'en_attente_paiement' ? 'verrou' : 'reserve',
      label: r.joueur_nom || 'Réservé',
      verrou_expire_at: r.verrou_expire_at || null,
    })),
    ...blocages.map((b) => ({
      date: toYmd(b.date),
      heure_debut: hhmm(b.heure_debut),
      heure_fin: hhmm(b.heure_fin),
      kind: 'bloque',
      label: b.type_blocage || b.motif || 'Bloqué',
    })),
    // en_attente_paiement orphelin (paiement abandonné) ne doit plus bloquer l'affichage
    ...creneauxOccupes
      .filter((c) => {
        if (c.statut !== 'en_attente_paiement') return true;
        const d = toYmd(c.date);
        const debut = hhmm(c.heure_debut);
        const fin = hhmm(c.heure_fin);
        return resaActives.some(
          (r) =>
            r.statut === 'en_attente' &&
            r.date === d &&
            chevauche(debut, fin, r.heure_debut, r.heure_fin),
        );
      })
      .map((c) => ({
        date: toYmd(c.date),
        heure_debut: hhmm(c.heure_debut),
        heure_fin: hhmm(c.heure_fin),
        kind: c.statut === 'bloque' ? 'bloque' : 'reserve',
        label: c.statut,
      })),
  ];

  const creneaux = [];
  for (const slotPlan of planned) {
    const slotDate = toYmd(slotPlan.date);
    const debut = hhmm(slotPlan.heure_debut);
    const finBase = hhmm(slotPlan.heure_fin);
    const dureeBase = dureeMinutesOf(debut, finBase);
    const duree = dureeDemandee && dureeDemandee > 0 ? dureeDemandee : dureeBase;
    const fin = addMinutesHhmm(debut, duree);

    const conflits = occupes.filter(
      (o) => o.date === slotDate && chevauche(debut, fin, o.heure_debut, o.heure_fin),
    );
    const enConflit = conflits.length > 0;
    const premier = conflits[0];
    let raison = null;
    if (enConflit) {
      if (premier.kind === 'bloque') raison = 'bloque';
      else if (premier.kind === 'verrou') raison = 'verrou';
      else if (chevauche(debut, finBase, premier.heure_debut, premier.heure_fin) && duree === dureeBase) {
        raison = 'reserve';
      } else {
        raison = 'chevauchement';
      }
    }

    const prixEntier = prixHoraireEffectif(database, terrain, slotDate, debut, 'entier', slotPlan.jour_tarif || null);
    const prixMoitie = prixHoraireEffectif(database, terrain, slotDate, debut, 'moitie', slotPlan.jour_tarif || null);

    creneaux.push({
      date: slotDate,
      date_selection: dateStr,
      heure: debut,
      heure_debut: debut,
      heure_fin: fin,
      heure_fin_slot: finBase,
      duree_minutes: duree,
      duree_label: formatDuree(duree),
      label: slotPlan.label || labelHeureSenegal(slotDate, debut),
      label_court: slotPlan.label_court || courtLabelHeureSenegal(slotDate, debut),
      est_minuit_culturel: Boolean(slotPlan.est_minuit_culturel),
      date_affichage: slotPlan.date_affichage || slotDate,
      statut: enConflit ? (raison === 'bloque' ? 'bloque' : raison === 'verrou' ? 'verrou' : 'reserve') : 'libre',
      disponible: !enConflit,
      bloque: raison === 'bloque',
      verrou_paiement: raison === 'verrou',
      verrou_expire_at: raison === 'verrou' ? premier.verrou_expire_at || null : null,
      raison_indisponibilite: enConflit
        ? raison === 'chevauchement'
          ? `Un match de ${formatDuree(dureeMinutesOf(premier.heure_debut, premier.heure_fin))} commence à ${premier.heure_debut.replace(':', 'h')}`
          : raison === 'bloque'
            ? 'Créneau bloqué'
            : raison === 'verrou'
              ? 'Réservé temporairement — paiement en cours'
              : 'Ce créneau est pris'
        : null,
      conflit_avec: enConflit
        ? {
            heure_debut: premier.heure_debut,
            heure_fin: premier.heure_fin,
            duree_minutes: dureeMinutesOf(premier.heure_debut, premier.heure_fin),
            kind: premier.kind,
          }
        : null,
      prix_entier: Number(prixEntier || 0),
      prix_moitie: Number(prixMoitie || 0),
    });
  }

  return {
    creneaux: inclurePasses ? creneaux : exclureCreneauxHorairesPasses(creneaux, dateStr),
    horaire: horaire || null,
    calendrier: 'senegal',
    note_minuit: 'Le créneau 00:00 s’affiche et se programme comme « minuit » du jour précédent.',
    prix_entier_base: Number(terrain.prix_entier || terrain.prix_heure || 0),
    prix_moitie_base: Number(terrain.prix_moitie || 0),
    pourcentage_avance: Number(terrain.pourcentage_avance || 12.5),
  };
}

module.exports = {
  getConflits,
  getDisponibilitesPourJoueur,
  exclureCreneauxHorairesPasses,
  formatDuree,
  dureeMinutesOf,
  timeToMinutes,
  addMinutesHhmm,
  hhmm,
  toYmd,
  chevauche,
  STATUTS_OCCUPES_CRENEAU,
  STATUTS_RESA_ACTIVES,
};
