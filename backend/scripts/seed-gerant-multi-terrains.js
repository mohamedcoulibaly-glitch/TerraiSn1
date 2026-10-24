/**
 * Seed complet — gérant multi-terrains (3 terrains en parallèle).
 *
 * Crée / met à jour :
 *  - propriétaire démo
 *  - un site (complexe) partagé par les 3 terrains (site_id)
 *  - gérant principal rattaché aux 3 terrains (gerants_terrains)
 *  - 2e gérant collègue sur le terrain principal (planning multi-gérants)
 *  - horaires, créneaux, résas du jour + à venir, ledger `dus`, planning de garde
 *
 * Usage :
 *   node scripts/seed-gerant-multi-terrains.js
 *   npm run seed:multi-gerant --prefix backend
 *
 * Login pro : http://localhost:5174/login
 *   Email    : multi.gerant@terrainsn.sn
 *   Password : password123
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const bcrypt = require('bcryptjs');
const { getDb, queryOne, queryAll, runSql, saveDb, transaction } = require('../database');
const { enregistrerContrat, chargerContrat } = require('../services/contratService');
const { creerDuApresPayin } = require('../services/ledgerService');
const { ensureSite, assignerTerrainAuSite } = require('../services/siteService');

const SITE_NOM = 'Complexe Multi Démo';

const DEMO_PASSWORD = 'password123';
const PROPRIO_EMAIL = 'multi.proprio@terrainsn.sn';
const GERANT_EMAIL = 'multi.gerant@terrainsn.sn';
const COLLEGUE_EMAIL = 'multi.collegue@terrainsn.sn';
const PHONE_GERANT = '+221 77 900 00 01';
const PHONE_GERANT_WA = '+221779000001';
const PHONE_COLLEGUE = '+221 77 900 00 02';
const PHONE_COLLEGUE_WA = '+221779000002';
const CODE_PREFIX = 'MULTI-';

const TERRAINS_SPEC = [
  {
    nom: 'Arena Yoff Multi',
    adresse: 'Yoff Tonghor',
    ville: 'Dakar',
    type: '7v7',
    prix: 25000,
    lat: 14.7590,
    lng: -17.4760,
    principal: true,
    note: 'Terrain principal — sélecteur header',
  },
  {
    nom: 'Complexe Parcelles Multi',
    adresse: 'Parcelles Assainies Unité 15',
    ville: 'Dakar',
    type: '11v11',
    prix: 40000,
    lat: 14.7640,
    lng: -17.4370,
    principal: false,
    note: 'Deuxième terrain du complexe',
  },
  {
    nom: 'Terrain Ouakam Multi',
    adresse: 'Ouakam Cité Avion',
    ville: 'Dakar',
    type: '5v5',
    prix: 18000,
    lat: 14.7208,
    lng: -17.4902,
    principal: false,
    note: 'Troisième site — matchs imminents',
  },
];

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
];

function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

function hh(h) {
  return `${String(h).padStart(2, '0')}:00`;
}

function slotFin(hStart) {
  return hStart >= 23 ? '00:00' : hh(hStart + 1);
}

function upsertProprio(db, hash) {
  const existing = queryOne(db, 'SELECT id FROM proprietaires WHERE email = ?', [PROPRIO_EMAIL]);
  if (existing) {
    runSql(
      db,
      `UPDATE proprietaires SET nom = ?, prenom = ?, password_hash = ?, telephone = ?, statut = 'actif'
       WHERE id = ?`,
      ['Multi Proprio', 'Ibra', hash, PHONE_GERANT, existing.id],
    );
    return existing.id;
  }
  return Number(runSql(
    db,
    `INSERT INTO proprietaires (nom, prenom, email, password_hash, telephone, plan, statut)
     VALUES (?, ?, ?, ?, ?, 'premium', 'actif')`,
    ['Multi Proprio', 'Ibra', PROPRIO_EMAIL, hash, PHONE_GERANT],
  ).lastInsertRowid);
}

function upsertGerant(db, {
  email, prenom, nom, telephone, whatsapp, hash, terrainId, proprioId,
}) {
  const existing = queryOne(db, 'SELECT id FROM employes WHERE email = ?', [email]);
  if (existing) {
    runSql(
      db,
      `UPDATE employes SET nom = ?, prenom = ?, password_hash = ?, telephone = ?, whatsapp_number = ?,
        is_active = 1, terrain_id = ?, proprietaire_id = ?, must_change_password = 0
       WHERE id = ?`,
      [nom, prenom, hash, telephone, whatsapp, terrainId, proprioId, existing.id],
    );
    return existing.id;
  }
  return Number(runSql(
    db,
    `INSERT INTO employes (proprietaire_id, terrain_id, nom, prenom, email, password_hash, telephone, whatsapp_number, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [proprioId, terrainId, nom, prenom, email, hash, telephone, whatsapp],
  ).lastInsertRowid);
}

function assurerHoraires(db, terrainId) {
  const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  for (const jour of jours) {
    const row = queryOne(db, 'SELECT id FROM horaires WHERE terrain_id = ? AND jour = ?', [terrainId, jour]);
    if (row) {
      runSql(db, 'UPDATE horaires SET heure_debut = ?, heure_fin = ?, est_ouvert = 1 WHERE id = ?', ['08:00', '23:00', row.id]);
    } else {
      runSql(
        db,
        'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, 1)',
        [terrainId, jour, '08:00', '23:00'],
      );
    }
  }
}

function upsertTerrain(db, proprioId, spec) {
  const existing = queryOne(db, 'SELECT id FROM terrains WHERE nom = ?', [spec.nom]);
  const avance = Math.round(spec.prix * 0.125);
  const commodites = JSON.stringify(['dossards', 'eau', 'vestiaires', 'parking']);
  const description = `Seed multi-terrains — ${spec.note}`;
  const common = [
    proprioId, spec.nom, spec.adresse, spec.ville, 'foot', spec.type,
    spec.prix, spec.prix, Math.round(spec.prix * 0.6), description, PHONE_GERANT,
    avance, avance, 12.5, 'retrait', commodites, 10, spec.lat, spec.lng,
  ];

  let terrainId;
  if (existing) {
    runSql(
      db,
      `UPDATE terrains SET proprietaire_id = ?, nom = ?, adresse = ?, ville = ?, sport = ?, type = ?,
        prix_heure = ?, prix_entier = ?, prix_moitie = ?, description = ?, telephone = ?,
        montant_acompte = ?, acompte = ?, pourcentage_avance = ?, payout_mode = ?,
        commodites = ?, commission_pourcentage = ?, latitude = ?, longitude = ?, is_active = 1
       WHERE id = ?`,
      [...common, existing.id],
    );
    terrainId = existing.id;
  } else {
    terrainId = Number(runSql(
      db,
      `INSERT INTO terrains (
        proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_entier, prix_moitie,
        description, telephone, montant_acompte, acompte, pourcentage_avance, payout_mode,
        commodites, commission_pourcentage, latitude, longitude, photos, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 1)`,
      common,
    ).lastInsertRowid);
  }
  assurerHoraires(db, terrainId);
  return terrainId;
}

function lierGerantTerrain(db, gerantId, terrainId, { principal = false, note = null } = {}) {
  const existing = queryOne(
    db,
    'SELECT id FROM gerants_terrains WHERE gerant_id = ? AND terrain_id = ?',
    [gerantId, terrainId],
  );
  if (existing) {
    runSql(
      db,
      `UPDATE gerants_terrains SET est_principal = ?, actif = 1, note = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [principal ? 1 : 0, note, existing.id],
    );
    return existing.id;
  }
  return Number(runSql(
    db,
    `INSERT INTO gerants_terrains (gerant_id, terrain_id, est_principal, actif, date_debut, note)
     VALUES (?, ?, ?, 1, date('now'), ?)`,
    [gerantId, terrainId, principal ? 1 : 0, note],
  ).lastInsertRowid);
}

function nettoyerResasMulti(db, terrainIds) {
  if (!terrainIds.length) return;
  const placeholders = terrainIds.map(() => '?').join(',');
  const rows = queryAll(
    db,
    `SELECT id FROM reservations
     WHERE terrain_id IN (${placeholders}) AND code_reservation LIKE ?`,
    [...terrainIds, `${CODE_PREFIX}%`],
  );
  for (const row of rows) {
    runSql(db, 'DELETE FROM paiements WHERE reservation_id = ?', [row.id]);
    runSql(db, 'DELETE FROM dus WHERE reservation_id = ?', [row.id]);
    runSql(db, 'DELETE FROM payouts WHERE reservation_id = ?', [row.id]);
    runSql(db, 'DELETE FROM matchs WHERE reservation_id = ?', [row.id]);
    runSql(db, 'DELETE FROM reservations WHERE id = ?', [row.id]);
  }
}

function ensurePlayer(db, prenom, nom, idx) {
  const email = `multi.joueur.${String(idx).padStart(2, '0')}@joueur.terrainsn.local`;
  const telephone = `+221 00 900 ${String(10 + idx).padStart(2, '0')} ${String(10 + idx).padStart(2, '0')}`;
  const fullName = `${prenom} ${nom}`;
  const existing = queryOne(db, 'SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    runSql(
      db,
      `UPDATE users SET nom = ?, prenom = ?, telephone = ?, role = 'joueur', is_active = 1, telephone_verified = 1
       WHERE id = ?`,
      [fullName, prenom, telephone, existing.id],
    );
    return { id: existing.id, fullName, prenom, telephone };
  }
  const id = Number(runSql(
    db,
    `INSERT INTO users (nom, prenom, email, telephone, role, is_active, telephone_verified, quartier)
     VALUES (?, ?, ?, ?, 'joueur', 1, 1, 'Dakar')`,
    [fullName, prenom, email, telephone],
  ).lastInsertRowid);
  return { id, fullName, prenom, telephone };
}

function upsertCreneau(db, terrainId, date, hStart, statut = 'reserve') {
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

/**
 * Clôture après check-in + encaissement du reste sur place.
 * C’est ce qui alimente le KPI CA `valeur_totale_matchs` (statut match_joue).
 */
