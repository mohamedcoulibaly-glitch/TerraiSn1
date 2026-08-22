/**
 * Volume démo Kanban + CRM pour mohamed.gerant@gmail.com
 * Numéros factices uniquement (+221 00 000 00 xx).
 *
 * Usage: node scripts/seed-gerant-demo-volume.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { getDb, queryOne, queryAll, runSql, saveDb } = require('../database');

const GERANT_EMAIL = 'mohamed.gerant@gmail.com';

const PLAYERS = [
  ['Amadou', 'Ba', '00'],
  ['Fatou', 'Sarr', '01'],
  ['Ibrahima', 'Ndiaye', '02'],
  ['Awa', 'Diop', '03'],
  ['Cheikh', 'Fall', '04'],
  ['Khady', 'Gueye', '05'],
  ['Moussa', 'Kane', '06'],
  ['Mariama', 'Sow', '07'],
  ['Ousmane', 'Sy', '08'],
  ['Aissatou', 'Diallo', '09'],
  ['Pape', 'Mbaye', '10'],
  ['Ndeye', 'Thiam', '11'],
  ['Abdoulaye', 'Cisse', '12'],
  ['Bineta', 'Faye', '13'],
  ['Modou', 'Diagne', '14'],
  ['Astou', 'Niang', '15'],
  ['Lamine', 'Sene', '16'],
  ['Rama', 'Wade', '17'],
  ['Babacar', 'Toure', '18'],
  ['Sokhna', 'Ly', '19'],
  ['Mamadou', 'Camara', '20'],
  ['Adama', 'Barry', '21'],
  ['Youssou', 'Diatta', '22'],
  ['Coumba', 'Ndoye', '23'],
  ['Aliou', 'Keita', '24'],
];

function ymd(d) {
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

function fakePhone(suffix) {
  return `+2210000000${suffix}`;
}

(async () => {
  const db = await getDb();
  const gerant = await queryOne(db, 'SELECT id, terrain_id, nom FROM employes WHERE email = ?', [GERANT_EMAIL]);
  if (!gerant?.terrain_id) {
    console.error('Gérant introuvable:', GERANT_EMAIL);
    process.exit(1);
  }
  const terrainId = gerant.terrain_id;
  const gerantId = gerant.id;
  console.log(`Terrain #${terrainId} · gérant #${gerantId} ${gerant.nom}`);

  const demoUsers = await queryAll(db, "SELECT id FROM users WHERE email LIKE 'demo.flux.%@joueur.terrainsn.local'");
  const demoIds = demoUsers.map((u) => u.id);
  if (demoIds.length) {
    const placeholders = demoIds.map(() => '?').join(',');
    await runSql(db, `DELETE FROM paiements WHERE reservation_id IN (SELECT id FROM reservations WHERE joueur_id IN (${placeholders}) OR code_reservation LIKE 'TF-DEMO-%')`, demoIds);
    await runSql(db, `DELETE FROM matchs WHERE reservation_id IN (SELECT id FROM reservations WHERE terrain_id = ? AND (code_reservation LIKE 'TF-DEMO-%' OR joueur_id IN (${placeholders})))`, [terrainId, ...demoIds]);
    await runSql(db, `DELETE FROM reservations WHERE terrain_id = ? AND (code_reservation LIKE 'TF-DEMO-%' OR joueur_id IN (${placeholders}))`, [terrainId, ...demoIds]);
    await runSql(db, `DELETE FROM users WHERE id IN (${placeholders})`, demoIds);
  } else {
    await runSql(db, "DELETE FROM paiements WHERE reservation_id IN (SELECT id FROM reservations WHERE code_reservation LIKE 'TF-DEMO-%')");
    await runSql(db, "DELETE FROM matchs WHERE reservation_id IN (SELECT id FROM reservations WHERE code_reservation LIKE 'TF-DEMO-%')");
    await runSql(db, "DELETE FROM reservations WHERE code_reservation LIKE 'TF-DEMO-%'");
  }

  const playerIds = [];
  for (const [prenom, nom, suffix] of PLAYERS) {
    const email = `demo.flux.${suffix}@joueur.terrainsn.local`;
    const telephone = fakePhone(suffix);
    const fullName = `${prenom} ${nom}`;
    await runSql(
      db,
      `INSERT INTO users (nom, prenom, email, telephone, role, is_active, telephone_verified, quartier)
       VALUES (?, ?, ?, ?, 'joueur', 1, 0, 'Parcelles Assainies')`,
      [fullName, prenom, email, telephone],
    );
    const row = await queryOne(db, 'SELECT id FROM users WHERE email = ?', [email]);
    playerIds.push({ id: row.id, prenom, nom, fullName, telephone, suffix });
  }

  const banned = [playerIds[22], playerIds[23]];
  for (const p of banned) {
    await runSql(db, `UPDATE users SET is_banned = 1, banned_at = CURRENT_TIMESTAMP, banned_reason = 'Démo — comportement' WHERE id = ?`, [p.id]);
  }
  await runSql(db, `UPDATE users SET notes_internes = 'Client régulier du vendredi soir.' WHERE id = ?`, [playerIds[0].id]);
  await runSql(db, `UPDATE users SET notes_internes = 'Toujours en retard de 10 min.' WHERE id = ?`, [playerIds[4].id]);

  const now = new Date();
  const today = ymd(now);
  let codeSeq = 100;

  async function insertResa({
    player,
    date,
    hStart,
    hEnd,
    statut,
    stage,
    restant = 6000,
    avance = 5000,
    total = 11000,
    walkIn = false,
    checkedIn = false,
    checkout = false,
    scanned = false,
  }) {
    codeSeq += 1;
    const code = `TF-DEMO-${codeSeq}`;
    const joueurId = walkIn ? null : player.id;
    const nom = walkIn ? 'Walk-in démo' : player.fullName;
    const tel = walkIn ? '+221000000099' : player.telephone;
    await runSql(
      db,
      `INSERT INTO reservations (
        terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
        montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant,
        statut, code_reservation, traite_par, cree_par, operational_stage, checked_in_at, checkout_at, qr_code_scanne_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'joueur', ?, ?, ?, ?)`,
      [
        terrainId,
        joueurId,
        nom,
        tel,
        date,
        hh(hStart),
        hh(hEnd),
        total,
        total,
        avance,
        avance,
        restant,
        restant,
        statut,
        code,
        gerantId,
        stage,
        checkedIn ? `${date} ${hh(Math.max(0, hStart - 1))}:12` : null,
        checkout ? `${date} ${hh(hEnd)}:05` : null,
        scanned ? `${date} ${hh(hStart)}:08` : null,
      ],
    );
    const resa = await queryOne(db, 'SELECT id FROM reservations WHERE code_reservation = ?', [code]);
    if (avance > 0) {
      await runSql(
        db,
        `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe, montant_acompte)
         VALUES (?, ?, 'wave', 'paye', ?, ?)`,
        [resa.id, avance, `WAV-${code}`, avance],
      );
    }
    return resa.id;
  }

  // --- Aujourd'hui : remplir les 4 colonnes Kanban ---
  const hour = now.getHours();
  await insertResa({ player: playerIds[0], date: today, hStart: Math.max(0, hour - 3), hEnd: Math.max(1, hour - 2), statut: 'match_joue', stage: 'closed', restant: 0, checkedIn: true, checkout: true, scanned: true });
  await insertResa({ player: playerIds[1], date: today, hStart: Math.max(0, hour - 2), hEnd: Math.max(1, hour - 1), statut: 'confirme', stage: 'checkout', restant: 6000, checkedIn: true, scanned: true });
  await insertResa({ player: playerIds[2], date: today, hStart: hour, hEnd: Math.min(23, hour + 1), statut: 'confirme', stage: 'match', restant: 6000, checkedIn: true });
  await insertResa({ player: playerIds[3], date: today, hStart: hour, hEnd: Math.min(23, hour + 1), statut: 'confirme', stage: 'checkin', restant: 0 });
  await insertResa({ player: playerIds[4], date: today, hStart: Math.min(22, hour + 1), hEnd: Math.min(23, hour + 2), statut: 'confirme', stage: 'checkin', restant: 8000 });
  await insertResa({ player: playerIds[5], date: today, hStart: Math.min(21, hour + 2), hEnd: Math.min(23, hour + 3), statut: 'confirme', stage: 'reserved' });
  await insertResa({ player: playerIds[6], date: today, hStart: 16, hEnd: 17, statut: 'confirme', stage: 'reserved' });
  await insertResa({ player: playerIds[7], date: today, hStart: 17, hEnd: 18, statut: 'confirme', stage: 'reserved', restant: 9000 });
  await insertResa({ player: playerIds[8], date: today, hStart: 18, hEnd: 19, statut: 'confirme', stage: 'reserved' });
  await insertResa({ player: playerIds[9], date: today, hStart: 19, hEnd: 20, statut: 'confirme', stage: 'reserved' });
  await insertResa({ player: playerIds[10], date: today, hStart: 20, hEnd: 21, statut: 'confirme', stage: 'reserved' });
  await insertResa({ player: playerIds[11], date: today, hStart: 21, hEnd: 22, statut: 'confirme', stage: 'reserved', restant: 0 });
  await insertResa({ player: null, date: today, hStart: 15, hEnd: 16, statut: 'confirme', stage: 'reserved', walkIn: true });
  await insertResa({ player: null, date: today, hStart: 22, hEnd: 23, statut: 'confirme', stage: 'reserved', walkIn: true, restant: 11000, avance: 0 });
  await insertResa({ player: banned[0], date: today, hStart: 14, hEnd: 15, statut: 'confirme', stage: 'reserved', restant: 6000 });
  await insertResa({ player: playerIds[12], date: today, hStart: Math.max(0, hour - 1), hEnd: hour, statut: 'confirme', stage: 'checkout', restant: 4500, checkedIn: true });
  await insertResa({ player: playerIds[13], date: today, hStart: 10, hEnd: 11, statut: 'match_joue', stage: 'closed', restant: 0, checkedIn: true, checkout: true, scanned: true });
  await insertResa({ player: playerIds[14], date: today, hStart: 11, hEnd: 12, statut: 'confirme', stage: 'match', restant: 6000, checkedIn: true });

  // --- Historique CRM (30-90 jours) ---
  let hist = 0;
  for (let i = 0; i < playerIds.length; i++) {
    const p = playerIds[i];
    const nMatches = 3 + (i % 5);
    for (let m = 0; m < nMatches; m++) {
      const d = ymd(addDays(now, -(4 + i * 2 + m * 3)));
      const startH = 16 + (m % 5);
      const played = m !== 0 || i % 7 !== 0;
      await insertResa({
        player: p,
        date: d,
        hStart: startH,
        hEnd: startH + 1,
        statut: played ? 'match_joue' : 'confirme',
        stage: played ? 'closed' : 'reserved',
        restant: played ? 0 : 7000,
        checkedIn: played,
        checkout: played,
        scanned: played,
      });
      hist += 1;
    }
  }

  saveDb(db);
  const todayCount = await queryOne(db, `SELECT COUNT(*) AS n FROM reservations WHERE terrain_id = ? AND date = ? AND statut IN ('confirme','match_joue','joue')`, [terrainId, today]);
  const crmCount = await queryOne(db, `SELECT COUNT(DISTINCT joueur_id) AS n FROM reservations WHERE terrain_id = ? AND joueur_id IS NOT NULL`, [terrainId]);
  console.log(`OK · ${playerIds.length} joueurs démo · ${todayCount.n} cartes du jour · ${crmCount.n} fiches CRM · ${hist} matchs historiques`);
  console.log('Téléphones factices : +221000000000 … +221000000024');
  console.log('Compte : mohamed.gerant@gmail.com → Flux du jour + Joueurs');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
