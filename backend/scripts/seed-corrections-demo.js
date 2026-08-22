/**
 * Données de démo pour tester manuellement les 10 corrections gérant.
 * Idempotent : recrée uniquement les lignes TF-CORR-* / demo.corr.*
 *
 * Usage : node scripts/seed-corrections-demo.js
 *
 * Compte : mohamed.gerant@gmail.com / password123
 */
const bcrypt = require('bcryptjs');
const { getDb, queryOne, queryAll, runSql, saveDb } = require('../database');
const { serializeQrPayload } = require('../services/qrPayload');
const { calculerFenetreCheckIn } = require('../services/checkInFenetre');

const GERANT_EMAIL = 'mohamed.gerant@gmail.com';
const GERANT_PASSWORD = 'password123';
const PREFIX = 'TF-CORR-';

function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function hh(h) {
  return `${String(h).padStart(2, '0')}:00`;
}

function isoLocal(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function hoursAgo(hours) {
  const d = new Date();
  d.setHours(d.getHours() - hours);
  return isoLocal(d);
}

async function main() {
  const db = await getDb();
  const hash = bcrypt.hashSync(GERANT_PASSWORD, 10);

  let gerant = await queryOne(db, 'SELECT * FROM employes WHERE email = ?', [GERANT_EMAIL]);
  if (!gerant) {
    const terrain = await queryOne(
      db,
      'SELECT id, proprietaire_id FROM terrains WHERE COALESCE(is_active, 1) = 1 ORDER BY id LIMIT 1',
    );
    if (!terrain) {
      console.error('Aucun terrain — lance d’abord: node seed.js');
      process.exit(1);
    }
    await runSql(
      db,
      `INSERT INTO employes (proprietaire_id, terrain_id, nom, prenom, email, password_hash, telephone, whatsapp_number, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [terrain.proprietaire_id, terrain.id, 'Mohamed Coulibaly', 'Mohamed', GERANT_EMAIL, hash, '+221 77 826 12 25', '+221778261225'],
    );
    gerant = await queryOne(db, 'SELECT * FROM employes WHERE email = ?', [GERANT_EMAIL]);
  } else {
    await runSql(
      db,
      `UPDATE employes SET password_hash = ?, is_active = 1, prenom = COALESCE(prenom, 'Mohamed') WHERE id = ?`,
      [hash, gerant.id],
    );
  }

  await runSql(db, 'UPDATE employes SET password_hash = ?, is_active = 1 WHERE COALESCE(is_active, 1) = 1', [hash]);

  const old = await queryAll(db, `SELECT id FROM reservations WHERE code_reservation LIKE ?`, [`${PREFIX}%`]);
  const oldIds = old.map((r) => r.id);
  if (oldIds.length) {
    const ph = oldIds.map(() => '?').join(',');
    await runSql(db, `DELETE FROM paiements WHERE reservation_id IN (${ph})`, oldIds);
    await runSql(db, `DELETE FROM matchs WHERE reservation_id IN (${ph})`, oldIds);
    await runSql(db, `DELETE FROM reservations WHERE id IN (${ph})`, oldIds);
  }
  await runSql(db, `DELETE FROM users WHERE email LIKE 'demo.corr.%@joueur.terrainsn.local'`);
  await runSql(db, `DELETE FROM regles_tarifs WHERE nom LIKE 'CORR %'`);

  const players = [];
  for (const [prenom, nom, email, telephone] of [
    ['Abdou', 'Sow', 'abdou@email.com', '+221 77 123 45 67'],
    ['Fatou', 'Diallo', 'fatou@email.com', '+221 77 234 56 78'],
    ['Moussa', 'Ba', 'moussa@email.com', '+221 77 345 67 89'],
    ['Awa', 'Ndiaye', 'awa@email.com', '+221 77 456 78 90'],
    ['Ibrahima', 'Fall', 'ibrahima@email.com', '+221 77 567 89 01'],
  ]) {
    let u = await queryOne(db, 'SELECT * FROM users WHERE email = ?', [email]);
    if (!u) {
      await runSql(
        db,
        `INSERT INTO users (nom, prenom, email, telephone, role, is_active, telephone_verified)
         VALUES (?, ?, ?, ?, 'joueur', 1, 1)`,
        [`${prenom} ${nom}`, prenom, email, telephone],
      );
      u = await queryOne(db, 'SELECT * FROM users WHERE email = ?', [email]);
    } else {
      await runSql(db, 'UPDATE users SET prenom = ?, telephone = ? WHERE id = ?', [prenom, telephone, u.id]);
      u = { ...u, prenom, telephone };
    }
    players.push({ ...u, prenom, nom, telephone, display: `${prenom} ${nom}` });
  }

  await runSql(
    db,
    `INSERT INTO users (nom, prenom, email, telephone, role, is_active, telephone_verified)
     VALUES (?, ?, ?, ?, 'joueur', 1, 1)`,
    ['Kane', 'Aminata', 'demo.corr.nouveau@joueur.terrainsn.local', '+221 77 999 88 77'],
  );
  const nouveau = await queryOne(db, 'SELECT * FROM users WHERE email = ?', ['demo.corr.nouveau@joueur.terrainsn.local']);
  nouveau.prenom = 'Aminata';
  nouveau.nom = 'Kane';
  nouveau.display = 'Aminata Kane';

  const [abdou, fatou, moussa, awa, ibrahima] = players;

  const sites = await queryAll(
    db,
    `SELECT e.id AS gerant_id, e.email, e.nom AS gerant_nom, e.terrain_id, t.nom AS terrain_nom
     FROM employes e
     JOIN terrains t ON t.id = e.terrain_id
     WHERE COALESCE(e.is_active, 1) = 1 AND e.terrain_id IS NOT NULL
     GROUP BY e.terrain_id
     ORDER BY e.terrain_id`,
  );
  if (!sites.length) {
    console.error('Aucun gérant actif avec terrain');
    process.exit(1);
  }

  const now = new Date();
  const today = ymd(now);
  const yesterday = ymd(addDays(now, -1));
  const tomorrow = ymd(addDays(now, 1));
  const lastWeek = ymd(addDays(now, -7));
  const h = now.getHours();
  const enCoursStart = h;
  const imminentStart = Math.min(22, h + 1);
  const futureStart = h < 18 ? 18 : Math.min(21, h + 3);
  const pendingStart = 22;

  let terrainId;
  let currentGerantId;
  let seq = 100;
  const created = [];

  async function insertResa({
    player,
    date,
    start,
    end,
    statut,
    restant,
    avance = 1500,
    total = 5000,
    scanned = false,
    confirmeHoursAgo = 2,
    tag,
  }) {
    seq += 1;
    const code = `${PREFIX}${terrainId}-${seq}`;
    const startH = hh(start);
    const endH = hh(end === 24 ? 0 : end);
    const endAdj = end === 24 ? '00:00' : endH;
    await runSql(
      db,
      `INSERT INTO reservations (
        terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
        montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant,
        statut, code_reservation, cree_par, operational_stage, qr_code_scanne_at, confirme_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gerant', ?, ?, ?)`,
      [
        terrainId,
        player.id,
        player.display || `${player.prenom || ''} ${player.nom || player.display || ''}`.trim(),
        player.telephone,
        date,
        startH,
        endAdj,
        total,
        total,
        avance,
        avance,
        restant,
        restant,
        statut,
        code,
        scanned || statut === 'match_joue' ? 'match' : statut === 'en_attente' ? 'reserved' : 'reserved',
        scanned ? `${date} ${startH.slice(0, 2)}:08:00` : null,
        ['confirme', 'acceptee', 'match_joue', 'joue'].includes(statut) ? hoursAgo(confirmeHoursAgo) : null,
      ],
    );
    const resa = await queryOne(db, 'SELECT * FROM reservations WHERE code_reservation = ?', [code]);
    const fenetre = calculerFenetreCheckIn({
      date,
      heure_debut: startH,
      heure_fin: endAdj,
      fenetre_retard: 30,
    });
    const payload = serializeQrPayload({
      reservation_id: resa.id,
      code,
      creneau_id: resa.creneau_id,
      terrain_id: terrainId,
      expire_at: fenetre.finFenetre,
    });
    await runSql(db, 'UPDATE reservations SET qr_code_payload = ? WHERE id = ?', [payload, resa.id]);

    if (avance > 0 && statut !== 'annulee' && statut !== 'annule') {
      await runSql(
        db,
        `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe)
         VALUES (?, ?, 'wave', 'paye', ?)`,
        [resa.id, avance, `WAV-${code}`],
      );
    }
    if (statut === 'match_joue' || statut === 'joue') {
      await runSql(
        db,
        `INSERT INTO matchs (reservation_id, terrain_id, gerant_id, montant_total, acompte_paye, solde_paye, methode_solde)
         VALUES (?, ?, ?, ?, ?, ?, 'especes')`,
        [resa.id, terrainId, currentGerantId, total, avance, restant],
      );
    }
    created.push({
      terrain: terrainId,
      tag,
      code,
      statut,
      date,
      start: startH,
      scanned,
      restant,
      player: player.display || player.prenom,
    });
    return resa;
  }

  for (const site of sites) {
    terrainId = site.terrain_id;
    currentGerantId = site.gerant_id;
    seq = 100;
    await runSql(db, 'UPDATE terrains SET delai_remboursement_heures = 24 WHERE id = ?', [terrainId]);
    const soiree = await queryOne(
      db,
      `SELECT id FROM regles_tarifs WHERE terrain_id = ? AND (nom = 'CORR Soirée' OR nom LIKE 'Semaine — à partir de %')`,
      [terrainId],
    );
    if (!soiree) {
      await runSql(
        db,
        `INSERT INTO regles_tarifs
          (terrain_id, nom, prix_demi_terrain, prix_terrain_entier, type, jours, heure_debut, heure_fin, priorite, actif, source)
         VALUES (?, 'Semaine — à partir de 18h', 4000, 7000, 'semaine', 'lundi,mardi,mercredi,jeudi,vendredi', '18:00', '24:00', 5, 1, 'grille_standard')`,
        [terrainId],
      );
    } else {
      await runSql(
        db,
        `UPDATE regles_tarifs SET nom = 'Semaine — à partir de 18h', type = 'semaine', source = 'grille_standard'
          WHERE terrain_id = ? AND nom = 'CORR Soirée'`,
        [terrainId],
      );
    }

  await insertResa({
    tag: 'TERMINE scanné payé',
    player: abdou,
    date: today,
    start: Math.max(8, h - 4),
    end: Math.max(9, h - 3),
    statut: 'match_joue',
    restant: 0,
    scanned: true,
    confirmeHoursAgo: 30,
  });

  await insertResa({
    tag: 'EN COURS scanné + reste à encaisser',
    player: fatou,
    date: today,
    start: enCoursStart,
    end: enCoursStart + 1,
    statut: 'confirme',
    restant: 3500,
    scanned: true,
    confirmeHoursAgo: 3,
  });

  if (imminentStart !== enCoursStart) {
    await insertResa({
      tag: 'IMMINENT à scanner',
      player: moussa,
      date: today,
      start: imminentStart,
      end: imminentStart + 1,
      statut: 'confirme',
      restant: 4000,
      scanned: false,
      confirmeHoursAgo: 1,
    });
  }

  if (futureStart !== enCoursStart && futureStart !== imminentStart && futureStart < 22) {
    await insertResa({
      tag: 'CONFIRMÉ à venir',
      player: awa,
      date: today,
      start: futureStart,
      end: futureStart + 1,
      statut: 'confirme',
      restant: 4375,
      scanned: false,
      confirmeHoursAgo: 5,
    });
  }

  await insertResa({
    tag: 'EN ATTENTE A (même créneau)',
    player: ibrahima,
    date: today,
    start: pendingStart,
    end: pendingStart + 1,
    statut: 'en_attente',
    restant: 4375,
    avance: 625,
    scanned: false,
  });
  await insertResa({
    tag: 'EN ATTENTE B (même créneau)',
    player: nouveau,
    date: today,
    start: pendingStart,
    end: pendingStart + 1,
    statut: 'en_attente',
    restant: 4375,
    avance: 625,
    scanned: false,
  });

  await insertResa({
    tag: 'ANNULÉE',
    player: ibrahima,
    date: yesterday,
    start: 20,
    end: 21,
    statut: 'annulee',
    restant: 0,
    avance: 0,
    scanned: false,
  });

  await insertResa({
    tag: 'Fatou fréquent #2',
    player: fatou,
    date: lastWeek,
    start: 19,
    end: 20,
    statut: 'match_joue',
    restant: 0,
    scanned: true,
    confirmeHoursAgo: 80,
  });
  await insertResa({
    tag: 'Fatou fréquent #3',
    player: fatou,
    date: ymd(addDays(now, -3)),
    start: 18,
    end: 19,
    statut: 'match_joue',
    restant: 0,
    scanned: true,
    confirmeHoursAgo: 50,
  });
  await insertResa({
    tag: 'Nouveau ce mois',
    player: nouveau,
    date: tomorrow,
    start: 18,
    end: 19,
    statut: 'confirme',
    restant: 4000,
    scanned: false,
    confirmeHoursAgo: 2,
  });
  await insertResa({
    tag: 'Semaine — confirmé demain',
    player: abdou,
    date: tomorrow,
    start: 20,
    end: 21,
    statut: 'confirme',
    restant: 3500,
    scanned: false,
    confirmeHoursAgo: 4,
  });
  }

  saveDb();

  const comptes = await queryAll(
    db,
    `SELECT e.email, e.nom, t.nom AS terrain_nom, t.id AS terrain_id
     FROM employes e
     JOIN terrains t ON t.id = e.terrain_id
     WHERE COALESCE(e.is_active, 1) = 1
     ORDER BY t.id, e.id`,
  );

  console.log('\n=== Données corrections gérant (tous les terrains) ===');
  console.log(`URL : http://localhost:8080/backoffice/login`);
  console.log('Mot de passe : password123');
  console.log('\nComptes :');
  for (const c of comptes) {
    console.log(`  ${c.email}  →  ${c.terrain_nom} (#${c.terrain_id})`);
  }
  console.log('\nScénarios (par terrain) :');
  for (const row of created) {
    if (row.tag === 'TERMINE scanné payé' || row.tag === 'IMMINENT à scanner' || row.tag === 'EN COURS scanné + reste à encaisser') {
      console.log(
        `  T${row.terrain} [${row.code}] ${row.tag} — ${row.start} — ${row.player}`,
      );
    }
  }
  console.log('\nTéléphones : 77 123 45 67 (Abdou) · 77 234 56 78 (Fatou) · 77 999 88 77 (Aminata)');
  console.log('File du jour : Moussa à scanner · Fatou entrée validée + encaisser · 22h 2 en attente encore libre');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
