/**
 * Simule une journée de travail pour Babacar Sene (file d'attente gérant).
 * Idempotent : nettoie les TF-BAB-* du jour avant de réinsérer.
 *
 * Usage : node scripts/seed-babacar-journee.js
 * Login  : babacar.sene@gmail.com / password123
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getDb, queryOne, queryAll, runSql, saveDb } = require('../database');
const { serializeQrPayload } = require('../services/qrPayload');
const { calculerFenetreCheckIn } = require('../services/checkInFenetre');
const { getOrCreateRangeCreneau } = require('../reservationLockService');

const EMAIL = 'babacar.sene@gmail.com';
const PREFIX = 'TF-BAB-';

function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hhmm(h, m = 0) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addHours(baseH, n) {
  return (baseH + n + 24) % 24;
}

async function ensurePlayer(db, prenom, nom, telephone) {
  const email = `demo.bab.${telephone.replace(/\D/g, '').slice(-9)}@joueur.terrainsn.local`;
  let u = await queryOne(db, 'SELECT * FROM users WHERE email = ? OR telephone = ?', [email, telephone]);
  if (!u) {
    await runSql(
      db,
      `INSERT INTO users (nom, prenom, email, telephone, role, is_active, telephone_verified)
       VALUES (?, ?, ?, ?, 'joueur', 1, 1)`,
      [nom, prenom, email, telephone],
    );
    u = await queryOne(db, 'SELECT * FROM users WHERE email = ?', [email]);
  }
  return {
    ...u,
    display: `${prenom} ${nom}`,
    telephone,
  };
}

async function main() {
  const db = await getDb();
  const gerant = await queryOne(
    db,
    `SELECT e.*, t.nom AS terrain_nom
     FROM employes e
     LEFT JOIN terrains t ON t.id = e.terrain_id
     WHERE e.email = ?`,
    [EMAIL],
  );
  if (!gerant || !gerant.terrain_id) {
    console.error('Babacar Sene introuvable — lance: node scripts/ensure-babacar-gerant.js');
    process.exit(1);
  }

  const terrainId = gerant.terrain_id;
  const now = new Date();
  const today = ymd(now);
  const h = now.getHours();
  const m = now.getMinutes();

  // Créneaux relatifs à l'heure actuelle pour peupler tous les blocs UI
  // En cours = créneau de l'heure courante (ex. 14h–15h si il est 14h30)
  const enCoursDebut = h;
  const enCoursFin = Math.min(24, h + 1);
  // Imminent = créneau suivant (dans < 60 min)
  const imminentDebut = Math.min(23, h + 1);
  const imminentFin = Math.min(24, imminentDebut + 1);
  const futur1Debut = Math.min(21, h + 2);
  const futur2Debut = Math.min(19, h + 3);
  const futur2Fin = Math.min(24, futur2Debut + 2); // 2h
  const termineDebut = Math.max(6, h - 3);
  const termineFin = Math.max(termineDebut + 1, h - 2);
  const attenteDebut = Math.min(22, Math.max(futur2Fin, h + 5));

  console.log(`Gérant: ${gerant.prenom || ''} ${gerant.nom} (#${gerant.id})`);
  console.log(`Terrain: ${gerant.terrain_nom} (#${terrainId})`);
  console.log(`Jour: ${today} — maintenant ~${hhmm(h, m)}`);

  // Nettoyage idempotent
  const old = await queryAll(
    db,
    `SELECT id, creneau_id FROM reservations WHERE terrain_id = ? AND code_reservation LIKE ?`,
    [terrainId, `${PREFIX}%`],
  );
  if (old.length) {
    const ids = old.map((r) => r.id);
    const ph = ids.map(() => '?').join(',');
    await runSql(db, `DELETE FROM paiements WHERE reservation_id IN (${ph})`, ids);
    await runSql(db, `DELETE FROM matchs WHERE reservation_id IN (${ph})`, ids);
    await runSql(db, `DELETE FROM reservations WHERE id IN (${ph})`, ids);
  }
  await runSql(
    db,
    `DELETE FROM blocages_creneaux WHERE terrain_id = ? AND date = ?`,
    [terrainId, today],
  );

  // Ouvrir largement le terrain aujourd'hui
  const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const jour = jours[now.getDay()];
  const horaire = await queryOne(db, 'SELECT id FROM horaires WHERE terrain_id = ? AND jour = ?', [
    terrainId,
    jour,
  ]);
  if (horaire) {
    await runSql(
      db,
      'UPDATE horaires SET heure_debut = ?, heure_fin = ?, est_ouvert = 1 WHERE id = ?',
      ['06:00', '00:00', horaire.id],
    );
  } else {
    await runSql(
      db,
      'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, 1)',
      [terrainId, jour, '06:00', '00:00'],
    );
  }

  const players = [
    await ensurePlayer(db, 'Abdou', 'Sow', '+221 77 111 01 01'),
    await ensurePlayer(db, 'Fatou', 'Diallo', '+221 77 111 02 02'),
    await ensurePlayer(db, 'Moussa', 'Ba', '+221 77 111 03 03'),
    await ensurePlayer(db, 'Awa', 'Ndiaye', '+221 77 111 04 04'),
    await ensurePlayer(db, 'Ibrahima', 'Fall', '+221 77 111 05 05'),
    await ensurePlayer(db, 'Aminata', 'Kane', '+221 77 111 06 06'),
  ];

  let seq = 0;
  const created = [];

  async function insertResa({
    player,
    startH,
    endH,
    statut,
    restant,
    avance = 2000,
    total = 8000,
    scanned = false,
    tag,
  }) {
    seq += 1;
    const code = `${PREFIX}${String(seq).padStart(3, '0')}`;
    const debut = hhmm(startH);
    const fin = endH >= 24 ? '00:00' : hhmm(endH);

    const creneau = await getOrCreateRangeCreneau(db, terrainId, today, debut, fin);
    const creneauStatut =
      statut === 'en_attente' ? 'en_attente_paiement' : statut === 'confirme' || statut === 'match_joue' ? 'reserve' : 'libre';
    await runSql(db, 'UPDATE creneaux SET statut = ?, fenetre_retard = 30 WHERE id = ?', [
      creneauStatut,
      creneau.id,
    ]);

    await runSql(
      db,
      `INSERT INTO reservations (
        terrain_id, creneau_id, joueur_id, joueur_nom, joueur_telephone,
        date, heure_debut, heure_fin,
        montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant,
        statut, code_reservation, cree_par, operational_stage, qr_code_scanne_at, confirme_at, mode_paiement
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gerant', ?, ?, ?, 'en_ligne')`,
      [
        terrainId,
        creneau.id,
        player.id,
        player.display,
        player.telephone,
        today,
        debut,
        fin,
        total,
        total,
        avance,
        avance,
        restant,
        restant,
        statut,
        code,
        scanned || statut === 'match_joue' ? 'match' : 'reserved',
        scanned
          ? `${today} ${hhmm(startH, 5)}:00`
          : null,
        ['confirme', 'match_joue'].includes(statut) ? new Date(Date.now() - 2 * 3600_000).toISOString() : null,
      ],
    );

    const resa = await queryOne(db, 'SELECT * FROM reservations WHERE code_reservation = ?', [code]);
    const fenetre = calculerFenetreCheckIn({
      date: today,
      heure_debut: debut,
      heure_fin: fin,
      fenetre_retard: 30,
    });
    const payload = serializeQrPayload({
      reservation_id: resa.id,
      code,
      creneau_id: creneau.id,
      terrain_id: terrainId,
      expire_at: fenetre.finFenetre,
    });
    await runSql(db, 'UPDATE reservations SET qr_code_payload = ? WHERE id = ?', [payload, resa.id]);

    if (avance > 0 && statut !== 'annule') {
      await runSql(
        db,
        `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe)
         VALUES (?, ?, 'wave', 'paye', ?)`,
        [resa.id, avance, `WAV-${code}`],
      );
    }
    if (statut === 'match_joue') {
      await runSql(
        db,
        `INSERT INTO matchs (reservation_id, terrain_id, gerant_id, montant_total, acompte_paye, solde_paye, methode_solde)
         VALUES (?, ?, ?, ?, ?, ?, 'especes')`,
        [resa.id, terrainId, gerant.id, total, avance, Math.max(0, total - avance)],
      );
      await runSql(db, `UPDATE creneaux SET statut = 'joue' WHERE id = ?`, [creneau.id]);
    }

    created.push({ tag, code, statut, debut, fin, player: player.display, restant, scanned });
    return resa;
  }

  // 1) Match TERMINÉ (ce matin)
  if (termineDebut < termineFin && termineFin <= h) {
    await insertResa({
      player: players[0],
      startH: termineDebut,
      endH: termineFin,
      statut: 'match_joue',
      restant: 0,
      scanned: true,
      tag: 'termine',
    });
  } else {
    await insertResa({
      player: players[0],
      startH: Math.max(6, h - 4),
      endH: Math.max(7, h - 3),
      statut: 'match_joue',
      restant: 0,
      scanned: true,
      tag: 'termine',
    });
  }

  // 2) Match EN COURS (scanné, reste à encaisser) — plage de l'heure actuelle
  await insertResa({
    player: players[1],
    startH: enCoursDebut,
    endH: enCoursFin === enCoursDebut ? enCoursDebut + 1 : enCoursFin,
    statut: 'confirme',
    restant: 6000,
    total: 8000,
    avance: 2000,
    scanned: true,
    tag: 'en_cours_scanne',
  });

  // 3) IMMINENT non scanné (à scanner) — heure suivante
  await insertResa({
    player: players[2],
    startH: imminentDebut,
    endH: imminentFin === imminentDebut ? imminentDebut + 1 : imminentFin,
    statut: 'confirme',
    restant: 5500,
    total: 7500,
    avance: 2000,
    scanned: false,
    tag: 'imminent',
  });

  // 4) RÉSERVÉ bientôt (reste 0)
  await insertResa({
    player: players[3],
    startH: futur1Debut,
    endH: Math.min(24, futur1Debut + 1),
    statut: 'confirme',
    restant: 0,
    total: 7000,
    avance: 7000,
    scanned: false,
    tag: 'reserve_proche',
  });

  // 5) RÉSERVÉ plus tard (2h)
  await insertResa({
    player: players[4],
    startH: futur2Debut,
    endH: Math.min(24, Math.max(futur2Debut + 2, futur2Fin)),
    statut: 'confirme',
    restant: 10000,
    total: 14000,
    avance: 4000,
    scanned: false,
    tag: 'reserve_2h',
  });

  // 6) EN ATTENTE de paiement
  await insertResa({
    player: players[5],
    startH: attenteDebut,
    endH: Math.min(24, attenteDebut + 1),
    statut: 'en_attente',
    restant: 8000,
    total: 8000,
    avance: 0,
    scanned: false,
    tag: 'en_attente',
  });

  // 7) Blocage maintenance (créneau hors occupations)
  const bloqH = Math.max(8, Math.min(11, h - 5));
  const bloqDebut = hhmm(bloqH);
  const bloqFin = hhmm(bloqH + 1);
  await runSql(
    db,
    `INSERT INTO blocages_creneaux (terrain_id, employe_id, date, heure_debut, heure_fin, motif, type_blocage, libelle)
     VALUES (?, ?, ?, ?, ?, 'DEMO BAB maintenance', 'MANUEL', 'Arrosage pelouse')`,
    [terrainId, gerant.id, today, bloqDebut, bloqFin],
  );

  // Créneaux libres « atomes » pour la grille (quelques heures hors occupations)
  for (const hour of [9, 10, 11, 15, 17]) {
    if (hour === h || hour === enCoursDebut || hour === imminentDebut) continue;
    const debut = hhmm(hour);
    const fin = hhmm(hour + 1);
    const exists = await queryOne(
      db,
      'SELECT id FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?',
      [terrainId, today, debut, fin],
    );
    if (!exists) {
      await runSql(
        db,
        `INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut, fenetre_retard)
         VALUES (?, ?, ?, ?, 'libre', 30)`,
        [terrainId, today, debut, fin],
      );
    } else {
      // Ne pas écraser un créneau déjà réservé par ce seed
      const busy = created.some((c) => c.debut === debut);
      if (!busy) {
        await runSql(db, `UPDATE creneaux SET statut = 'libre' WHERE id = ? AND statut NOT IN ('reserve','joue')`, [
          exists.id,
        ]);
      }
    }
  }

  saveDb();

  console.log('\n=== Journée Babacar insérée ===');
  for (const c of created) {
    console.log(
      `  [${c.tag}] ${c.debut}-${c.fin}  ${c.player}  ${c.statut}${c.scanned ? ' (scanné)' : ''}  reste=${c.restant}  ${c.code}`,
    );
  }
  console.log(`  [blocage] ${bloqDebut}-${bloqFin}  maintenance`);
  console.log('\nLogin: babacar.sene@gmail.com / password123');
  console.log('Ouvre le dashboard gérant → File d’attente du jour');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
