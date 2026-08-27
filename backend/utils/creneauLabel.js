/**
 * Labels créneaux — calendrier culturel sénégalais (nuit prolongée).
 * Miroir JS de frontend/src/utils/creneauLabel.ts pour notificationService / push.
 */

const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

function estNuitProlongee(heure) {
  const h = parseInt(String(heure || '').substring(0, 2), 10);
  return Number.isFinite(h) && h >= 0 && h < 5;
}

function addDaysLocal(dateStr, days) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Duplique getJourPercu() pour le backend (WhatsApp / push).
 */
function getJourPercuBackend(date, heure) {
  const h = parseInt(String(heure || '').substring(0, 2), 10);
  const dateObj = new Date(`${String(date).slice(0, 10)}T12:00:00`);
  const jourTechnique = JOURS[dateObj.getDay()] || 'Lundi';

  if (Number.isFinite(h) && h >= 0 && h < 5) {
    const datePercue = new Date(dateObj);
    datePercue.setDate(datePercue.getDate() - 1);
    const jourPrecedent = JOURS[datePercue.getDay()] || 'Dimanche';
    const y = datePercue.getFullYear();
    const m = String(datePercue.getMonth() + 1).padStart(2, '0');
    const day = String(datePercue.getDate()).padStart(2, '0');
    return {
      labelComplet: `Nuit du ${jourPrecedent}`,
      labelJour: jourPrecedent,
      labelPeriode: 'nuit prolongée',
      estNuitProlongee: true,
      datePercue: `${y}-${m}-${day}`,
      jourPrecedent,
    };
  }

  let labelPeriode;
  if (h >= 5 && h < 12) labelPeriode = 'matin';
  else if (h >= 12 && h < 17) labelPeriode = 'après-midi';
  else if (h >= 17 && h < 21) labelPeriode = 'soir';
  else labelPeriode = 'nuit';

  const labelComplet = h >= 21 ? `${jourTechnique} nuit` : `${jourTechnique} ${labelPeriode}`;

  return {
    labelComplet,
    labelJour: jourTechnique,
    labelPeriode,
    estNuitProlongee: false,
    datePercue: String(date).slice(0, 10),
    jourPrecedent: '',
  };
}

function getDatesATechniques(datePercue) {
  const base = String(datePercue).slice(0, 10);
  return [base, addDaysLocal(base, 1)];
}

function trierCreneaux(creneaux) {
  return [...(creneaux || [])].sort((a, b) => {
    const hA = parseInt(String(a.heure_debut || '').substring(0, 2), 10);
    const hB = parseInt(String(b.heure_debut || '').substring(0, 2), 10);
    const ordreA = hA < 5 ? hA + 24 : hA;
    const ordreB = hB < 5 ? hB + 24 : hB;
    return ordreA - ordreB;
  });
}

module.exports = {
  JOURS,
  estNuitProlongee,
  getJourPercuBackend,
  getDatesATechniques,
  trierCreneaux,
  addDaysLocal,
};
