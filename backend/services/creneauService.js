/**
 * Source de vérité — créneaux à durée variable.
 * Modèle : 1 réservation = 1 ligne creneaux (heure_debut → heure_fin).
 * PostgreSQL async (queryAll / queryOne).
 */
const { queryAll, queryOne } = require('../database');
const {
  buildSlotsForOpenDay,
  jourDepuisDate,
  addDaysYmd,
  labelHeureSenegal,
  courtLabelHeureSenegal,
} = require('../scheduleService');
const { getJourPercuBackend, estNuitProlongee } = require('../utils/creneauLabel');
const { DEFAULT_FENETRE_RETARD_MIN, toYmd, estDansLaFenetreCheckIn, idPrioriteScannable } = require('./checkInFenetre');

const STATUTS_OCCUPES_CRENEAU = ['reserve', 'en_attente_paiement', 'bloque', 'tournoi', 'abonnement', 'joue'];
const STATUTS_RESA_ACTIVES = ['confirme', 'acceptee', 'match_joue', 'joue', 'en_attente', 'en_attente_paiement'];

function hhmm(value) {
  return String(value || '').slice(0, 5);
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
  let debut = timeToMinutes(heureDebut);
  let fin = timeToMinutes(heureFin);
  if (fin === 0 && hhmm(heureFin) === '00:00') fin = 24 * 60;
  if (fin <= debut) fin += 24 * 60;
  return fin - debut;
}

/**
 * Règle produit (joueur) : un créneau dont l'heure de début est déjà passée
 * n'est JAMAIS affiché — libre, réservé, abonnement, tournoi ou bloqué.
 * Ne s'applique qu'à la date du jour (calendrier local serveur).
 */
function exclureCreneauxHorairesPasses(creneaux, dateStr, maintenant = new Date()) {
  const list = Array.isArray(creneaux) ? creneaux : [];
  const ymd = toYmd(dateStr);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return list;

  const now = maintenant instanceof Date ? maintenant : new Date(maintenant);
  const todayStr = toYmd(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  );
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return list.filter((c) => {
    // Date technique du slot (nuit prolongée = lendemain calendaire)
    const slotDate = toYmd(c.date || ymd);
    if (slotDate > todayStr) return true;
    if (slotDate < todayStr) return false;
    // slotDate === aujourd'hui
    const debut = hhmm(c.heure_debut || c.heure);
    if (!debut || !/^\d{2}:\d{2}$/.test(debut)) return true;
    return timeToMinutes(debut) > nowMinutes;
  });
}

function formatDuree(minutes) {
  const m = Math.max(0, Number(minutes) || 0);
  if (m <= 0) return '0 min';

  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest > 0 ? `${h}h${String(rest).padStart(2, '0')}` : `${h}h`;
}

function chevauche(aDebut, aFin, bDebut, bFin) {
  return hhmm(aDebut) < hhmm(bFin) && hhmm(aFin) > hhmm(bDebut);
}

/**
 * Vérifie si une plage chevauche des créneaux / résas déjà occupés.
 */
