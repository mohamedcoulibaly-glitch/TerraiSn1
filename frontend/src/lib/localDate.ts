export function localYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Lundi → dimanche de la semaine contenant `from` (YYYY-MM-DD). */
export function weekDates(from = localYmd()) {
  const d = new Date(`${from}T12:00:00`);
  const mondayOffset = (d.getDay() + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday);
    x.setDate(monday.getDate() + i);
    return localYmd(x);
  });
}

/** Fenêtre glissante : `from` + les 6 jours suivants (= 7 jours), y compris le week-end. */
export function next7Days(from = localYmd()) {
  const d = new Date(`${from}T12:00:00`);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    return localYmd(x);
  });
}

export function addDaysYmd(ymd: string, delta: number) {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return localYmd(d);
}

export function formatJourCourt(ymd: string) {
  const d = new Date(`${ymd}T12:00:00`);
  const jours = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  return { label: jours[d.getDay()] || "", day: d.getDate() };
}
