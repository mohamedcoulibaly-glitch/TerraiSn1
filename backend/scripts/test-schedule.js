/**
 * Tests unitaires — scheduleService (créneaux, jeudi minuit, overnight).
 * Usage: node scripts/test-schedule.js
 */
const { createHarness } = require('../test/helpers/harness');
const {
  parseHour,
  parseEndHour,
  formatHour,
  normalizeHourString,
  jourDepuisDate,
  veilleJour,
  addDaysYmd,
  labelHeureSenegal,
  courtLabelHeureSenegal,
  hourlySlots,
  buildSlotsForOpenDay,
  bornesHorairesSemaine,
  validateHorairePayload,
} = require('../scheduleService');

const h = createHarness('unit-schedule');

function main() {
  h.assertEqual('parseHour 18:00', parseHour('18:00'), 18);
  h.assertEqual('parseHour 24:00 → 24', parseHour('24:00'), 24);
  h.assertEqual('parseEndHour 00:00 → 24', parseEndHour('00:00'), 24);
  h.assertEqual('formatHour 0', formatHour(0), '00:00');
  h.assertEqual('formatHour 24 → 00:00', formatHour(24), '00:00');
  h.assertEqual('normalizeHourString 9:00', normalizeHourString('9:00'), '09:00');

  // 2026-09-14 = lundi ; 2026-09-18 = vendredi
  h.assertEqual('jourDepuisDate lundi', jourDepuisDate('2026-09-14'), 'lundi');
  h.assertEqual('jourDepuisDate vendredi', jourDepuisDate('2026-09-18'), 'vendredi');
  h.assertEqual('veilleJour vendredi → jeudi', veilleJour('vendredi'), 'jeudi');
  h.assertEqual('addDaysYmd +1', addDaysYmd('2026-09-17', 1), '2026-09-18');

  h.assertEqual(
    'label vendredi 00:00 = Jeudi minuit',
    labelHeureSenegal('2026-09-18', '00:00'),
    'Jeudi minuit',
  );
  h.assertEqual('label 18:00 normal', labelHeureSenegal('2026-09-14', '18:00'), '18:00');
  h.assertEqual('courtLabel minuit', courtLabelHeureSenegal('2026-09-18', '00:00'), 'Minuit');

  const slots2h = hourlySlots('18:00', '20:00');
  h.assertEqual('hourlySlots 2h length', slots2h.length, 2);
  h.assertEqual('hourlySlots first debut', slots2h[0].heure_debut, '18:00');
  h.assertEqual('hourlySlots last fin', slots2h[1].heure_fin, '20:00');

  const untilMidnight = hourlySlots('22:00', '00:00');
  h.assertEqual('slots jusqu\'à minuit length', untilMidnight.length, 2);
  h.assertEqual('dernier slot fin 00:00', untilMidnight[1].heure_fin, '00:00');

  const empty = hourlySlots('18:00', '18:00');
  h.assertEqual('même heure → vide', empty.length, 0);

  const overnight = hourlySlots('22:00', '06:00');
  h.assertEqual('overnight wrap length', overnight.length, 8); // 22,23 + 0..5
  h.assertEqual('overnight start', overnight[0].heure_debut, '22:00');
  h.assertEqual('overnight end', overnight[overnight.length - 1].heure_fin, '06:00');

  // Jeudi ouvert jusqu'à minuit → slot culturel vendredi 00:00
  const slotsJeudi = buildSlotsForOpenDay('2026-09-17', {
    est_ouvert: 1,
    heure_debut: '16:00',
    heure_fin: '00:00',
  });
  const minuitCulturel = slotsJeudi.find((s) => s.est_minuit_culturel);
  h.assert('extension minuit culturel présente', Boolean(minuitCulturel));
  h.assertEqual('date calendaire vendredi', minuitCulturel.date, '2026-09-18');
  h.assertEqual('jour_tarif = jeudi', minuitCulturel.jour_tarif, 'jeudi');
  h.assertEqual('label Jeudi minuit', minuitCulturel.label, 'Jeudi minuit');

  const ferme = buildSlotsForOpenDay('2026-09-14', { est_ouvert: 0, heure_debut: '08:00', heure_fin: '22:00' });
  h.assertEqual('jour fermé → 0 slots', ferme.length, 0);

  const bornes = bornesHorairesSemaine([
    { est_ouvert: 1, heure_debut: '08:00', heure_fin: '22:00' },
    { est_ouvert: 1, heure_debut: '10:00', heure_fin: '00:00' },
  ]);
  h.assertEqual('borne min avec minuit', bornes.heure_min, 0);
  h.assertEqual('borne max 24', bornes.heure_max, 24);

  const valid = validateHorairePayload({ jour: 'lundi', heure_debut: '8:00', heure_fin: '22:00', est_ouvert: 1 });
  h.assertEqual('validate normalise debut', valid.heure_debut, '08:00');

  h.assertThrows(
    'validate même heure interdit',
    () => validateHorairePayload({ heure_debut: '10:00', heure_fin: '10:00' }),
    'Heure de fin',
  );

  const untilMid = validateHorairePayload({ heure_debut: '10:00', heure_fin: '00:00' });
  h.assertEqual('00:00 fin autorisée', untilMid.heure_fin, '00:00');

  h.exitIfFailed();
}

main();