async function getConflits(database, terrain_id, date, heure_debut, heure_fin, exclure_reservation_id = null) {
  const debut = hhmm(heure_debut);
  const fin = hhmm(heure_fin);
  let query = `
    SELECT c.*,
           r.id AS reservation_id,
           r.joueur_id,
           COALESCE(r.joueur_nom, TRIM(CONCAT(COALESCE(u.prenom, ''), ' ', COALESCE(u.nom, '')))) AS joueur_nom,
           COALESCE(
             c.duree_minutes,
             (EXTRACT(HOUR FROM c.heure_fin)::INTEGER * 60 + EXTRACT(MINUTE FROM c.heure_fin)::INTEGER)
             - (EXTRACT(HOUR FROM c.heure_debut)::INTEGER * 60 + EXTRACT(MINUTE FROM c.heure_debut)::INTEGER)
           ) AS duree_minutes
    FROM creneaux c
    LEFT JOIN reservations r ON r.creneau_id = c.id
      AND r.statut IN ('confirme', 'acceptee', 'match_joue', 'joue', 'en_attente', 'en_attente_paiement')
    LEFT JOIN users u ON u.id = r.joueur_id
    WHERE c.terrain_id = ?
      AND c.date = ?
      AND c.statut IN ('reserve', 'en_attente_paiement', 'bloque', 'tournoi', 'abonnement')
      AND substr(CAST(c.heure_debut AS TEXT), 1, 5) < ?
      AND substr(CAST(c.heure_fin AS TEXT), 1, 5) > ?
  `;
  const params = [terrain_id, date, fin, debut];

  if (exclure_reservation_id) {
    query += ` AND (r.id IS NULL OR r.id != ?)`;
    params.push(exclure_reservation_id);
  }

  const fromCreneaux = await queryAll(database, query, params);

  // Sécurité : chevauchements aussi via reservations (heure_debut/fin sur la résa)
  let resaQuery = `
    SELECT r.id AS reservation_id, r.creneau_id AS id, r.terrain_id, r.date,
           r.heure_debut, r.heure_fin, r.statut,
           COALESCE(r.joueur_nom, TRIM(CONCAT(COALESCE(u.prenom, ''), ' ', COALESCE(u.nom, '')))) AS joueur_nom,
           NULL AS duree_minutes
    FROM reservations r
    LEFT JOIN users u ON u.id = r.joueur_id
    WHERE r.terrain_id = ?
      AND r.date = ?
      AND (
        r.statut IN ('confirme', 'acceptee', 'match_joue', 'joue')
        OR (
          r.statut = 'en_attente'
          AND (r.verrou_expire_at IS NULL OR r.verrou_expire_at > ?)
        )
      )
      AND substr(CAST(r.heure_debut AS TEXT), 1, 5) < ?
      AND substr(CAST(r.heure_fin AS TEXT), 1, 5) > ?
  `;
  const resaParams = [terrain_id, date, Date.now(), fin, debut];
  if (exclure_reservation_id) {
    resaQuery += ` AND r.id != ?`;
    resaParams.push(exclure_reservation_id);
  }
  const fromResa = await queryAll(database, resaQuery, resaParams);

  const seen = new Set();
  const out = [];
  for (const row of [...fromCreneaux, ...fromResa]) {
    const key = row.reservation_id || `c-${row.id}-${hhmm(row.heure_debut)}`;
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
 * Créneaux du jour enrichis (file gérant).
 * inclure_passes=false → exclut ceux dont heure_fin + fenetre_retard est dépassée.
 */
async function getCreneauxJour(database, terrain_id, date, options = {}) {
  const { inclure_passes = false, maintenant = new Date() } = options;

  const rows = await queryAll(
    database,
    `
    SELECT c.id AS creneau_id,
           c.terrain_id,
           c.date,
           c.heure_debut,
           c.heure_fin,
           c.statut,
           COALESCE(c.fenetre_retard, ${DEFAULT_FENETRE_RETARD_MIN}) AS fenetre_retard,
           COALESCE(
             c.duree_minutes,
             (EXTRACT(HOUR FROM c.heure_fin)::INTEGER * 60 + EXTRACT(MINUTE FROM c.heure_fin)::INTEGER)
             - (EXTRACT(HOUR FROM c.heure_debut)::INTEGER * 60 + EXTRACT(MINUTE FROM c.heure_debut)::INTEGER)
           ) AS duree_minutes,
           r.id AS reservation_id,
           r.statut AS resa_statut,
           r.code_reservation,
           r.montant_avance,
           r.montant_restant,
           r.montant AS montant,
           r.prix_total,
           r.mode_paiement,
           r.qr_code_scanne_at,
           r.cree_par,
           r.joueur_id,
           COALESCE(r.joueur_nom, TRIM(CONCAT(COALESCE(u.prenom, ''), ' ', COALESCE(u.nom, '')))) AS joueur_nom,
           COALESCE(r.joueur_telephone, u.telephone) AS joueur_tel,
           u.prenom AS joueur_prenom,
           u.nom AS joueur_nom_user
    FROM creneaux c
    LEFT JOIN reservations r ON r.creneau_id = c.id
      AND r.statut IN ('confirme', 'acceptee', 'match_joue', 'joue', 'en_attente', 'en_attente_paiement')
    LEFT JOIN users u ON u.id = r.joueur_id
    WHERE c.terrain_id = ? AND c.date = ?
    ORDER BY c.heure_debut ASC
  `,
    [terrain_id, date],
  );

  // Résas du jour sans creneau_id / autre mapping
  const resasOrphelines = await queryAll(
    database,
    `
    SELECT r.id AS reservation_id,
           r.terrain_id,
           r.date,
           r.heure_debut,
           r.heure_fin,
           r.statut AS resa_statut,
           r.creneau_id,
           r.code_reservation,
           r.montant_avance,
           r.montant_restant,
           r.montant,
           r.prix_total,
           r.mode_paiement,
           r.qr_code_scanne_at,
           r.cree_par,
           r.joueur_id,
           COALESCE(r.joueur_nom, TRIM(CONCAT(COALESCE(u.prenom, ''), ' ', COALESCE(u.nom, '')))) AS joueur_nom,
           COALESCE(r.joueur_telephone, u.telephone) AS joueur_tel,
           COALESCE(c.fenetre_retard, ${DEFAULT_FENETRE_RETARD_MIN}) AS fenetre_retard,
           COALESCE(
             c.duree_minutes,
             (EXTRACT(HOUR FROM COALESCE(c.heure_fin, r.heure_fin))::INTEGER * 60
               + EXTRACT(MINUTE FROM COALESCE(c.heure_fin, r.heure_fin))::INTEGER)
             - (EXTRACT(HOUR FROM COALESCE(c.heure_debut, r.heure_debut))::INTEGER * 60
               + EXTRACT(MINUTE FROM COALESCE(c.heure_debut, r.heure_debut))::INTEGER)
           ) AS duree_minutes,
           COALESCE(c.statut, CASE
             WHEN r.statut IN ('confirme', 'acceptee', 'match_joue', 'joue') THEN 'reserve'
             WHEN r.statut IN ('en_attente', 'en_attente_paiement') THEN 'en_attente_paiement'
             ELSE 'libre'
           END) AS statut
    FROM reservations r
    LEFT JOIN users u ON u.id = r.joueur_id
    LEFT JOIN creneaux c ON c.id = r.creneau_id
    WHERE r.terrain_id = ? AND r.date = ?
      AND r.statut IN ('confirme', 'acceptee', 'match_joue', 'joue', 'en_attente')
  `,
    [terrain_id, date],
  );

  const byKey = new Map();
  for (const row of rows) {
    const key = row.reservation_id
      ? `r-${row.reservation_id}`
      : `c-${row.creneau_id}-${hhmm(row.heure_debut)}-${hhmm(row.heure_fin)}`;
    byKey.set(key, normalizeCreneauRow(row));
  }
  for (const row of resasOrphelines) {
    const key = `r-${row.reservation_id}`;
    if (!byKey.has(key)) byKey.set(key, normalizeCreneauRow(row));
  }

  let list = [...byKey.values()].sort(
    (a, b) => timeToMinutes(a.heure_debut) - timeToMinutes(b.heure_debut),
  );

  if (!inclure_passes) {
    const nowMs = maintenant.getTime();
    list = list.filter((c) => {
      if (c.resa_statut === 'match_joue' || c.resa_statut === 'joue') {
        // Garder post-match tant que dans fenêtre retard (bloc terminés côté route)
        const finMs = atDateTimeMs(c.date, c.heure_fin) + (c.fenetre_retard || DEFAULT_FENETRE_RETARD_MIN) * 60_000;
        // Inclure matchs terminés du jour pour l'accordéon (route les groupe)
        return true;
      }
      const finPlusRetard =
        atDateTimeMs(c.date, c.heure_fin) + (Number(c.fenetre_retard) || DEFAULT_FENETRE_RETARD_MIN) * 60_000;
      // Actifs : pas encore terminés (heure_fin + retard)
      if (nowMs <= finPlusRetard) return true;
      // Terminés du jour : toujours inclus pour le bloc replié
      return Boolean(c.reservation_id);
    });
  }

  return list;
}

function normalizeCreneauRow(row) {
  const heure_debut = hhmm(row.heure_debut);
  const heure_fin = hhmm(row.heure_fin);
  const duree_minutes = Number(row.duree_minutes) || dureeMinutesOf(heure_debut, heure_fin);
  return {
    id: row.reservation_id || row.creneau_id || null,
    creneau_id: row.creneau_id || null,
    reservation_id: row.reservation_id || null,
    terrain_id: row.terrain_id,
    date: String(row.date || '').slice(0, 10),
    heure_debut,
    heure_fin,
    statut: row.statut || 'libre',
    resa_statut: row.resa_statut || null,
    fenetre_retard: Number(row.fenetre_retard) || DEFAULT_FENETRE_RETARD_MIN,
    duree_minutes,
    duree_label: formatDuree(duree_minutes),
    code_reservation: row.code_reservation || null,
    montant_avance: row.montant_avance != null ? Number(row.montant_avance) : null,
    montant_restant: row.montant_restant != null ? Number(row.montant_restant) : null,
    montant_total: Number(row.prix_total ?? row.montant ?? 0) || null,
    mode_paiement: row.mode_paiement || null,
    qr_code_scanne_at: row.qr_code_scanne_at || null,
    cree_par: row.cree_par || null,
    joueur_id: row.joueur_id || null,
    joueur_prenom: row.joueur_prenom || null,
    joueur_nom: String(row.joueur_nom || row.joueur_nom_user || '').trim() || null,
    joueur_tel: row.joueur_tel || null,
  };
}

function atDateTimeMs(date, heure) {
  const [h, m] = hhmm(heure).split(':').map(Number);
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}

/**
 * État temporel d'un créneau (imminent = 30 min).
 * Sans scan, passé l'heure de début → phase « en_retard » (jamais « en_cours »).
 */
function getEtatCreneau(creneau, maintenant = new Date(), fenetre_retard_min = DEFAULT_FENETRE_RETARD_MIN) {
  const date = String(creneau.date || '').slice(0, 10);
  const heureDebutMs = atDateTimeMs(date, creneau.heure_debut);
  const heureFinMs = atDateTimeMs(date, creneau.heure_fin);
  const retard = Number(fenetre_retard_min ?? creneau.fenetre_retard) || DEFAULT_FENETRE_RETARD_MIN;
  const debutFenetre = heureDebutMs - 60 * 60 * 1000;
  const finFenetre = heureFinMs + retard * 60 * 1000;
  const now = maintenant instanceof Date ? maintenant.getTime() : Number(maintenant);
  const minutesAvantDebut = Math.round((heureDebutMs - now) / 60000);
  const scanned = Boolean(creneau.qr_code_scanne_at);
  const confirme = ['confirme', 'acceptee'].includes(String(creneau.resa_statut || creneau.statut || ''));

  if (now < debutFenetre) {
    return {
      phase: 'futur',
      label: minutesAvantDebut > 0 ? `Dans ${minutesAvantDebut} min` : 'À venir',
      imminent: minutesAvantDebut > 0 && minutesAvantDebut <= 30,
    };
  }
  if (now >= debutFenetre && now < heureDebutMs) {
    return {
      phase: 'pre_match',
      label: `Commence dans ${Math.max(0, minutesAvantDebut)} min`,
      imminent: true,
    };
  }
  if (now >= heureDebutMs && now <= heureFinMs) {
    const minutesRestantes = Math.max(0, Math.round((heureFinMs - now) / 60000));
    const minutesRetard = Math.max(0, Math.round((now - heureDebutMs) / 60000));
    // Non scanné : en retard, pas en cours
    if (confirme && !scanned) {
      return {
        phase: 'en_retard',
        label: minutesRetard > 0 ? `En retard — ${minutesRetard} min` : 'En retard',
        imminent: true,
      };
    }
    return {
      phase: 'en_cours',
      label: `En cours — encore ~${minutesRestantes} min`,
      imminent: false,
    };
  }
  if (now > heureFinMs && now <= finFenetre) {
    if (confirme && !scanned) {
      return { phase: 'en_retard', label: 'En retard — créneau terminé', imminent: true };
    }
    return { phase: 'post_match', label: 'Match terminé', imminent: false };
  }
  return { phase: 'termine', label: 'Terminé', imminent: false };
}

/**
 * Disponibilités joueur : grille d'ouverture × chevauchements des plages occupées.
 * Une résa longue (ex. 18–20) rend indisponibles tous les départs qui chevauchent.
 */
async function getDisponibilitesPourJoueur(database, terrain_id, date, options = {}) {
  const dureeDemandee = options.duree_minutes != null ? Number(options.duree_minutes) : null;
  /** Gérant / admin : garder les heures passées (file, blocages). Joueur : les masquer. */
  const inclurePasses = Boolean(options.inclure_passes);
  const dateStr = toYmd(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { creneaux: [], ferme: false, horaire: null, message: 'Date invalide' };
  }
  const terrain = await queryOne(database, 'SELECT * FROM terrains WHERE id = ?', [terrain_id]);
  if (!terrain) return { creneaux: [], ferme: false, horaire: null };

  if (Number(terrain.is_active) === 0) {
    return { creneaux: [], ferme: true, motif: 'Terrain temporairement fermé', is_active: 0 };
  }

  const jour = jourDepuisDate(dateStr);
  const horaire = await queryOne(database, 'SELECT * FROM horaires WHERE terrain_id = ? AND jour = ?', [
    terrain_id,
    jour,
  ]);
  let planned = buildSlotsForOpenDay(dateStr, horaire);

  // Jour perçu = date sélectionnée :
  // - créneaux du jour avec heure >= 5h
  // - créneaux du lendemain 00h–04h59 (nuit prolongée)
  // Exclure les 00h–04h du jour sélectionné (ils appartiennent à la veille perçue)
  const dateLendemain = addDaysYmd(dateStr, 1);
  planned = planned.filter((s) => {
    const d = toYmd(s.date);
    const h = parseInt(String(s.heure_debut || '').substring(0, 2), 10);
    if (d === dateStr && Number.isFinite(h) && h < 5) return false;
    if (d === dateStr) return true;
    if (d === dateLendemain && Number.isFinite(h) && h < 5) return true;
    return false;
  });

  // Si l'horaire du jour sélectionné n'a pas généré la nuit (ex. fermé) mais
  // qu'on veut quand même… non : seuls les slots de buildSlotsForOpenDay comptent.
  // Compat : si prev fermait en nuit et que buildSlots n'a pas émis (jour fermé),
  // rien à injecter sur ce jour perçu.

  if (!planned.length) {
    return { creneaux: [], message: 'Fermé ce jour', horaire: horaire || null, calendrier: 'senegal' };
  }

  const datesNeeded = [...new Set(planned.map((s) => toYmd(s.date)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))];
  if (!datesNeeded.length) {
    return { creneaux: [], message: 'Fermé ce jour', horaire: horaire || null, calendrier: 'senegal' };
  }
  const placeholders = datesNeeded.map(() => '?').join(',');

  const reservationsExistantes = await queryAll(
    database,
    `SELECT date, heure_debut, heure_fin, statut, joueur_nom FROM reservations
      WHERE terrain_id = ? AND date IN (${placeholders})
        AND (
          statut IN ('confirme', 'acceptee', 'match_joue', 'joue')
          OR (
            statut = 'en_attente'
            AND (verrou_expire_at IS NULL OR verrou_expire_at > ?)
          )
        )`,
    [terrain_id, ...datesNeeded, Date.now()],
  );
  const blocages = await queryAll(
    database,
    `SELECT date, heure_debut, heure_fin, motif, type_blocage FROM blocages_creneaux
      WHERE terrain_id = ? AND date IN (${placeholders})`,
    [terrain_id, ...datesNeeded],
  );
  const creneauxOccupes = await queryAll(
    database,
    `SELECT date, heure_debut, heure_fin, statut FROM creneaux
      WHERE terrain_id = ? AND date IN (${placeholders})
        AND statut IN ('reserve', 'en_attente_paiement', 'bloque', 'tournoi', 'abonnement')`,
    [terrain_id, ...datesNeeded],
  );

  const occupes = [
    ...reservationsExistantes.map((r) => ({
      date: toYmd(r.date),
      heure_debut: hhmm(r.heure_debut),
      heure_fin: hhmm(r.heure_fin),
      kind: 'reserve',
      label: r.joueur_nom || 'Réservé',
    })),
    ...blocages.map((b) => ({
      date: toYmd(b.date),
      heure_debut: hhmm(b.heure_debut),
      heure_fin: hhmm(b.heure_fin),
      kind: 'bloque',
      label: b.type_blocage || b.motif || 'Bloqué',
    })),
    ...creneauxOccupes.map((c) => ({
      date: toYmd(c.date),
      heure_debut: hhmm(c.heure_debut),
      heure_fin: hhmm(c.heure_fin),
      kind: c.statut === 'bloque' ? 'bloque' : 'reserve',
      label: c.statut,
    })),
  ];

  const { getPrixActif } = require('./tarifService');
  const creneaux = [];

  for (const slotPlan of planned) {
    const slotDate = slotPlan.date;
    const debut = hhmm(slotPlan.heure_debut);
    const finBase = hhmm(slotPlan.heure_fin);
    const dureeBase = dureeMinutesOf(debut, finBase);
    const duree = dureeDemandee && dureeDemandee > 0 ? dureeDemandee : dureeBase;
    const fin = addMinutesHhmm(debut, duree);

    const conflits = occupes.filter(
      (o) => o.date === String(slotDate).slice(0, 10) && chevauche(debut, fin, o.heure_debut, o.heure_fin),
    );
    const enConflit = conflits.length > 0;
    const premier = conflits[0];
    let raison = null;
    if (enConflit) {
      if (premier.kind === 'bloque') raison = 'bloque';
      else if (chevauche(debut, finBase, premier.heure_debut, premier.heure_fin) && duree === dureeBase) {
        raison = 'reserve';
      } else {
        raison = 'chevauchement';
      }
    }

    const prixActif = await getPrixActif(database, terrain_id, slotDate, debut, slotPlan.jour_tarif || null);

    creneaux.push({
      date: slotDate,
      date_selection: date,
      heure: debut,
      heure_debut: debut,
      heure_fin: fin,
      heure_fin_slot: finBase,
      duree_minutes: duree,
      duree_label: formatDuree(duree),
      label: slotPlan.label || labelHeureSenegal(slotDate, debut),
      label_court: slotPlan.label_court || courtLabelHeureSenegal(slotDate, debut),
      est_minuit_culturel: Boolean(slotPlan.est_minuit_culturel),
      est_nuit_prolongee:
        Boolean(slotPlan.est_nuit_prolongee) || estNuitProlongee(debut),
      label_complet: (slotPlan.label || getJourPercuBackend(slotDate, debut).labelComplet),
      date_affichage: slotPlan.date_affichage || (estNuitProlongee(debut) ? addDaysYmd(slotDate, -1) : slotDate),
      statut: enConflit ? (raison === 'bloque' ? 'bloque' : 'reserve') : 'libre',
      disponible: !enConflit,
      bloque: raison === 'bloque',
      raison_indisponibilite: enConflit
        ? raison === 'chevauchement'
          ? `Un match de ${formatDuree(dureeMinutesOf(premier.heure_debut, premier.heure_fin))} commence à ${premier.heure_debut.replace(':', 'h')}`
          : raison === 'bloque'
            ? 'Créneau bloqué'
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
      prix_entier: Number(prixActif.prix_terrain_entier || 0),
      prix_moitie: Number(prixActif.prix_demi_terrain || 0),
      nom_tarif: prixActif.nom_tarif,
    });
  }

  return {
    creneaux: inclurePasses ? creneaux : exclureCreneauxHorairesPasses(creneaux, dateStr),
    horaire: horaire || null,
    calendrier: 'senegal',
    note_minuit:
      'Les créneaux 00h–04h59 s’affichent comme « Nuit du [jour précédent] » (usage local Sénégal).',
    note_nuit_prolongee:
      'Les créneaux entre 00h00 et 04h59 sont affichés aux joueurs sous le label « Nuit du [jour précédent] ». La date technique reste correcte en base.',
    prix_entier_base: Number(terrain.prix_entier || terrain.prix_heure || 0),
    prix_moitie_base: Number(terrain.prix_moitie || 0),
    pourcentage_avance: Number(terrain.pourcentage_avance || 12.5),
  };
}

/**
 * Groupe la file d'attente gérant (source unique backend).
 */
function grouperFileDAttente(creneaux, maintenant = new Date()) {
  const now = maintenant instanceof Date ? maintenant : new Date(maintenant);
  const enrichis = creneaux.map((c) => ({
    ...c,
    etat: getEtatCreneau(c, now, c.fenetre_retard),
  }));

  const imminents = enrichis.filter(
    (c) =>
      c.etat.imminent &&
      ['confirme', 'acceptee'].includes(String(c.resa_statut || '')) &&
      !c.qr_code_scanne_at,
  );
  // Non scanné passé l'heure (en retard) → aussi dans imminents (garder scanner)
  const enRetardNonScanne = enrichis.filter(
    (c) =>
      c.etat.phase === 'en_retard' &&
      ['confirme', 'acceptee'].includes(String(c.resa_statut || '')) &&
      !c.qr_code_scanne_at &&
      !imminents.some((i) => i.reservation_id === c.reservation_id),
  );
  const imminentsAll = [...imminents, ...enRetardNonScanne].sort(
    (a, b) => timeToMinutes(a.heure_debut) - timeToMinutes(b.heure_debut),
  );

  // Un seul scannable à la fois : le plus tôt dans la fenêtre de validation
  const nowMs = now.getTime();
  const candidatsFenetre = imminentsAll.filter((c) =>
    estDansLaFenetreCheckIn(
      {
        date: c.date,
        heure_debut: c.heure_debut,
        heure_fin: c.heure_fin,
        fenetre_retard: c.fenetre_retard,
      },
      nowMs,
    ),
  );
  const scannableId = idPrioriteScannable(
    candidatsFenetre.map((c) => ({
      id: c.reservation_id,
      date: c.date,
      heure_debut: c.heure_debut,
      joueur_nom: c.joueur_nom,
      code_reservation: c.code_reservation,
    })),
  );
  const imminentsAvecPriorite = imminentsAll.map((c) => {
    const dansFenetre = estDansLaFenetreCheckIn(
      {
        date: c.date,
        heure_debut: c.heure_debut,
        heure_fin: c.heure_fin,
        fenetre_retard: c.fenetre_retard,
      },
      nowMs,
    );
    const scannable_now =
      dansFenetre &&
      Boolean(scannableId) &&
      Number(c.reservation_id) === Number(scannableId);
    return {
      ...c,
      scannable_now,
      scan_bloque_par_priorite: dansFenetre && !scannable_now,
      priorite_scan_id: scannableId,
    };
  });

  const en_cours = enrichis.filter(
    (c) =>
      c.etat.phase === 'en_cours' &&
      Boolean(c.qr_code_scanne_at || ['match_joue', 'joue'].includes(String(c.resa_statut || ''))),
  );
  const libres = enrichis.filter(
    (c) => c.statut === 'libre' && !c.reservation_id && c.etat.phase !== 'termine' && c.etat.phase !== 'post_match',
  );
  const a_venir = enrichis.filter(
    (c) =>
      ['confirme', 'acceptee'].includes(String(c.resa_statut || '')) &&
      !c.etat.imminent &&
      c.etat.phase !== 'termine' &&
      c.etat.phase !== 'post_match' &&
      c.etat.phase !== 'en_cours' &&
      !imminentsAll.some((i) => i.reservation_id === c.reservation_id),
  );
  const en_attente = enrichis.filter((c) =>
    ['en_attente', 'en_attente_paiement'].includes(String(c.resa_statut || c.statut || '')),
  );
  const post_match = enrichis.filter((c) => c.etat.phase === 'post_match');
  const termines = enrichis.filter(
    (c) =>
      c.etat.phase === 'termine' ||
      (['match_joue', 'joue'].includes(String(c.resa_statut || '')) && c.etat.phase !== 'en_cours' && c.etat.phase !== 'post_match'),
  );

  return {
    imminents: imminentsAvecPriorite,
    en_cours,
    libres,
    a_venir,
    en_attente,
    post_match,
    termines,
    total: enrichis.length,
    heure_serveur: now.toISOString(),
    priorite_scan_id: scannableId,
  };
}

module.exports = {
  getConflits,
  getCreneauxJour,
  getDisponibilitesPourJoueur,
  getEtatCreneau,
  grouperFileDAttente,
  exclureCreneauxHorairesPasses,
  formatDuree,
  dureeMinutesOf,
  timeToMinutes,
  addMinutesHhmm,
  hhmm,
  chevauche,
  STATUTS_OCCUPES_CRENEAU,
  STATUTS_RESA_ACTIVES,
};
