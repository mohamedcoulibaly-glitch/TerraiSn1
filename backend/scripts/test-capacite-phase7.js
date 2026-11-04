/**
 * PHASE 7 — Simulation des scénarios demi-terrains / zones A-B.
 * Usage: node scripts/test-capacite-phase7.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `terrainsn-phase7-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;

const { createHarness } = require('../test/helpers/harness');
const { getDb, runSql, queryOne, queryAll, transaction } = require('../database');
const {
  lockCreneauxAtomique,
  libererCreneauxReservation,
  confirmerAvecCapacite,
} = require('../reservationLockService');
const {
  etatCreneau,
  peutReserver,
  attribuerZone,
  reservationsConfirmeesEnConflit,
  capaciteOccupeeHeures,
  normalizeZone,
} = require('../services/capaciteService');
const { computeOccupancyRate } = require('../ownerRevenueService');

const h = createHarness('phase7-capacite');

function seed(db) {
  const proprioId = runSql(
    db,
    `INSERT INTO proprietaires (nom, email, password_hash, telephone, statut)
     VALUES ('P7', 'p7@test.sn', 'x', '221770000070', 'actif')`,
  ).lastInsertRowid;
  const terrainId = runSql(
    db,
    `INSERT INTO terrains (
      proprietaire_id, nom, adresse, ville, sport, type,
      prix_heure, prix_entier, prix_moitie, is_active, types_location
    ) VALUES (?, 'Phase7 Arena', 'Dakar', 'Dakar', 'foot', '5v5', 30000, 40000, 20000, 1, 'les_deux')`,
    [proprioId],
  ).lastInsertRowid;
  for (const jour of ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']) {
    runSql(
      db,
      `INSERT INTO horaires (terrain_id, jour, est_ouvert, heure_debut, heure_fin)
       VALUES (?, ?, 1, '08:00', '23:00')`,
      [terrainId, jour],
    );
  }
  const joueurs = [];
  for (let i = 1; i <= 4; i += 1) {
    joueurs.push(
      runSql(
        db,
        `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active)
         VALUES (?, ?, ?, 'x', ?, 'joueur', 1)`,
        [`J${i}`, `P${i}`, `j${i}@phase7.sn`, `2217700000${i}`],
      ).lastInsertRowid,
    );
  }
  return { terrainId, joueurs };
}

function creerPending(db, { terrainId, joueurId, date, debut, fin, format, nom }) {
  return transaction(db, () => {
    const creneauId = lockCreneauxAtomique(db, terrainId, date, debut, fin, format);
    const id = runSql(
      db,
      `INSERT INTO reservations (
        terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
        montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant,
        format_terrain, zone, statut, creneau_id, verrou_expire_at, cree_par, mode_paiement
      ) VALUES (?, ?, ?, '221770000000', ?, ?, ?, 20000, 20000, 5000, 5000, 15000, 15000,
        ?, NULL, 'en_attente_paiement', ?, ?, 'joueur', 'en_ligne')`,
      [terrainId, joueurId, nom, date, debut, fin, format, creneauId, Date.now() + 15 * 60 * 1000],
    ).lastInsertRowid;
    return { id, creneauId };
  });
}

function confirmer(db, reservationId) {
  return transaction(db, () => {
    const row = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
    const capa = confirmerAvecCapacite(db, row);
    if (!capa.ok) {
      runSql(
        db,
        `UPDATE reservations SET statut = 'annule' WHERE id = ? AND statut IN ('en_attente','en_attente_paiement')`,
        [reservationId],
      );
      libererCreneauxReservation(db, row);
      return { ok: false, action: 'refund' };
    }
    runSql(
      db,
      `UPDATE reservations SET statut = 'confirme', zone = ?, confirme_at = ? WHERE id = ?`,
      [capa.zone, new Date().toISOString(), reservationId],
    );
    return { ok: true, zone: capa.zone, action: 'confirm' };
  });
}

function annuler(db, reservationId) {
  const row = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [reservationId]);
  runSql(db, `UPDATE reservations SET statut = 'annule' WHERE id = ?`, [reservationId]);
  libererCreneauxReservation(db, row);
}

async function main() {
  const db = await getDb();
  const { terrainId: tid, joueurs } = seed(db);
  const [j1, j2, j3, j4] = joueurs;

  // ─── 1. Deux demis OK, troisième refusée ─────────────────────────
  const d1 = '2026-12-01';
  const p1 = creerPending(db, {
    terrainId: tid,
    joueurId: j1,
    date: d1,
    debut: '18:00',
    fin: '19:00',
    format: 'moitie',
    nom: 'Joueur1',
  });
  const c1 = confirmer(db, p1.id);
  h.assertEqual('S1 Joueur1 → zone A', c1.zone, 'A');

  const p2 = creerPending(db, {
    terrainId: tid,
    joueurId: j2,
    date: d1,
    debut: '18:00',
    fin: '19:00',
    format: 'moitie',
    nom: 'Joueur2',
  });
  const c2 = confirmer(db, p2.id);
  h.assertEqual('S1 Joueur2 → zone B', c2.zone, 'B');
  h.assertEqual('S1 créneau complet', etatCreneau(db, tid, d1, '18:00', '19:00').etat, 'complet');

  let refused3 = false;
  try {
    creerPending(db, {
      terrainId: tid,
      joueurId: j3,
      date: d1,
      debut: '18:00',
      fin: '19:00',
      format: 'moitie',
      nom: 'Joueur3',
    });
  } catch (e) {
    refused3 = e.code === 'CRENEAU_CONFLIT';
  }
  h.assert('S1 Joueur3 refusé', refused3);

  // ─── 2. Annulation J1 → partiel ──────────────────────────────────
  annuler(db, p1.id);
  h.assertEqual('S2 après annulation → partiel', etatCreneau(db, tid, d1, '18:00', '19:00').etat, 'partiel');
  h.assert('S2 demi encore disponible', peutReserver('moitie', db, tid, d1, '18:00', '19:00'));
  h.assert('S2 entier refusé (B encore pris)', !peutReserver('entier', db, tid, d1, '18:00', '19:00'));

  // ─── 3. Entier confirmé bloque tout ─────────────────────────────
  const d3 = '2026-12-02';
  const pEntier = creerPending(db, {
    terrainId: tid,
    joueurId: j1,
    date: d3,
    debut: '10:00',
    fin: '11:00',
    format: 'entier',
    nom: 'Entier',
  });
  const cEntier = confirmer(db, pEntier.id);
  h.assertEqual('S3 entier → AB', cEntier.zone, 'AB');
  h.assert('S3 demi refusée', !peutReserver('moitie', db, tid, d3, '10:00', '11:00'));
  h.assert('S3 autre entier refusé', !peutReserver('entier', db, tid, d3, '10:00', '11:00'));
  let refusedDemi = false;
  try {
    creerPending(db, {
      terrainId: tid,
      joueurId: j2,
      date: d3,
      debut: '10:00',
      fin: '11:00',
      format: 'moitie',
      nom: 'TropTard',
    });
  } catch (e) {
    refusedDemi = e.code === 'CRENEAU_CONFLIT';
  }
  h.assert('S3 création demi refusée', refusedDemi);

  // ─── 4. Course sur dernière moitié → 1 confirmé, 1 refund ────────
  const d4 = '2026-12-03';
  // Une demi déjà en A
  const base = creerPending(db, {
    terrainId: tid,
    joueurId: j1,
    date: d4,
    debut: '16:00',
    fin: '17:00',
    format: 'moitie',
    nom: 'BaseA',
  });
  confirmer(db, base.id);
  h.assertEqual('S4 base en A', queryOne(db, 'SELECT zone FROM reservations WHERE id=?', [base.id]).zone, 'A');

  // Deux pending sur la dernière moitié (B)
  const race1 = creerPending(db, {
    terrainId: tid,
    joueurId: j2,
    date: d4,
    debut: '16:00',
    fin: '17:00',
    format: 'moitie',
    nom: 'Race1',
  });
  // 3e lock impossible (capacité pleine avec 1 confirme + 1 pending)
  let race2BlockedAtLock = false;
  let race2 = null;
  try {
    race2 = creerPending(db, {
      terrainId: tid,
      joueurId: j3,
      date: d4,
      debut: '16:00',
      fin: '17:00',
      format: 'moitie',
      nom: 'Race2',
    });
  } catch (e) {
    race2BlockedAtLock = e.code === 'CRENEAU_CONFLIT';
  }

  // Simuler course au webhook : deux pending déjà posés (bypass lock pour le 2e via insert manuel)
  // Cas réel IPN concurrent : deux en_attente_paiement sur dernière place
  if (race2BlockedAtLock) {
    // Forcer un 2e pending « déjà payé » pour tester le contrôle atomique à la confirmation
    race2 = {
      id: runSql(
        db,
        `INSERT INTO reservations (
          terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
          montant, prix_total, format_terrain, zone, statut, verrou_expire_at, cree_par, mode_paiement
        ) VALUES (?, ?, 'Race2', '221770000003', ?, '16:00', '17:00', 20000, 20000, 'moitie', NULL,
          'en_attente_paiement', ?, 'joueur', 'en_ligne')`,
        [tid, j3, d4, Date.now() + 60_000],
      ).lastInsertRowid,
    };
  }

  const r1 = confirmer(db, race1.id);
  const r2 = confirmer(db, race2.id);
  const winnerId = r1.ok ? race1.id : race2.id;
  const loserId = r1.ok ? race2.id : race1.id;
  h.assert('S4 un seul confirmé', r1.ok !== r2.ok);
  h.assertEqual('S4 gagnant → B', (r1.ok ? r1 : r2).zone, 'B');
  h.assertEqual(
    'S4 perdant annulé',
    queryOne(db, 'SELECT statut FROM reservations WHERE id=?', [loserId]).statut,
    'annule',
  );
  h.assertEqual(
    'S4 gagnant confirmé',
    queryOne(db, 'SELECT statut FROM reservations WHERE id=?', [winnerId]).statut,
    'confirme',
  );

  // ─── 5. Blocage moitié B → seule A réservable ────────────────────
  const d5 = '2026-12-04';
  runSql(
    db,
    `INSERT INTO blocages_creneaux (terrain_id, date, heure_debut, heure_fin, motif, type_blocage, zone)
     VALUES (?, ?, '18:00', '19:00', 'Maintenance', 'MAINTENANCE', 'B')`,
    [tid, d5],
  );
  h.assert('S5 demi OK', peutReserver('moitie', db, tid, d5, '18:00', '19:00'));
  h.assert('S5 entier KO', !peutReserver('entier', db, tid, d5, '18:00', '19:00'));
  h.assertEqual('S5 attribution → A', attribuerZone('moitie', db, tid, d5, '18:00', '19:00'), 'A');
  const p5 = creerPending(db, {
    terrainId: tid,
    joueurId: j1,
    date: d5,
    debut: '18:00',
    fin: '19:00',
    format: 'moitie',
    nom: 'SurA',
  });
  const c5 = confirmer(db, p5.id);
  h.assertEqual('S5 confirmé en A', c5.zone, 'A');

  // ─── 6. Blocage A en conflit avec demi confirmée ─────────────────
  const d6 = '2026-12-05';
  const p6 = creerPending(db, {
    terrainId: tid,
    joueurId: j1,
    date: d6,
    debut: '12:00',
    fin: '13:00',
    format: 'moitie',
    nom: 'SurA-conflit',
  });
  confirmer(db, p6.id);
  const conflits = reservationsConfirmeesEnConflit(db, tid, d6, '12:00', '13:00', 'A');
  h.assert('S6 conflit détecté', conflits.length === 1 && Number(conflits[0].id) === p6.id);
  // Déplacement proposé : B libre
  h.assert('S6 B libre pour déplacement', !etatCreneau(db, tid, d6, '12:00', '13:00').zones_occupees.includes('B'));
  runSql(db, `UPDATE reservations SET zone = 'B' WHERE id = ?`, [p6.id]);
  const conflitsApres = reservationsConfirmeesEnConflit(db, tid, d6, '12:00', '13:00', 'A');
  h.assertEqual('S6 plus de conflit après déplacement', conflitsApres.length, 0);
  // Blocage A possible
  runSql(
    db,
    `INSERT INTO blocages_creneaux (terrain_id, date, heure_debut, heure_fin, motif, type_blocage, zone)
     VALUES (?, ?, '12:00', '13:00', 'Maintenance', 'MAINTENANCE', 'A')`,
    [tid, d6],
  );
  h.assertEqual('S6 après blocage A + demi B → partiel/complet', etatCreneau(db, tid, d6, '12:00', '13:00').etat, 'complet');

  // ─── 7. Durées mixtes 2h A + 1h B + 1h B ─────────────────────────
  const d7 = '2026-12-06';
  const longA = creerPending(db, {
    terrainId: tid,
    joueurId: j1,
    date: d7,
    debut: '18:00',
    fin: '20:00',
    format: 'moitie',
    nom: 'LongA',
  });
  const cLong = confirmer(db, longA.id);
  h.assertEqual('S7 long → A', cLong.zone, 'A');

  const shortB1 = creerPending(db, {
    terrainId: tid,
    joueurId: j2,
    date: d7,
    debut: '18:00',
    fin: '19:00',
    format: 'moitie',
    nom: 'ShortB1',
  });
  const cB1 = confirmer(db, shortB1.id);
  h.assertEqual('S7 18-19 → B', cB1.zone, 'B');
  h.assertEqual('S7 18-19 complet', etatCreneau(db, tid, d7, '18:00', '19:00').etat, 'complet');
  h.assertEqual('S7 19-20 partiel', etatCreneau(db, tid, d7, '19:00', '20:00').etat, 'partiel');

  const shortB2 = creerPending(db, {
    terrainId: tid,
    joueurId: j3,
    date: d7,
    debut: '19:00',
    fin: '20:00',
    format: 'moitie',
    nom: 'ShortB2',
  });
  const cB2 = confirmer(db, shortB2.id);
  h.assertEqual('S7 19-20 → B', cB2.zone, 'B');
  h.assertEqual('S7 19-20 complet', etatCreneau(db, tid, d7, '19:00', '20:00').etat, 'complet');

  // ─── 8. KPI occupation en capacité (zones × heures) ──────────────
  // Sur d3 : 1 entier 1h = 2 unités ; horaires 08-23 = 15 slots × 2 = 30 unités/jour
  const resasKpi = queryAll(
    db,
    `SELECT * FROM reservations WHERE terrain_id = ? AND statut = 'confirme' AND date = ?`,
    [tid, d3],
  );
  const units = capaciteOccupeeHeures(resasKpi);
  h.assertEqual('S8 entier 1h = 2 unités-zone', units, 2);

  const occ = computeOccupancyRate(db, queryAll, {
    terrainIds: [tid],
    from: d3,
    to: d3,
    reservations: resasKpi,
  });
  // 2 / (15*2) = 2/30 ≈ 7%
  h.assert('S8 occupancy > 0', occ > 0 && occ <= 100);
  h.assertEqual('S8 occupancy ≈ 7%', occ, 7);

  // Demi 1h = 1 unité
  const demiUnits = capaciteOccupeeHeures([
    { heure_debut: '18:00', heure_fin: '19:00', format_terrain: 'moitie', zone: 'A', statut: 'confirme' },
  ]);
  h.assertEqual('S8 demi 1h = 1 unité', demiUnits, 1);

  // ─── Récap états API ─────────────────────────────────────────────
  const payload = etatCreneau(db, tid, d1, '18:00', '19:00');
  h.assert('S2 zones_libres contient A', payload.zones_libres.includes('A'));
  h.assertEqual('S2 demi_disponible', payload.demi_disponible, true);
  h.assertEqual('S2 entier_disponible', payload.entier_disponible, false);

  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }
  h.exitIfFailed();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
