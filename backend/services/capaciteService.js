/**
 * Capacité demi-terrains (zones A / B).
 * Unique source de vérité : aucun if dispersé sur creneaux.statut pour la dispo.
 *
 * Convention :
 *  - format_terrain 'moitie' → 1 zone ; 'entier' → AB
 *  - zone attribuée à la confirmation (pas au choix joueur)
 *  - résas en attente non expirées consomment la capacité du type demandé
 */

const { queryAll, queryOne } = require('../database');

const ZONE_A = 'A';
const ZONE_B = 'B';
const ZONE_AB = 'AB';
const ZONES = Object.freeze([ZONE_A, ZONE_B]);

const STATUTS_RESA_OCCUPANTES = Object.freeze([
  'confirme',
  'acceptee',
  'match_joue',
  'joue',
  'en_attente',
  'en_attente_paiement',
]);

function hhmm(value) {
  return String(value || '').slice(0, 5);
}

function normalizeFormat(format) {
  const raw = String(format || '').trim().toLowerCase();
  if (raw === 'moitie' || raw === 'demi' || raw === 'demi_terrain' || raw === 'half') {
    return 'moitie';
  }
  return 'entier';
}

function normalizeZone(zone, format = null) {
  const z = String(zone || '').trim().toUpperCase();
  if (z === ZONE_A || z === ZONE_B || z === ZONE_AB) return z;
  if (normalizeFormat(format) === 'entier') return ZONE_AB;
  return null;
}

/** Ensemble des lettres de zone couvertes par une valeur zone. */
function zonesDeValeur(zone) {
  const z = normalizeZone(zone);
  if (z === ZONE_AB) return [ZONE_A, ZONE_B];
  if (z === ZONE_A || z === ZONE_B) return [z];
  return [];
}

function chevaucheIntervalle(aDebut, aFin, bDebut, bFin) {
  const aS = hhmm(aDebut);
  const aE = hhmm(aFin);
  const bS = hhmm(bDebut);
  const bE = hhmm(bFin);
  return aS < bE && bS < aE;
}

/**
 * Applique une occupation (zone connue) sur un Set mutable.
 * @returns {Set<string>}
 */
function appliquerOccupation(occupees, zone) {
  const set = occupees instanceof Set ? occupees : new Set(occupees || []);
  for (const z of zonesDeValeur(zone)) set.add(z);
  return set;
}

/**
 * Attribue virtuellement des demis sans zone (verrous) : A puis B.
 * @param {Set<string>} occupees
 * @param {number} count
 */
function consommerDemisSansZone(occupees, count) {
  const set = occupees instanceof Set ? occupees : new Set(occupees || []);
  let remaining = Math.max(0, Number(count) || 0);
  while (remaining > 0) {
    if (!set.has(ZONE_A)) set.add(ZONE_A);
    else if (!set.has(ZONE_B)) set.add(ZONE_B);
    else break;
    remaining -= 1;
  }
  return set;
}

/**
 * Pure : état à partir d'un ensemble de zones occupées.
 * @returns {{ etat: 'libre'|'partiel'|'complet', zones_occupees: string[], zones_libres: string[], demi_disponible: boolean, entier_disponible: boolean }}
 */
function etatDepuisOccupees(occupees) {
  const set = occupees instanceof Set ? occupees : new Set(occupees || []);
  const zones_occupees = ZONES.filter((z) => set.has(z));
  const zones_libres = ZONES.filter((z) => !set.has(z));
  let etat = 'libre';
  if (zones_libres.length === 0) etat = 'complet';
  else if (zones_libres.length === 1) etat = 'partiel';
  return {
    etat,
    zones_occupees,
    zones_libres,
    demi_disponible: zones_libres.length >= 1,
    entier_disponible: zones_libres.length === 2,
  };
}

/**
 * Pure : première zone libre selon le type demandé.
 * @returns {'A'|'B'|'AB'|null}
 */
function choisirZone(type, occupees) {
  const format = normalizeFormat(type);
  const etat = etatDepuisOccupees(occupees);
  if (format === 'entier') {
    return etat.entier_disponible ? ZONE_AB : null;
  }
  if (etat.zones_libres.includes(ZONE_A)) return ZONE_A;
  if (etat.zones_libres.includes(ZONE_B)) return ZONE_B;
  return null;
}

/**
 * Pure : le type demandé est-il réservable ?
 */
function peutReserverDepuisOccupees(type, occupees) {
  const format = normalizeFormat(type);
  const etat = etatDepuisOccupees(occupees);
  return format === 'entier' ? etat.entier_disponible : etat.demi_disponible;
}

function reservationEstOccupante(row, nowMs) {
  const statut = String(row.statut || '');
  if (['confirme', 'acceptee', 'match_joue', 'joue'].includes(statut)) return true;
  if (!['en_attente', 'en_attente_paiement'].includes(statut)) return false;
  const exp = row.verrou_expire_at;
  if (exp == null || exp === '') return true;
  return Number(exp) > Number(nowMs);
}

