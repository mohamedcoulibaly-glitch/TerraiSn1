const { getDb, queryAll } = require('../database');

(async () => {
  const db = await getDb();
  const rows = await queryAll(
    db,
    "SELECT id, date, heure_debut, heure_fin, length(heure_debut) AS len FROM blocages_creneaux WHERE date = '2026-08-16'",
  );
  console.log('blocages', rows);
  const c = await queryAll(
    db,
    "SELECT id, heure_debut, heure_fin, statut FROM creneaux WHERE date = '2026-08-16' AND heure_debut LIKE '10%'",
  );
  console.log('creneaux 10h', c);

  const slot = '10:00';
  rows.forEach((b) => {
    console.log('cmp', {
      slot,
      debut: b.heure_debut,
      fin: b.heure_fin,
      ge: slot >= String(b.heure_debut).slice(0, 5),
      lt: slot < String(b.heure_fin).slice(0, 5),
      dateEq: b.date === '2026-08-16',
    });
  });
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
