require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { getDb, queryAll, runSql, saveDb } = require('../database');
const { estDansLaFenetreCheckIn, calculerFenetreCheckIn } = require('../services/checkInFenetre');
const { serializeQrPayload } = require('../services/qrPayload');

(async () => {
  const db = await getDb();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const startH = now.getHours();
  const endH = Math.min(23, startH + 2);
  const heure_debut = `${String(startH).padStart(2, '0')}:00`;
  const heure_fin = `${String(endH).padStart(2, '0')}:00`;

  const rows = queryAll(
    db,
    `SELECT r.id, r.statut, r.code_reservation, r.date, r.heure_debut, r.heure_fin, r.qr_code_scanne_at, r.creneau_id, r.terrain_id,
            COALESCE(c.fenetre_retard, 30) AS fenetre_retard
     FROM reservations r
     LEFT JOIN creneaux c ON c.id = r.creneau_id
     WHERE r.statut = 'confirme'
     ORDER BY r.id DESC LIMIT 20`
  );

  console.log('NOW', now.toString());
  console.log('Confirmed reservations:');
  for (const r of rows) {
    const f = calculerFenetreCheckIn(r);
    console.log({
      id: r.id,
      code: r.code_reservation,
      date: r.date,
      slot: `${r.heure_debut}-${r.heure_fin}`,
      dans_fenetre: estDansLaFenetreCheckIn(r),
      fenetre: `${new Date(f.debutFenetre).toLocaleString('fr-FR')} -> ${new Date(f.finFenetre).toLocaleString('fr-FR')}`,
    });
  }

  // Remettre TF-MOH-NOW dans la fenêtre actuelle pour la démo
  const target = rows.find((r) => r.code_reservation === 'TF-MOH-NOW') || rows[0];
  if (!target) {
    console.log('Aucune réservation confirmee');
    process.exit(1);
  }

  const fenetre = calculerFenetreCheckIn({
    date: today,
    heure_debut,
    heure_fin,
    fenetre_retard: 30,
  });
  const payload = serializeQrPayload({
    reservation_id: target.id,
    code: target.code_reservation || `TF-${target.id}`,
    creneau_id: target.creneau_id,
    terrain_id: target.terrain_id,
    expire_at: Math.floor(fenetre.finFenetre / 1000),
  });

  runSql(
    db,
    `UPDATE reservations
     SET date = ?, heure_debut = ?, heure_fin = ?, qr_code_scanne_at = NULL, statut = 'confirme', qr_code_payload = ?
     WHERE id = ?`,
    [today, heure_debut, heure_fin, payload, target.id]
  );
  if (target.creneau_id) {
    runSql(
      db,
      `UPDATE creneaux SET date = ?, heure_debut = ?, heure_fin = ?, statut = 'reserve', fenetre_retard = COALESCE(fenetre_retard, 30) WHERE id = ?`,
      [today, heure_debut, heure_fin, target.creneau_id]
    );
  }
  saveDb(db);

  console.log('\nUPDATED for demo scan:', {
    id: target.id,
    code: target.code_reservation,
    date: today,
    heure_debut,
    heure_fin,
    dans_fenetre: true,
  });
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