/**
 * Occupations explicites (zones connues) + compteurs de verrous sans zone.
 * Les verrous sans zone consomment de la capacité sans préempter A/B
 * (l'attribution lettre se fait à la confirmation : 1er → A, 2e → B).
 */
function chargerOccupations(database, terrainId, date, debut, fin, options = {}) {
  const nowMs = options.now != null ? Number(options.now) : Date.now();
  const excludeId = options.excludeReservationId != null ? Number(options.excludeReservationId) : null;
  const d0 = hhmm(debut);
  const d1 = hhmm(fin);

  const reservations = queryAll(
    database,
    `SELECT id, format_terrain, zone, statut, verrou_expire_at, heure_debut, heure_fin
       FROM reservations
      WHERE terrain_id = ?
        AND date = ?
        AND statut IN (${STATUTS_RESA_OCCUPANTES.map((s) => `'${s}'`).join(',')})
        AND heure_debut < ? AND heure_fin > ?`,
    [terrainId, date, d1, d0],
  );

  const blocages = queryAll(
    database,
    `SELECT id, zone, heure_debut, heure_fin
       FROM blocages_creneaux
      WHERE terrain_id = ?
        AND date = ?
        AND substr(heure_debut, 1, 5) < ?
        AND substr(heure_fin, 1, 5) > ?`,
    [terrainId, date, d1, d0],
  );

  const explicites = new Set();
  let demisSansZone = 0;
  let entiersSansZone = 0;

  for (const r of reservations) {
    if (excludeId != null && Number(r.id) === excludeId) continue;
    if (!reservationEstOccupante(r, nowMs)) continue;
    if (!chevaucheIntervalle(d0, d1, r.heure_debut, r.heure_fin)) continue;

    const format = normalizeFormat(r.format_terrain);
    const zone = normalizeZone(r.zone, format);
    if (zone) {
      appliquerOccupation(explicites, zone);
    } else if (format === 'entier') {
      entiersSansZone += 1;
    } else {
      demisSansZone += 1;
    }
  }

  for (const b of blocages) {
    if (!chevaucheIntervalle(d0, d1, b.heure_debut, b.heure_fin)) continue;
    const zone = normalizeZone(b.zone) || ZONE_AB;
    appliquerOccupation(explicites, zone);
  }

  for (let i = 0; i < entiersSansZone; i += 1) {
    appliquerOccupation(explicites, ZONE_AB);
  }

  return { explicites, demisSansZone, entiersSansZone };
}

/**
 * Ensemble {A,B} pour affichage / sync : zones explicites + demis sans zone
 * placés virtuellement (A puis B) afin de refléter l'état partiel/complet.
 */
function zonesOccupees(database, terrainId, date, debut, fin, options = {}) {
  const { explicites, demisSansZone } = chargerOccupations(
    database,
    terrainId,
    date,
    debut,
    fin,
    options,
  );
  return consommerDemisSansZone(new Set(explicites), demisSansZone);
}

function placesLibres(database, terrainId, date, debut, fin, options = {}) {
  const { explicites, demisSansZone } = chargerOccupations(
    database,
    terrainId,
    date,
    debut,
    fin,
    options,
  );
  return Math.max(0, 2 - explicites.size - demisSansZone);
}

function etatCreneau(database, terrainId, date, debut, fin, options = {}) {
  return etatDepuisOccupees(zonesOccupees(database, terrainId, date, debut, fin, options));
}

function peutReserver(type, database, terrainId, date, debut, fin, options = {}) {
  const format = normalizeFormat(type);
  const libres = placesLibres(database, terrainId, date, debut, fin, options);
  return format === 'entier' ? libres >= 2 : libres >= 1;
}

/**
 * Attribution à la confirmation : 1re zone libre parmi les occupations explicites
 * (les autres verrous sans zone ne préemptent pas A).
 */
function attribuerZone(type, database, terrainId, date, debut, fin, options = {}) {
  const format = normalizeFormat(type);
  const { explicites, demisSansZone } = chargerOccupations(
    database,
    terrainId,
    date,
    debut,
    fin,
    options,
  );
  const libres = Math.max(0, 2 - explicites.size - demisSansZone);
  if (format === 'entier') {
    return libres >= 2 && explicites.size === 0 ? ZONE_AB : libres >= 2 ? ZONE_AB : null;
  }
  // Demi : première lettre libre hors occupations explicites uniquement
  if (libres < 1) return null;
  return choisirZone('moitie', explicites);
}

/**
 * Réservations confirmées en conflit avec un blocage de zone donnée.
 */
function reservationsConfirmeesEnConflit(database, terrainId, date, debut, fin, zoneBlocage) {
  const zonesVisees = new Set(zonesDeValeur(normalizeZone(zoneBlocage) || ZONE_AB));
  const rows = queryAll(
    database,
    `SELECT id, joueur_nom, joueur_telephone, format_terrain, zone, heure_debut, heure_fin, statut, montant, prix_total
       FROM reservations
      WHERE terrain_id = ?
        AND date = ?
        AND statut IN ('confirme', 'acceptee')
        AND heure_debut < ? AND heure_fin > ?`,
    [terrainId, date, hhmm(fin), hhmm(debut)],
  );
  return rows.filter((r) => {
    const format = normalizeFormat(r.format_terrain);
    const z = normalizeZone(r.zone, format) || (format === 'entier' ? ZONE_AB : ZONE_A);
    return zonesDeValeur(z).some((letter) => zonesVisees.has(letter));
  });
}

