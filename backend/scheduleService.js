/**
 * Utilitaires créneaux + calendrier culturel sénégalais.
 * Nuit prolongée : créneaux 00h–04h59 du lendemain perçus comme « Nuit du [veille] ».
 * Date technique DB toujours correcte ; seul l'affichage change.
 */

const { getJourPercuBackend, estNuitProlongee } = require('./utils/creneauLabel');

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const JOURS_LABEL = {
  dimanche: 'Dimanche',
  lundi: 'Lundi',
  mardi: 'Mardi',
  mercredi: 'Mercredi',
  jeudi: 'Jeudi',
  vendredi: 'Vendredi',
  samedi: 'Samedi',
};

/** Horaires d'ouverture par défaut (fermeture nuit prolongée). */
const HORAIRES_DEFAUT = {
  heure_ouverture: '06:00',
  heure_fermeture: '03:00',
};

function parseHour(time) {
  const raw = String(time || '0').trim();
  if (raw === '24:00' || raw === '24') return 24;
  return parseInt(raw.split(':')[0], 10) || 0;
}

function formatHour(h) {
  if (h === 24) return '00:00';
  const n = ((h % 24) + 24) % 24;
  return `${String(n).padStart(2, '0')}:00`;
}

function normalizeHourString(time) {
  const raw = String(time || '').trim();
  if (raw === '24:00' || raw === '24') return '00:00';
  const m = raw.match(/^(\d{1,2})(?::(\d{1,2}))?/);
  if (!m) {
    const h = parseHour(time);
    if (h === 24) return '00:00';
    return formatHour(h);
  }
  // Accepte 00:00–23:59 (nuit prolongée incluse) — aucune heure bloquée
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10) || 0));
  const min = Math.min(59, Math.max(0, parseInt(m[2] || '0', 10) || 0));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Interprète heure_fin.
 * - "00:00" historique = jusqu'à minuit (24 exclusive) + extension culturelle au moins 00–01
 * - 01:00–04:59 = fermeture en nuit prolongée le lendemain (exclusive)
 * - sinon = heure exclusive le même jour (ou overnight si < début)
 */
function parseEndHour(time) {
  const raw = String(time || '').trim();
  if (!raw || raw === '00:00' || raw === '0:00' || raw === '24:00' || raw === '24') return 24;
  return parseHour(raw);
}

/** Fermeture en nuit prolongée (00:00–04:59). */
function isFermetureNuitProlongee(heureFin) {
  const raw = String(heureFin || '').trim().slice(0, 5);
  if (raw === '00:00' || raw === '0:00') return true;
  const h = parseHour(raw);
  return h >= 0 && h < 5;
}

function dateAtNoon(dateStr) {
  return new Date(`${String(dateStr).slice(0, 10)}T12:00:00`);
}

function jourDepuisDate(dateStr) {
  const d = dateAtNoon(dateStr);
  return JOURS[d.getDay()] || 'lundi';
}

