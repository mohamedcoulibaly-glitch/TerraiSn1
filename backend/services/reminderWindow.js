/**
 * Fenêtre de rappel match (~1h avant) — logique pure testable.
 */

function parseReservationDateTime(dateStr, timeStr) {
  const date = String(dateStr || '').slice(0, 10);
  const time = String(timeStr || '00:00').slice(0, 5);
  return new Date(`${date}T${time}:00`);
}

/**
 * @param {Date} startAt début du match
 * @param {Date} [now]
 * @param {{ startOffsetMin?: number, endOffsetMin?: number }} [opts]
 */
function isInReminderWindow(startAt, now = new Date(), opts = {}) {
  const startOffsetMin = Number(opts.startOffsetMin ?? 45);
  const endOffsetMin = Number(opts.endOffsetMin ?? 75);
  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) return false;
  const t = now instanceof Date ? now : new Date(now);
  const windowStart = new Date(t.getTime() + startOffsetMin * 60 * 1000);
  const windowEnd = new Date(t.getTime() + endOffsetMin * 60 * 1000);
  return startAt >= windowStart && startAt <= windowEnd;
}

function buildRappelWhatsAppMessage({ prenom, terrain_nom, date, heure_debut, code_reservation }) {
  const name = String(prenom || '').trim();
  const code = code_reservation ? `\nCode : *${code_reservation}*` : '';
  return (
    `Rappel${name ? ` ${name}` : ''} — *${terrain_nom}*\n` +
    `${date} ${String(heure_debut || '').slice(0, 5)}${code}\n` +
    `Présente ton QR à l'entrée.`
  );
}

module.exports = {
  parseReservationDateTime,
  isInReminderWindow,
  buildRappelWhatsAppMessage,
};