function cloturerApresCheckin(db, reservationId, { date, hStart }) {
  const resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  if (!resa) return;
  const reste = Math.max(0, Number(resa.reste_a_payer ?? resa.montant_restant ?? 0));
  const checkInAt = `${date} ${hh(hStart)}:05:00`;
  const scanAt = `${date} ${hh(hStart)}:08:00`;
  const checkoutAt = `${date} ${slotFin(hStart)}:02:00`.replace('00:00:02', '23:59:02');

  runSql(
    db,
    `UPDATE reservations SET
       statut = 'match_joue',
       operational_stage = 'closed',
       reste_a_payer = 0,
       montant_restant = 0,
       checked_in_at = ?,
       qr_code_scanne_at = ?,
       checkout_at = ?
     WHERE id = ?`,
    [checkInAt, scanAt, checkoutAt, reservationId],
  );

  if (reste > 0) {
    const deja = queryOne(
      db,
      `SELECT id FROM paiements WHERE reservation_id = ? AND reference_externe = ?`,
      [reservationId, `SOLDE-${reservationId}`],
    );
    if (!deja) {
      runSql(
        db,
        `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe)
         VALUES (?, ?, 'especes', 'paye', ?)`,
        [reservationId, reste, `SOLDE-${reservationId}`],
      );
    }
  }
}