function addDaysYmd(dateStr, days) {
  const d = dateAtNoon(dateStr);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function veilleJour(jour) {
  const idx = JOURS.indexOf(jour);
  if (idx < 0) return 'jeudi';
  return JOURS[(idx + 6) % 7];
}

/**
 * Label affiché : mardi 01:00 → « Nuit du Lundi » ; vendredi 00:00 → « Nuit du Jeudi ».
 */
function labelHeureSenegal(dateStr, heureDebut) {
  const h = parseHour(heureDebut);
  if (estNuitProlongee(heureDebut) || h === 24) {
    const { labelComplet } = getJourPercuBackend(dateStr, h === 24 ? '00:00' : heureDebut);
    return labelComplet;
  }
  return formatHour(h);
}

function courtLabelHeureSenegal(dateStr, heureDebut) {
  const h = parseHour(heureDebut);
  if (estNuitProlongee(heureDebut) || h === 24) {
    const { labelComplet } = getJourPercuBackend(dateStr, h === 24 ? '00:00' : heureDebut);
    return labelComplet;
  }
  return formatHour(h);
}

/**
 * Découpe [debut, fin) en créneaux 1h.
 * fin "00:00" / 24 ⇒ jusqu'à minuit (dernier slot 23:00–00:00).
 * Overnight (ex. 22→06) : wrap [22..24) + [0..06).
 */
function hourlySlots(heureDebut, heureFin) {
  let start = parseHour(heureDebut);
  let end = parseEndHour(heureFin);
  if (start === 24) start = 0;
  if (end > start) {
    const slots = [];
    for (let h = start; h < end; h += 1) {
      const next = h + 1;
      slots.push({
        heure_debut: formatHour(h === 24 ? 0 : h),
        heure_fin: next >= 24 ? '00:00' : formatHour(next),
        hour_index: h === 24 ? 0 : h,
      });
    }
    return slots;
  }
  if (end === start) return [];
  // Overnight wrap: e.g. 22:00 → 06:00 ou 06:00 → 03:00
  const slots = [];
  for (let h = start; h < 24; h += 1) {
    const next = h + 1;
    slots.push({
      heure_debut: formatHour(h),
      heure_fin: next >= 24 ? '00:00' : formatHour(next),
      hour_index: h,
    });
  }
  for (let h = 0; h < end; h += 1) {
    slots.push({
      heure_debut: formatHour(h),
      heure_fin: formatHour(h + 1),
      hour_index: h,
    });
  }
  return slots;
}

/**
 * Heure de fin exclusive de la nuit prolongée sur le lendemain.
 * - 00:00 historique → au moins jusqu'à 01:00 (créneau minuit culturel)
 * - 03:00 → jusqu'à 03:00 (créneaux 00–01, 01–02, 02–03)
 */
function nuitProlongeeEndExclusive(heureFin) {
  const raw = String(heureFin || '').trim().slice(0, 5);
  if (raw === '00:00' || raw === '0:00' || raw === '24:00') return 1;
  const h = parseHour(raw);
  if (h >= 0 && h < 5) return h;
  return 0;
}

/**
 * Plages d'ouverture pour une date calendaire, avec extension nuit prolongée.
 * Si lundi ferme à 03:00 → slots lundi 06→24 + mardi 00→03 labellisés « Nuit du Lundi ».
 */
function buildSlotsForOpenDay(dateStr, horaire) {
  if (!horaire || !Number(horaire.est_ouvert)) return [];

  const start = parseHour(horaire.heure_debut);
  const endExclusive = parseEndHour(horaire.heure_fin);
  const nuitClose = isFermetureNuitProlongee(horaire.heure_fin);
  const overnight = nuitClose || endExclusive < start;

  const result = [];
  const jourTarif = jourDepuisDate(dateStr);

  // Créneaux du jour calendaire (jusqu'à minuit si overnight / nuit)
  const sameDayEnd = overnight ? 24 : endExclusive;
  if (sameDayEnd > start) {
    for (let h = start; h < sameDayEnd && h < 24; h += 1) {
      const heure_debut = formatHour(h);
      const heure_fin = h + 1 >= 24 ? '00:00' : formatHour(h + 1);
      result.push({
        date: dateStr,
        heure_debut,
        heure_fin,
        label: labelHeureSenegal(dateStr, heure_debut),
        label_court: courtLabelHeureSenegal(dateStr, heure_debut),
        est_minuit_culturel: false,
        est_nuit_prolongee: false,
        jour_tarif: jourTarif,
      });
    }
  }

  // Extension nuit prolongée → jour calendaire suivant
  if (overnight) {
    const nextDate = addDaysYmd(dateStr, 1);
    const endNuit = nuitClose ? nuitProlongeeEndExclusive(horaire.heure_fin) : endExclusive;
    for (let h = 0; h < endNuit; h += 1) {
      const heure_debut = formatHour(h);
      const heure_fin = formatHour(h + 1);
      const perc = getJourPercuBackend(nextDate, heure_debut);
      result.push({
        date: nextDate,
        heure_debut,
        heure_fin,
        label: perc.labelComplet,
        label_court: perc.labelComplet,
        est_minuit_culturel: h === 0,
        est_nuit_prolongee: true,
        jour_tarif: jourTarif,
        date_affichage: dateStr,
      });
    }
  }

  return result;
}

/**
 * Bornes utiles pour grilles admin (min/max sur la semaine).
 * heure_max exclusive ; 24 autorisé pour minuit / nuit prolongée.
 */
function bornesHorairesSemaine(horairesRows = []) {
  let min = 8;
  let max = 22;
  let found = false;
  for (const h of horairesRows) {
    if (!Number(h.est_ouvert)) continue;
    const s = parseHour(h.heure_debut);
    const e = parseEndHour(h.heure_fin);
    const nuit = isFermetureNuitProlongee(h.heure_fin);
    if (!found) {
      min = s;
      max = nuit ? 24 : e;
      found = true;
    } else {
      min = Math.min(min, s);
      max = Math.max(max, nuit ? 24 : e === 24 ? 24 : e);
    }
  }
  if (!found) return { heure_min: 6, heure_max: 24 };
  if (max >= 24) {
    min = Math.min(min, 0);
    max = 24;
  }
  return { heure_min: Math.max(0, min), heure_max: Math.min(24, Math.max(max, min + 1)) };
}

function validerHeure(heure) {
  const regex = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  return regex.test(String(heure || '').trim());
}

function validateHorairePayload(h) {
  const debut = normalizeHourString(h.heure_debut);
  let fin = String(h.heure_fin || '').trim();
  if (fin === '24:00') fin = '00:00';
  fin = normalizeHourString(fin);
  const start = parseHour(debut);
  const endHour = parseHour(fin);
  const nuit = isFermetureNuitProlongee(fin);

  if (start < 0 || start > 23) {
    const err = new Error('Heure de début invalide (0–23h)');
    err.statusCode = 400;
    throw err;
  }
  if (!validerHeure(debut) || !validerHeure(fin)) {
    const err = new Error('Format d\'heure invalide (HH:MM)');
    err.statusCode = 400;
    throw err;
  }

  // Fermeture nuit prolongée (00h–04h59) = OK
  if (nuit) {
    return { ...h, heure_debut: debut, heure_fin: fin };
  }

  // Même jour : fin doit être après début
  if (endHour > start) {
    return { ...h, heure_debut: debut, heure_fin: fin };
  }

  // Fermeture entre 05h et heure_ouverture → invalide
  if (endHour >= 5 && endHour <= start) {
    const err = new Error('Heure de fermeture invalide');
    err.statusCode = 400;
    throw err;
  }

  return { ...h, heure_debut: debut, heure_fin: fin };
}

module.exports = {
  JOURS,
  JOURS_LABEL,
  HORAIRES_DEFAUT,
  parseHour,
  parseEndHour,
  formatHour,
  normalizeHourString,
  jourDepuisDate,
  addDaysYmd,
  veilleJour,
  labelHeureSenegal,
  courtLabelHeureSenegal,
  hourlySlots,
  buildSlotsForOpenDay,
  bornesHorairesSemaine,
  validateHorairePayload,
  validerHeure,
  isFermetureNuitProlongee,
  nuitProlongeeEndExclusive,
};
