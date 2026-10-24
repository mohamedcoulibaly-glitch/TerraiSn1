/**
 * Volume gérant Mohamed : contrat Wave=WhatsApp (778261225),
 * beaucoup de matchs AUJOURD'HUI + à venir, notifs + ledger paiement.
 *
 * Tous les joueurs démo ont TON numéro pour que les WhatsApp (mock ou réel)
 * arrivent chez toi — jamais de numéros inconnus.
 *
 * Usage : node scripts/seed-mohamed-gerant-flux.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getDb, queryOne, queryAll, runSql, saveDb, transaction } = require('../database');
const { enregistrerContrat } = require('../services/contratService');
const { confirmerPaiementEtNotifier } = require('../payments/flow');

const GERANT_EMAIL = 'mohamed.gerant@gmail.com';
const PHONE_STORE = '+221 77 826 12 25';
const PHONE_WA = '+221778261225';

const PLAYERS = [
  ['Amadou', 'Ba'],
  ['Fatou', 'Sarr'],
  ['Ibrahima', 'Ndiaye'],
  ['Awa', 'Diop'],
  ['Cheikh', 'Fall'],
  ['Khady', 'Gueye'],
  ['Moussa', 'Kane'],
  ['Mariama', 'Sow'],
  ['Ousmane', 'Sy'],
  ['Aissatou', 'Diallo'],
  ['Pape', 'Mbaye'],
  ['Ndeye', 'Thiam'],
  ['Abdoulaye', 'Cisse'],
  ['Bineta', 'Faye'],
  ['Modou', 'Diagne'],
];

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hh(h) {
  return `${String(h).padStart(2, '0')}:00`;
}

function ensurePlayer(db, prenom, nom, suffix) {
  const email = `flux.mohamed.${suffix}@joueur.terrainsn.local`;
  const fullName = `${prenom} ${nom}`;
  const existing = queryOne(db, 'SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    runSql(
      db,
      `UPDATE users SET nom = ?, prenom = ?, telephone = ?, role = 'joueur', is_active = 1, telephone_verified = 1, is_banned = 0
       WHERE id = ?`,
      [fullName, prenom, PHONE_STORE, existing.id],
    );
    return { id: existing.id, fullName, prenom, telephone: PHONE_STORE };
  }
  const id = Number(runSql(
    db,
    `INSERT INTO users (nom, prenom, email, telephone, role, is_active, telephone_verified, quartier)
     VALUES (?, ?, ?, ?, 'joueur', 1, 1, 'Parcelles Assainies')`,
    [fullName, prenom, email, PHONE_STORE],
  ).lastInsertRowid);
  return { id, fullName, prenom, telephone: PHONE_STORE };
}

function nettoyerFlux(db, terrainId) {
  const rows = queryAll(
    db,
    `SELECT id FROM reservations WHERE terrain_id = ? AND (code_reservation LIKE 'TF-FLUX-%' OR code_reservation LIKE 'TF-DEMO-%')`,
    [terrainId],
  );
  for (const row of rows) {
    runSql(db, 'DELETE FROM paiements WHERE reservation_id = ?', [row.id]);
    runSql(db, 'DELETE FROM dus WHERE reservation_id = ?', [row.id]);
    runSql(db, 'DELETE FROM payouts WHERE reservation_id = ?', [row.id]);
    runSql(db, 'DELETE FROM matchs WHERE reservation_id = ?', [row.id]);
    runSql(db, 'DELETE FROM reservations WHERE id = ?', [row.id]);
  }
}

function slotFin(hStart) {
  if (hStart >= 23) return '00:00';
  return hh(hStart + 1);
}

function upsertCreneau(db, terrainId, date, hStart, statut = 'en_attente_paiement') {
  const debut = hh(hStart);
  const fin = slotFin(hStart);
  const existing = queryOne(
    db,
    'SELECT id FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ?',
    [terrainId, date, debut],
  );
  if (existing) {
    runSql(db, 'UPDATE creneaux SET statut = ?, heure_fin = ? WHERE id = ?', [statut, fin, existing.id]);
    return existing.id;
  }
  return Number(runSql(
    db,
    `INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)`,
    [terrainId, date, debut, fin, statut],
  ).lastInsertRowid);
}

function creerEnAttente(db, { terrainId, player, date, hStart, prix, code, stage = 'reserved' }) {
  const debut = hh(hStart);
  const fin = slotFin(hStart);
  const creneauId = upsertCreneau(db, terrainId, date, hStart, 'en_attente_paiement');
  const avance = Math.round(prix * 0.125);
  const restant = prix - avance;
  return Number(runSql(
    db,
    `INSERT INTO reservations (
      terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
      montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant,
      statut, creneau_id, cree_par, code_reservation, operational_stage
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?, 'joueur', ?, ?)`,
    [
      terrainId, player.id, player.fullName, PHONE_STORE, date, debut, fin,
      prix, prix, avance, avance, restant, restant, creneauId, code, stage,
    ],
  ).lastInsertRowid);
}

async function main() {
  const db = await getDb();
  const gerant = queryOne(db, 'SELECT * FROM employes WHERE email = ?', [GERANT_EMAIL]);
  if (!gerant?.terrain_id) {
    console.error('Gérant Mohamed introuvable. Lance d’abord : node scripts/ensure-mohamed-accounts.js');
    process.exit(1);
  }
  const terrainId = gerant.terrain_id;
  const gerantId = gerant.id;

  runSql(
    db,
    `UPDATE employes SET telephone = ?, whatsapp_number = ?, is_active = 1 WHERE id = ?`,
    [PHONE_STORE, PHONE_WA, gerantId],
  );
  runSql(db, `UPDATE terrains SET telephone = ?, is_active = 1 WHERE id = ?`, [PHONE_STORE, terrainId]);

  transaction(db, () => {
    enregistrerContrat(db, terrainId, {
      gerant_id: gerantId,
      numeros_identiques_whatsapp: 1,
      payout_mode: 'retrait',
      remboursement_autorise: 0,
      pourcentage_avance: 12.5,
      commission_pourcentage: 10,
      canal_reversement: 'wave',
    }, { auteurId: gerantId });
  });
  transaction(db, () => {
    enregistrerContrat(db, terrainId, {
      wave_statut: 'verifie',
      om_statut: 'verifie',
      numeros_identiques_whatsapp: 1,
    }, { auteurId: gerantId });
  });

  const contrat = queryOne(db, 'SELECT wave_numero, om_numero, wave_statut, payout_mode, telephone FROM terrains WHERE id = ?', [terrainId]);

  nettoyerFlux(db, terrainId);

  const players = PLAYERS.map(([prenom, nom], i) => ensurePlayer(db, prenom, nom, String(i).padStart(2, '0')));
  const mohamedJoueur = queryOne(db, "SELECT id, nom FROM users WHERE email = 'mohamed.joueur@gmail.com'");
  if (mohamedJoueur) {
    players.unshift({
      id: mohamedJoueur.id,
      fullName: mohamedJoueur.nom || 'Mohamed Coulibaly',
      prenom: 'Mohamed',
      telephone: PHONE_STORE,
    });
  }

  const now = new Date();
  const today = ymd(now);
  const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const dayAfter = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
  const hour = now.getHours();
  const prix = 40000;

  const slotsToday = [];
  for (let h = 10; h <= 23; h += 1) slotsToday.push(h);

  let seq = 200;
  const confirmedIds = [];
  const pendingIds = [];

  for (let i = 0; i < slotsToday.length; i += 1) {
    const hStart = slotsToday[i];
    const player = players[i % players.length];
    const code = `TF-FLUX-${today.replace(/-/g, '')}-${String(hStart).padStart(2, '0')}`;
    const upcoming = hStart > hour;
    const current = hStart === hour;
    const past = hStart < hour;
    let stage = 'reserved';
    if (past && hStart <= hour - 2) stage = 'closed';
    else if (past) stage = 'checkout';
    else if (current) stage = 'match';
    else stage = 'checkin';

    const id = creerEnAttente(db, { terrainId, player, date: today, hStart, prix, code, stage });
    if (hStart === 23) {
      pendingIds.push(id);
      continue;
    }
    confirmedIds.push(id);
  }

  for (const hStart of [18, 19, 20, 21]) {
    const player = players[(hStart + 3) % players.length];
    const code = `TF-FLUX-${tomorrow.replace(/-/g, '')}-${String(hStart).padStart(2, '0')}`;
    confirmedIds.push(creerEnAttente(db, { terrainId, player, date: tomorrow, hStart, prix, code, stage: 'reserved' }));
  }
  for (const hStart of [18, 20]) {
    const player = players[hStart % players.length];
    const code = `TF-FLUX-${dayAfter.replace(/-/g, '')}-${String(hStart).padStart(2, '0')}-PAY`;
    pendingIds.push(creerEnAttente(db, { terrainId, player, date: dayAfter, hStart, prix, code, stage: 'reserved' }));
  }

  let notifOk = 0;
  for (const id of confirmedIds) {
    const result = await confirmerPaiementEtNotifier(id, `TF-${id}-${Date.now()}-FLUX`);
    if (result.action === 'confirm' || result.action === 'already_confirmed') notifOk += 1;
  }

  const pastIds = queryAll(
    db,
    `SELECT id, heure_debut FROM reservations WHERE terrain_id = ? AND date = ? AND statut = 'confirme'`,
    [terrainId, today],
  );
  for (const row of pastIds) {
    const h = Number(String(row.heure_debut).slice(0, 2));
    if (h < hour - 1) {
      const resa = queryOne(db, 'SELECT reste_a_payer, montant_restant FROM reservations WHERE id = ?', [row.id]);
      const reste = Math.max(0, Number(resa?.reste_a_payer ?? resa?.montant_restant ?? 0));
      runSql(
        db,
        `UPDATE reservations SET statut = 'match_joue', operational_stage = 'closed',
          reste_a_payer = 0, montant_restant = 0,
          checked_in_at = ?, qr_code_scanne_at = ?, checkout_at = ?
         WHERE id = ?`,
        [`${today} ${hh(h)}:05`, `${today} ${hh(h)}:08`, `${today} ${hh(h + 1)}:02`, row.id],
      );
      // Encaissement reste sur place (espèces) — le CA lit prix_total des match_joue
      if (reste > 0) {
        const deja = queryOne(
          db,
          `SELECT id FROM paiements WHERE reservation_id = ? AND reference_externe = ?`,
          [row.id, `SOLDE-${row.id}`],
        );
        if (!deja) {
          runSql(
            db,
            `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe)
             VALUES (?, ?, 'especes', 'paye', ?)`,
            [row.id, reste, `SOLDE-${row.id}`],
          );
        }
      }
    }
  }

  // Historique 5 jours passés : matchs joués + encaissés (KPI CA semaine/mois)
  for (let d = 1; d <= 5; d += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
    const dayStr = ymd(day);
    for (const hStart of d % 2 === 0 ? [17, 20] : [18, 21]) {
      const player = players[(d + hStart) % players.length];
      const code = `TF-FLUX-${dayStr.replace(/-/g, '')}-${String(hStart).padStart(2, '0')}-J`;
      const id = creerEnAttente(db, {
        terrainId, player, date: dayStr, hStart, prix, code, stage: 'closed',
      });
      await confirmerPaiementEtNotifier(id, `TF-${id}-${Date.now()}-HIST`);
      const resa = queryOne(db, 'SELECT reste_a_payer, montant_restant FROM reservations WHERE id = ?', [id]);
      const reste = Math.max(0, Number(resa?.reste_a_payer ?? resa?.montant_restant ?? 0));
      runSql(
        db,
        `UPDATE reservations SET statut = 'match_joue', operational_stage = 'closed',
          reste_a_payer = 0, montant_restant = 0,
          checked_in_at = ?, qr_code_scanne_at = ?, checkout_at = ?
         WHERE id = ?`,
        [`${dayStr} ${hh(hStart)}:05`, `${dayStr} ${hh(hStart)}:08`, `${dayStr} ${hh(hStart + 1)}:02`, id],
      );
      if (reste > 0) {
        runSql(
          db,
          `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe)
           VALUES (?, ?, 'especes', 'paye', ?)`,
          [id, reste, `SOLDE-${id}`],
        );
      }
    }
  }

  saveDb();

  const todayN = queryOne(db, `SELECT COUNT(*) AS n FROM reservations WHERE terrain_id = ? AND date = ?`, [terrainId, today]);
  const upcomingN = queryOne(
    db,
    `SELECT COUNT(*) AS n FROM reservations WHERE terrain_id = ? AND date >= ? AND statut IN ('confirme','en_attente') AND heure_debut >= ?`,
    [terrainId, today, hh(hour)],
  );
  const dus = queryOne(db, `SELECT COUNT(*) AS n, COALESCE(SUM(du_gerant),0) AS solde FROM dus WHERE terrain_id = ? AND statut IN ('payable','en_fenetre')`, [terrainId]);
  const ca = queryOne(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(prix_total, montant, 0)), 0) AS ca
     FROM reservations WHERE terrain_id = ? AND statut IN ('match_joue', 'joue')
       AND date >= date('now', '-31 days')`,
    [terrainId],
  );
  const soldes = queryOne(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(montant), 0) AS total
     FROM paiements WHERE reference_externe LIKE 'SOLDE-%'
       AND reservation_id IN (SELECT id FROM reservations WHERE terrain_id = ?)`,
    [terrainId],
  );

  console.log('\n=== Flux gérant Mohamed ===');
  console.log(`Terrain #${terrainId}  Wave=${contrat.wave_numero} (${contrat.wave_statut})  mode=${contrat.payout_mode}`);
  console.log(`WhatsApp gérant / joueurs démo : ${PHONE_STORE}`);
  console.log(`Aujourd'hui ${today} : ${todayN.n} réservations`);
  console.log(`À venir (ce soir + suite) : ${upcomingN.n}`);
  console.log(`Confirmées + notifs envoyées (mock si WHATSAPP_MOCK=true) : ${notifOk}`);
  console.log(`En attente de paiement (checkout simulation) : ${pendingIds.length} ids ${pendingIds.join(',')}`);
  console.log(`Dûs payables : ${dus.n} lignes / ${dus.solde} FCFA`);
  console.log(`CA matchs joués (31j) : ${ca.n} matchs → ${Number(ca.ca).toLocaleString('fr-FR')} FCFA`);
  console.log(`Encaissements terrain (SOLDE) : ${soldes.n} → ${Number(soldes.total).toLocaleString('fr-FR')} FCFA`);
  console.log(`Login gérant : ${GERANT_EMAIL} / password123`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