/**
 * Aligne creneaux.statut sur l'état de capacité (secondaire, pour legacy).
 * partiel → libre ; complet avec pending → en_attente_paiement ; complet confirmé → reserve ; blocage AB → bloque.
 */
function syncStatutCreneaux(database, terrainId, date, debut, fin, options = {}) {
  const { hourlySlots } = require('../scheduleService');
  const slots = hourlySlots(debut, fin);
  const nowMs = options.now != null ? Number(options.now) : Date.now();

  for (const slot of slots) {
    const etat = etatCreneau(database, terrainId, date, slot.heure_debut, slot.heure_fin, {
      now: nowMs,
    });

    const blocageAb = queryOne(
      database,
      `SELECT id, zone FROM blocages_creneaux
        WHERE terrain_id = ? AND date = ?
          AND substr(heure_debut, 1, 5) < ?
          AND substr(heure_fin, 1, 5) > ?
        LIMIT 1`,
      [terrainId, date, slot.heure_fin, slot.heure_debut],
    );
    const zoneBloc = normalizeZone(blocageAb?.zone) || (blocageAb ? ZONE_AB : null);

    let statut = 'libre';
    if (blocageAb && (zoneBloc === ZONE_AB || etat.etat === 'complet')) {
      statut = 'bloque';
    } else if (etat.etat === 'complet') {
      const pending = queryOne(
        database,
        `SELECT id FROM reservations
          WHERE terrain_id = ? AND date = ?
            AND statut IN ('en_attente', 'en_attente_paiement')
            AND (verrou_expire_at IS NULL OR verrou_expire_at > ?)
            AND heure_debut < ? AND heure_fin > ?
          LIMIT 1`,
        [terrainId, date, nowMs, slot.heure_fin, slot.heure_debut],
      );
      statut = pending ? 'en_attente_paiement' : 'reserve';
    }

    let creneau = queryOne(
      database,
      'SELECT id, statut FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?',
      [terrainId, date, slot.heure_debut, slot.heure_fin],
    );
    if (!creneau) {
      database.run(
        'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)',
        [terrainId, date, slot.heure_debut, slot.heure_fin, statut],
      );
      creneau = queryOne(
        database,
        'SELECT id, statut FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?',
        [terrainId, date, slot.heure_debut, slot.heure_fin],
      );
    } else if (creneau.statut !== statut && creneau.statut !== 'joue') {
      database.run('UPDATE creneaux SET statut = ? WHERE id = ?', [statut, creneau.id]);
    }
  }
}

/** Payload API créneau enrichi. */
function payloadEtatCreneau(database, terrainId, date, debut, fin, options = {}) {
  const etat = etatCreneau(database, terrainId, date, debut, fin, options);
  return {
    etat: etat.etat,
    zones_libres: etat.zones_libres,
    zones_occupees: etat.zones_occupees,
    demi_disponible: etat.demi_disponible,
    entier_disponible: etat.entier_disponible,
    disponible: etat.etat !== 'complet',
  };
}

/**
 * Heures-zone occupées / heures-zone ouvertes (KPI).
 * 1 créneau 1h ouvert = 2 unités (A+B). Une demi = 1, un entier = 2.
 */
function capaciteOccupeeHeures(reservations) {
  let units = 0;
  for (const r of reservations || []) {
    const debut = hhmm(r.heure_debut);
    const fin = hhmm(r.heure_fin);
    const [h0, m0] = debut.split(':').map(Number);
    const [h1, m1] = fin.split(':').map(Number);
    let minutes = h1 * 60 + m1 - (h0 * 60 + m0);
    if (minutes <= 0) minutes += 24 * 60;
    const hours = minutes / 60;
    const format = normalizeFormat(r.format_terrain);
    const zone = normalizeZone(r.zone, format);
    const weight = zone === ZONE_AB || format === 'entier' ? 2 : 1;
    units += hours * weight;
  }
  return units;
}

module.exports = {
  ZONE_A,
  ZONE_B,
  ZONE_AB,
  ZONES,
  normalizeFormat,
  normalizeZone,
  zonesDeValeur,
  appliquerOccupation,
  consommerDemisSansZone,
  etatDepuisOccupees,
  choisirZone,
  peutReserverDepuisOccupees,
  zonesOccupees,
  etatCreneau,
  peutReserver,
  attribuerZone,
  reservationsConfirmeesEnConflit,
  syncStatutCreneaux,
  payloadEtatCreneau,
  capaciteOccupeeHeures,
  chevaucheIntervalle,
  reservationEstOccupante,
};