function creerResaConfirmee(db, {
  terrainId, gerantId, player, date, hStart, prix, code,
  stage = 'reserved', scanned = false, matchJoue = false,
}) {
  const debut = hh(hStart);
  const fin = slotFin(hStart);
  const avance = Math.round(prix * 0.125);
  const restant = prix - avance;
  const creneauId = upsertCreneau(db, terrainId, date, hStart, 'reserve');
  const scannedAt = scanned || matchJoue ? `${date} ${hh(hStart)}:08:00` : null;

  const reservationId = Number(runSql(
    db,
    `INSERT INTO reservations (
      terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
      montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant,
      statut, creneau_id, cree_par, traite_par, code_reservation, operational_stage,
      confirme_at, qr_code_scanne_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirme', ?, 'joueur', ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    [
      terrainId, player.id, player.fullName, player.telephone, date, debut, fin,
      prix, prix, avance, avance, restant, restant,
      creneauId, gerantId, code, stage, scannedAt,
    ],
  ).lastInsertRowid);

  runSql(
    db,
    `INSERT INTO paiements (
      reservation_id, montant, methode, statut, reference_externe,
      montant_acompte, montant_commission, montant_reverse, statut_reversement
    ) VALUES (?, ?, 'wave', 'paye', ?, ?, ?, ?, 'en_attente')`,
    [
      reservationId,
      avance,
      `PAY-${code}`,
      avance,
      Math.round(avance * 0.1),
      Math.max(0, avance - Math.round(avance * 0.1)),
    ],
  );

  const contrat = chargerContrat(db, terrainId);
  const resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  creerDuApresPayin(db, { reservation: resa, contrat });

  if (matchJoue) {
    cloturerApresCheckin(db, reservationId, { date, hStart });
  }

  return reservationId;
}

function seedPlanningEquipe(db, terrainId, gerantId, collegueId) {
  runSql(db, 'DELETE FROM planning_garde WHERE terrain_id = ?', [terrainId]);
  // Lun–Mer → gérant principal, Jeu–Dim → collègue (si présent), sinon principal
  for (let jour = 0; jour <= 6; jour += 1) {
    const gid = collegueId && jour >= 3 ? collegueId : gerantId;
    runSql(
      db,
      `INSERT INTO planning_garde
        (terrain_id, gerant_id, jour_semaine, heure_debut, heure_fin, date_specifique, actif)
       VALUES (?, ?, ?, '08:00', '23:00', NULL, 1)`,
      [terrainId, gid, jour],
    );
  }
}

async function main() {
  const db = await getDb();
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  const proprioId = upsertProprio(db, hash);

  const siteId = ensureSite(db, {
    proprietaire_id: proprioId,
    nom: SITE_NOM,
    adresse: 'Yoff Tonghor',
    ville: 'Dakar',
  });

  const terrainIds = [];
  let principalTerrainId = null;
  for (const spec of TERRAINS_SPEC) {
    const tid = upsertTerrain(db, proprioId, spec);
    assignerTerrainAuSite(db, tid, siteId);
    terrainIds.push(tid);
    if (spec.principal) principalTerrainId = tid;

    transaction(db, () => {
      enregistrerContrat(db, tid, {
        numeros_identiques_whatsapp: 1,
        payout_mode: 'retrait',
        remboursement_autorise: 0,
        pourcentage_avance: 12.5,
        commission_pourcentage: 10,
        canal_reversement: 'wave',
      }, { auteurId: proprioId });
    });
    transaction(db, () => {
      enregistrerContrat(db, tid, {
        wave_statut: 'verifie',
        om_statut: 'verifie',
        numeros_identiques_whatsapp: 1,
      }, { auteurId: proprioId });
    });
  }

  if (!principalTerrainId) principalTerrainId = terrainIds[0];

  const gerantId = upsertGerant(db, {
    email: GERANT_EMAIL,
    prenom: 'Babacar',
    nom: 'Multi Terrains',
    telephone: PHONE_GERANT,
    whatsapp: PHONE_GERANT_WA,
    hash,
    terrainId: principalTerrainId,
    proprioId,
  });

  const collegueId = upsertGerant(db, {
    email: COLLEGUE_EMAIL,
    prenom: 'Awa',
    nom: 'Collegue Multi',
    telephone: PHONE_COLLEGUE,
    whatsapp: PHONE_COLLEGUE_WA,
    hash,
    terrainId: principalTerrainId,
    proprioId,
  });

  // Liens multi-terrains : le gérant principal gère les 3
  TERRAINS_SPEC.forEach((spec, i) => {
    lierGerantTerrain(db, gerantId, terrainIds[i], {
      principal: Boolean(spec.principal),
      note: spec.note,
    });
  });
  // Collègue uniquement sur le terrain principal
  lierGerantTerrain(db, collegueId, principalTerrainId, {
    principal: false,
    note: 'Collègue — planning multi-gérants',
  });

  // Contrats : rattacher le gérant principal
  for (const tid of terrainIds) {
    transaction(db, () => {
      enregistrerContrat(db, tid, { gerant_id: gerantId }, { auteurId: gerantId });
    });
  }

  seedPlanningEquipe(db, principalTerrainId, gerantId, collegueId);
  // Sur les autres terrains : le gérant seul toute la semaine
  for (const tid of terrainIds) {
    if (tid === principalTerrainId) continue;
    runSql(db, 'DELETE FROM planning_garde WHERE terrain_id = ?', [tid]);
    for (let jour = 0; jour <= 6; jour += 1) {
      runSql(
        db,
        `INSERT INTO planning_garde
          (terrain_id, gerant_id, jour_semaine, heure_debut, heure_fin, date_specifique, actif)
         VALUES (?, ?, ?, '08:00', '23:00', NULL, 1)`,
        [tid, gerantId, jour],
      );
    }
  }

  nettoyerResasMulti(db, terrainIds);

  const players = PLAYERS.map(([prenom, nom], i) => ensurePlayer(db, prenom, nom, i));
  const now = new Date();
  const today = ymd(now);
  const tomorrow = ymd(addDays(1));
  const dayAfter = ymd(addDays(2));
  const hour = now.getHours();

  let seq = 0;
  const stats = [];

  terrainIds.forEach((terrainId, tIdx) => {
    const prix = TERRAINS_SPEC[tIdx].prix;
    const created = [];
    let matchsJoues = 0;
    let caJoues = 0;

    // Créneaux libres à venir
    for (const day of [tomorrow, dayAfter]) {
      for (const h of [18, 19, 20, 21]) {
        upsertCreneau(db, terrainId, day, h, 'libre');
      }
    }

    // Historique 7 jours : matchs joués + encaissés (alimente CA semaine/mois)
    for (let d = 1; d <= 7; d += 1) {
      const dayPast = ymd(addDays(-d));
      const hoursPast = d % 2 === 0 ? [17, 19] : [18, 20];
      for (const hStart of hoursPast) {
        seq += 1;
        const player = players[(tIdx * 7 + d + hStart) % players.length];
        creerResaConfirmee(db, {
          terrainId,
          gerantId,
          player,
          date: dayPast,
          hStart,
          prix,
          code: `${CODE_PREFIX}${dayPast.replace(/-/g, '')}-T${terrainId}-H${String(hStart).padStart(2, '0')}-${seq}`,
          stage: 'closed',
          scanned: true,
          matchJoue: true,
        });
        matchsJoues += 1;
        caJoues += prix;
      }
    }

    // Matchs aujourd'hui : passés (joués+encaissés) + imminents + à venir
    const hoursToday = [hour - 2, hour, hour + 1, hour + 2].filter((h) => h >= 8 && h <= 22);
    for (const hStart of hoursToday) {
      seq += 1;
      const player = players[(tIdx * 4 + seq) % players.length];
      const past = hStart < hour;
      const current = hStart === hour;
      const code = `${CODE_PREFIX}${today.replace(/-/g, '')}-T${terrainId}-H${String(hStart).padStart(2, '0')}-${seq}`;
      let stage = 'reserved';
      let scanned = false;
      let matchJoue = false;
      if (past) {
        stage = 'closed';
        scanned = true;
        matchJoue = true; // check-in + reste espèces → CA
      } else if (current) {
        stage = 'checkin';
        scanned = false;
      }
      const id = creerResaConfirmee(db, {
        terrainId,
        gerantId,
        player,
        date: today,
        hStart,
        prix,
        code,
        stage,
        scanned,
        matchJoue,
      });
      if (matchJoue) {
        matchsJoues += 1;
        caJoues += prix;
      }
      created.push({ id, hStart, stage, code, scanned, matchJoue });
    }

    // Demain soir confirmé (pas encore joué → hors CA)
    seq += 1;
    const playerTomorrow = players[(tIdx + 3) % players.length];
    creerResaConfirmee(db, {
      terrainId,
      gerantId,
      player: playerTomorrow,
      date: tomorrow,
      hStart: 19,
      prix,
      code: `${CODE_PREFIX}${tomorrow.replace(/-/g, '')}-T${terrainId}-19-${seq}`,
      stage: 'reserved',
    });

    stats.push({
      terrainId,
      nom: TERRAINS_SPEC[tIdx].nom,
      resasAujourdhui: created.length,
      matchsJoues,
      caJoues,
      imminents: created.filter((r) => !r.matchJoue && r.hStart >= hour && r.hStart <= hour + 1).length,
    });
  });

  saveDb();

  const liens = queryAll(
    db,
    `SELECT gt.terrain_id, gt.est_principal, gt.note, t.nom, t.site_id
     FROM gerants_terrains gt
     JOIN terrains t ON t.id = gt.terrain_id
     WHERE gt.gerant_id = ? AND gt.actif = 1
     ORDER BY gt.est_principal DESC, t.nom`,
    [gerantId],
  );

  console.log('\n=== Seed gérant multi-terrains OK ===\n');
  console.log('Connexion PRO  →  http://localhost:5174/login');
  console.log(`  Email     : ${GERANT_EMAIL}`);
  console.log(`  Mot de passe : ${DEMO_PASSWORD}`);
  console.log(`  Téléphone : ${PHONE_GERANT}`);
  console.log(`  Gérant id : ${gerantId}`);
  console.log(`  Site id   : ${siteId} (${SITE_NOM})`);
  console.log(`  Proprio   : ${PROPRIO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Collègue  : ${COLLEGUE_EMAIL} / ${DEMO_PASSWORD} (terrain principal uniquement)`);
  console.log('\nTerrains liés :');
  for (const l of liens) {
    console.log(`  #${l.terrain_id}  ${l.est_principal ? '★' : '·'}  ${l.nom}  [site=${l.site_id}]  — ${l.note || ''}`);
  }
  console.log('\nActivité seedée :');
  let caTotal = 0;
  let jouesTotal = 0;
  for (const s of stats) {
    caTotal += s.caJoues;
    jouesTotal += s.matchsJoues;
    console.log(
      `  ${s.nom} (#${s.terrainId}) → ${s.resasAujourdhui} auj. | ${s.matchsJoues} joués+encaissés | CA ${s.caJoues.toLocaleString('fr-FR')} FCFA`,
    );
  }
  console.log(`\nCA agrégé (KPI « Valeur matchs ») : ${jouesTotal} matchs → ${caTotal.toLocaleString('fr-FR')} FCFA`);
  console.log('Astuce : Finances gérant / proprio → période semaine ou mois pour voir le CA.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
