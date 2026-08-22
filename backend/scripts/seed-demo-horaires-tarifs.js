/**
 * Données démo Arena Mohamed Parcelles :
 * - horaires flexibles (06h → minuit jeudi/samedi)
 * - tarifs dynamiques (soirée / weekend / minuit)
 * - réservations dont « Jeudi minuit » (vendredi 00:00)
 *
 * Usage: node scripts/seed-demo-horaires-tarifs.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getDb, queryOne, queryAll, runSql, transaction, saveDb } = require('../database');
const { addDaysYmd, jourDepuisDate, labelHeureSenegal } = require('../scheduleService');

const TERRAIN_ID = 9;
const GERANT_ID = 6; // employe Mohamed (seed principal)
const JOUEUR_ID = 8;

function ymdLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nextWeekday(targetDow /* 0=dim .. 4=jeu .. */) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  const cur = d.getDay();
  let add = (targetDow - cur + 7) % 7;
  if (add === 0) add = 7; // prochain occurrence
  d.setDate(d.getDate() + add);
  return ymdLocal(d);
}

async function main() {
  const db = await getDb();
  const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [TERRAIN_ID]);
  if (!terrain) {
    console.error(`Terrain ${TERRAIN_ID} introuvable. Lance d'abord: node seed.js`);
    process.exit(1);
  }

  const baseEntier = Number(terrain.prix_entier || terrain.prix_heure || 5500);
  const baseMoitie = Number(terrain.prix_moitie || Math.round(baseEntier * 0.6));

  const jeudi = nextWeekday(4);
  const vendredi = addDaysYmd(jeudi, 1);
  const samedi = addDaysYmd(jeudi, 2);
  const today = ymdLocal();

  console.log(`Terrain: ${terrain.nom} (#${TERRAIN_ID})`);
  console.log(`Jeudi cible: ${jeudi} → minuit culturel = ${vendredi} 00:00 (${labelHeureSenegal(vendredi, '00:00')})`);

  await transaction(db, async () => {
    // 1) Horaires flexibles
    const plages = {
      lundi: ['06:00', '23:00'],
      mardi: ['06:00', '23:00'],
      mercredi: ['06:00', '23:00'],
      jeudi: ['06:00', '00:00'], // jusqu'à minuit + créneau Jeudi minuit
      vendredi: ['08:00', '23:00'],
      samedi: ['09:00', '00:00'],
      dimanche: ['09:00', '20:00'],
    };
    for (const [jour, [debut, fin]] of Object.entries(plages)) {
      const row = await queryOne(db, 'SELECT id FROM horaires WHERE terrain_id = ? AND jour = ?', [TERRAIN_ID, jour]);
      if (row) {
        await runSql(db, 
          'UPDATE horaires SET heure_debut = ?, heure_fin = ?, est_ouvert = 1 WHERE terrain_id = ? AND jour = ?',
          [debut, fin, TERRAIN_ID, jour],
        );
      } else {
        await runSql(db, 
          'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, 1)',
          [TERRAIN_ID, jour, debut, fin],
        );
      }
    }

    // 2) Tarifs dynamiques
    await runSql(db, 'DELETE FROM tarifs_dynamiques WHERE terrain_id = ?', [TERRAIN_ID]);

    const inserts = [];
    // Soirée semaine 18–22 : +30%
    for (const jour of ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi']) {
      for (let h = 18; h <= 21; h += 1) {
        inserts.push([
          TERRAIN_ID,
          jour,
          h,
          Math.round(baseEntier * 1.3),
          Math.round(baseMoitie * 1.3),
        ]);
      }
    }
    // Weekend journée : +20%
    for (const jour of ['samedi', 'dimanche']) {
      for (let h = 10; h <= 17; h += 1) {
        inserts.push([
          TERRAIN_ID,
          jour,
          h,
          Math.round(baseEntier * 1.2),
          Math.round(baseMoitie * 1.2),
        ]);
      }
    }
    // Weekend soirée : +40%
    for (const jour of ['samedi', 'dimanche']) {
      for (let h = 18; h <= 21; h += 1) {
        inserts.push([
          TERRAIN_ID,
          jour,
          h,
          Math.round(baseEntier * 1.4),
          Math.round(baseMoitie * 1.4),
        ]);
      }
    }
    // Minuit culturel (00:00) tarifé sur la veille : jeudi 0 & samedi 0
    inserts.push([TERRAIN_ID, 'jeudi', 0, Math.round(baseEntier * 1.5), Math.round(baseMoitie * 1.5)]);
    inserts.push([TERRAIN_ID, 'samedi', 0, Math.round(baseEntier * 1.5), Math.round(baseMoitie * 1.5)]);

    for (const row of inserts) {
      await runSql(db, 
        `INSERT INTO tarifs_dynamiques (terrain_id, jour, heure, prix_entier, prix_moitie)
         VALUES (?, ?, ?, ?, ?)`,
        row,
      );
    }

    // 3) Créneaux persistés jeudi + minuit
    for (let h = 18; h <= 23; h += 1) {
      const debut = `${String(h).padStart(2, '0')}:00`;
      const fin = h === 23 ? '00:00' : `${String(h + 1).padStart(2, '0')}:00`;
      const exists = await queryOne(
        db,
        'SELECT id FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?',
        [TERRAIN_ID, jeudi, debut, fin],
      );
      if (!exists) {
        await runSql(db, 
          'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)',
          [TERRAIN_ID, jeudi, debut, fin, 'libre'],
        );
      }
    }
    // Vendredi 00:00–01:00 = Jeudi minuit
    let midnight = await queryOne(
      db,
      'SELECT id FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?',
      [TERRAIN_ID, vendredi, '00:00', '01:00'],
    );
    if (!midnight) {
      await runSql(db, 
        'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)',
        [TERRAIN_ID, vendredi, '00:00', '01:00', 'libre'],
      );
      midnight = await queryOne(
        db,
        'SELECT id FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?',
        [TERRAIN_ID, vendredi, '00:00', '01:00'],
      );
    }

    // 4) Réservations démo
    const prixMinuit = Math.round(baseEntier * 1.5);
    const avanceMinuit = Math.round(prixMinuit * 0.125);
    const prixSoir = Math.round(baseEntier * 1.3);
    const avanceSoir = Math.round(prixSoir * 0.125);

    // Annuler anciennes démos seedées par ce script
    const oldDemo = await queryAll(
      db,
      `SELECT id, creneau_id FROM reservations
        WHERE terrain_id = ? AND code_reservation LIKE 'TF-DEMO-%'`,
      [TERRAIN_ID],
    );
    for (const r of oldDemo) {
      if (r.creneau_id) {
        await runSql(db, "UPDATE creneaux SET statut = 'libre' WHERE id = ?", [r.creneau_id]);
      }
      await runSql(db, "UPDATE reservations SET statut = 'annule' WHERE id = ?", [r.id]);
    }

    // Résa 1 : Jeudi minuit (calendaire vendredi 00:00)
    await runSql(db, 
      `INSERT INTO reservations
        (terrain_id, creneau_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
         montant, prix_total, acompte, reste_a_payer, montant_avance, montant_restant, format_terrain,
         statut, code_reservation, cree_par)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'entier', 'confirme', 'TF-DEMO-MINUIT', 'joueur')`,
      [
        TERRAIN_ID,
        midnight?.id || null,
        JOUEUR_ID,
        'Ibrahima Ndiaye',
        '+221771112233',
        vendredi,
        '00:00',
        '01:00',
        prixMinuit,
        prixMinuit,
        avanceMinuit,
        Math.max(0, prixMinuit - avanceMinuit),
        avanceMinuit,
        Math.max(0, prixMinuit - avanceMinuit),
      ],
    );
    if (midnight?.id) {
      await runSql(db, "UPDATE creneaux SET statut = 'reserve' WHERE id = ?", [midnight.id]);
    }

    // Résa 2 : jeudi 20:00–21:00 tarif soirée
    let slot20 = await queryOne(
      db,
      'SELECT id FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?',
      [TERRAIN_ID, jeudi, '20:00', '21:00'],
    );
    if (!slot20) {
      await runSql(db, 
        'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)',
        [TERRAIN_ID, jeudi, '20:00', '21:00', 'libre'],
      );
      slot20 = await queryOne(
        db,
        'SELECT id FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?',
        [TERRAIN_ID, jeudi, '20:00', '21:00'],
      );
    }
    await runSql(db, 
      `INSERT INTO reservations
        (terrain_id, creneau_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
         montant, prix_total, acompte, reste_a_payer, montant_avance, montant_restant, format_terrain,
         statut, code_reservation, cree_par)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'entier', 'confirme', 'TF-DEMO-SOIR', 'gerant')`,
      [
        TERRAIN_ID,
        slot20?.id || null,
        null,
        'Awa Diop',
        '+221774445566',
        jeudi,
        '20:00',
        '21:00',
        prixSoir,
        prixSoir,
        avanceSoir,
        Math.max(0, prixSoir - avanceSoir),
        avanceSoir,
        Math.max(0, prixSoir - avanceSoir),
      ],
    );
    if (slot20?.id) {
      await runSql(db, "UPDATE creneaux SET statut = 'reserve' WHERE id = ?", [slot20.id]);
    }

    // Résa 3 : samedi après-midi en_attente (verrou paiement)
    let slotSat = await queryOne(
      db,
      'SELECT id FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?',
      [TERRAIN_ID, samedi, '16:00', '17:00'],
    );
    if (!slotSat) {
      await runSql(db, 
        'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)',
        [TERRAIN_ID, samedi, '16:00', '17:00', 'en_attente_paiement'],
      );
      slotSat = await queryOne(
        db,
        'SELECT id FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?',
        [TERRAIN_ID, samedi, '16:00', '17:00'],
      );
    } else {
      await runSql(db, "UPDATE creneaux SET statut = 'en_attente_paiement' WHERE id = ?", [slotSat.id]);
    }
    const prixWeekend = Math.round(baseEntier * 1.2);
    const avanceWeekend = Math.round(prixWeekend * 0.125);
    const verrou = Date.now() + 2 * 60 * 60 * 1000;
    await runSql(db, 
      `INSERT INTO reservations
        (terrain_id, creneau_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
         montant, prix_total, acompte, reste_a_payer, montant_avance, montant_restant, format_terrain,
         statut, code_reservation, cree_par, verrou_expire_at, expire_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'moitie', 'en_attente', 'TF-DEMO-WEEK', 'joueur', ?, ?)`,
      [
        TERRAIN_ID,
        slotSat?.id || null,
        'Cheikh Fall',
        '+221777778888',
        samedi,
        '16:00',
        '17:00',
        prixWeekend,
        prixWeekend,
        avanceWeekend,
        Math.max(0, prixWeekend - avanceWeekend),
        avanceWeekend,
        Math.max(0, prixWeekend - avanceWeekend),
        verrou,
        new Date(verrou).toISOString(),
      ],
    );

    // Activité gérant (actions autorisées par CHECK)
    if (GERANT_ID) {
      await runSql(db, 
        `INSERT INTO activite_gerant (gerant_id, terrain_id, action, details)
         VALUES (?, ?, 'creneau_cree', ?)`,
        [
          GERANT_ID,
          TERRAIN_ID,
          JSON.stringify({
            source: 'seed-demo-horaires-tarifs',
            cellules_tarifs: inserts.length,
            jeudi,
            vendredi_minuit: vendredi,
            note: 'horaires flex + tarifs dynamiques + Jeudi minuit',
          }),
        ],
      );
    }
  });

  saveDb();

  const nTarifs = await queryOne(db, 'SELECT COUNT(*) AS n FROM tarifs_dynamiques WHERE terrain_id = ?', [TERRAIN_ID]);
  const demos = await queryAll(
    db,
    `SELECT code_reservation, date, heure_debut, heure_fin, statut, montant, format_terrain
     FROM reservations WHERE terrain_id = ? AND code_reservation LIKE 'TF-DEMO-%'
     ORDER BY date, heure_debut`,
    [TERRAIN_ID],
  );

  console.log(`\n✅ Horaires flexibles + ${nTarifs.n} tarifs dynamiques insérés`);
  console.log('✅ Réservations démo :');
  for (const r of demos) {
    const label =
      r.heure_debut === '00:00' ? labelHeureSenegal(r.date, r.heure_debut) : `${r.heure_debut}–${r.heure_fin}`;
    console.log(
      `   ${r.code_reservation}  ${r.date}  ${label}  ${r.statut}  ${r.montant} CFA (${r.format_terrain})`,
    );
  }
  console.log('\nComptes : mohamed.gerant@gmail.com / password123');
  console.log('UI Tarifs : /backoffice/gerant/tarifs');
  console.log(`UI joueur créneaux jeudi ${jeudi} → dernier slot « Jeudi minuit »`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
