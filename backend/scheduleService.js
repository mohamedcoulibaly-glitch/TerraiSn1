/**
 * Utilitaires créneaux + calendrier culturel sénégalais.
 * Règle métier : vendredi 00:00 (calendaire) se programme / s'affiche comme « Jeudi minuit ».
 */

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
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10) || 0));
  const min = Math.min(59, Math.max(0, parseInt(m[2] || '0', 10) || 0));
  // Compat tarifs / grilles horaires : si minutes absentes → :00
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Interprète heure_fin "00:00" comme fin de journée (24h exclusive). */
function parseEndHour(time) {
  const raw = String(time || '').trim();
  if (!raw || raw === '00:00' || raw === '0:00' || raw === '24:00' || raw === '24') return 24;
  return parseHour(raw);
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
 * Label affiché : vendredi 00:00 → « Jeudi minuit ».
 */
function labelHeureSenegal(dateStr, heureDebut) {
  const h = parseHour(heureDebut);
  if (h === 0 || h === 24) {
    const veille = veilleJour(jourDepuisDate(dateStr));
    return `${JOURS_LABEL[veille] || 'Veille'} minuit`;
  }
  return formatHour(h);
}

function courtLabelHeureSenegal(dateStr, heureDebut) {
  const h = parseHour(heureDebut);
  if (h === 0 || h === 24) return 'Minuit';
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
  // Same-day or until midnight
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
  // Overnight wrap: e.g. 22:00 → 06:00
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
 * Plages d'ouverture pour une date calendaire, avec extension « minuit culturel ».
 * Si jeudi ferme à 00:00 → inclut vendredi 00:00–01:00 labellisé « Jeudi minuit ».
 */
function buildSlotsForOpenDay(dateStr, horaire) {
  if (!horaire || !Number(horaire.est_ouvert)) return [];

  const start = parseHour(horaire.heure_debut);
  const endExclusive = parseEndHour(horaire.heure_fin);
  const isUntilMidnight = String(horaire.heure_fin || '').startsWith('00') || endExclusive === 24;

  const result = [];
  const sameDayEnd = endExclusive === 24 ? 24 : endExclusive;

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
        jour_tarif: jourDepuisDate(dateStr),
      });
    }
  } else if (sameDayEnd < start) {
    // Overnight stored on opening day until 24 then early morning on same calendar booking day is unusual;
    // for wrap we only emit until 24 on this date; morning slots belong to next calendar day generation.
    for (let h = start; h < 24; h += 1) {
      const heure_debut = formatHour(h);
      const heure_fin = h + 1 >= 24 ? '00:00' : formatHour(h + 1);
      result.push({
        date: dateStr,
        heure_debut,
        heure_fin,
        label: labelHeureSenegal(dateStr, heure_debut),
        label_court: courtLabelHeureSenegal(dateStr, heure_debut),
        est_minuit_culturel: false,
        jour_tarif: jourDepuisDate(dateStr),
      });
    }
  }

  // Extension culturelle : nuit → jour calendaire suivant à 00:00
  if (isUntilMidnight) {
    const nextDate = addDaysYmd(dateStr, 1);
    result.push({
      date: nextDate,
      heure_debut: '00:00',
      heure_fin: '01:00',
      label: labelHeureSenegal(nextDate, '00:00'),
      label_court: 'Minuit',
      est_minuit_culturel: true,
      jour_tarif: jourDepuisDate(dateStr), // tarif de la veille (jeudi)
      date_affichage: dateStr,
    });
  }

  return result;
}

/**
 * Bornes utiles pour grilles admin (min/max sur la semaine).
 * heure_max exclusive ; 24 autorisé pour minuit.
 */
function bornesHorairesSemaine(horairesRows = []) {
  let min = 8;
  let max = 22;
  let found = false;
  for (const h of horairesRows) {
    if (!Number(h.est_ouvert)) continue;
    const s = parseHour(h.heure_debut);
    const e = parseEndHour(h.heure_fin);
    if (!found) {
      min = s;
      max = e;
      found = true;
    } else {
      min = Math.min(min, s);
      max = Math.max(max, e === 24 ? 24 : e);
    }
  }
  if (!found) return { heure_min: 6, heure_max: 24 };
  // Inclure éventuellement 0 pour afficher minuit culturel dans tarifs
  if (max >= 24) {
    min = Math.min(min, 0);
    max = 24;
  }
  return { heure_min: Math.max(0, min), heure_max: Math.min(24, Math.max(max, min + 1)) };
}

function validateHorairePayload(h) {
  const debut = normalizeHourString(h.heure_debut);
  let fin = String(h.heure_fin || '').trim();
  if (fin === '24:00') fin = '00:00';
  fin = normalizeHourString(fin);
  const start = parseHour(debut);
  const end = parseEndHour(fin);
  if (start < 0 || start > 23) {
    const err = new Error('Heure de début invalide (0–23h)');
    err.statusCode = 400;
    throw err;
  }
  // fin 00:00 = jusqu'à minuit OK ; sinon fin doit différer
  if (end !== 24 && end === start) {
    const err = new Error('Heure de fin doit être après le début (00:00 = jusqu\'à minuit)');
    err.statusCode = 400;
    throw err;
  }
  return { ...h, heure_debut: debut, heure_fin: fin === '00:00' || end === 24 ? '00:00' : fin };
}

module.exports = {
  JOURS,
  JOURS_LABEL,
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
};
