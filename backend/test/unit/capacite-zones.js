/**
 * Tests unitaires capaciteService — zones A/B.
 * Exécution : node test/unit/capacite-zones.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = path.join(os.tmpdir(), `capacite-zones-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmp;

const { createHarness } = require('../helpers/harness');
const { openDb, seedMonde, runSql, queryOne, transaction } = require('../helpers/fixtureDb');
const {
  zonesOccupees,
  etatCreneau,
  peutReserver,
  attribuerZone,
  etatDepuisOccupees,
  choisirZone,
  ZONE_A,
  ZONE_B,
  ZONE_AB,
} = require('../../services/capaciteService');

const h = createHarness('capacite-zones');

function insertResa(db, {
  terrainId,
  date = '2026-12-15',
  heureDebut,
  heureFin,
  format = 'moitie',
  zone = null,
  statut = 'confirme',
  verrouExpireAt = null,
}) {
  return runSql(
    db,
    `INSERT INTO reservations (
      terrain_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
      montant, prix_total, format_terrain, zone, statut, verrou_expire_at, cree_par, mode_paiement
    ) VALUES (?, 'T', '221770000000', ?, ?, ?, 10000, 10000, ?, ?, ?, ?, 'joueur', 'en_ligne')`,
    [terrainId, date, heureDebut, heureFin, format, zone, statut, verrouExpireAt],
  ).lastInsertRowid;
}

function insertBlocage(db, { terrainId, date = '2026-12-15', heureDebut, heureFin, zone = 'AB' }) {
  return runSql(
    db,
    `INSERT INTO blocages_creneaux (terrain_id, date, heure_debut, heure_fin, motif, type_blocage, zone)
     VALUES (?, ?, ?, ?, 'test', 'MAINTENANCE', ?)`,
    [terrainId, date, heureDebut, heureFin, zone],
  ).lastInsertRowid;
}

async function main() {
  const db = await openDb();
  const monde = await seedMonde(db);
  const tid = monde.terrainAvance;
  const date = '2026-12-15';

  // --- Pures ---
  h.assertEqual('etat vide = libre', etatDepuisOccupees(new Set()).etat, 'libre');
  h.assertEqual('etat A = partiel', etatDepuisOccupees(new Set([ZONE_A])).etat, 'partiel');
  h.assertEqual('etat AB = complet', etatDepuisOccupees(new Set([ZONE_A, ZONE_B])).etat, 'complet');
  h.assertEqual('choisir demi libre → A', choisirZone('moitie', new Set()), ZONE_A);
  h.assertEqual('choisir demi A pris → B', choisirZone('moitie', new Set([ZONE_A])), ZONE_B);
  h.assertEqual('choisir entier libre → AB', choisirZone('entier', new Set()), ZONE_AB);
  h.assertEqual('choisir entier partiel → null', choisirZone('entier', new Set([ZONE_A])), null);

  // --- 1. Demi A puis demi B → OK ; 3e refusée ---
  insertResa(db, { terrainId: tid, heureDebut: '18:00', heureFin: '19:00', format: 'moitie', zone: 'A' });
  h.assert('demi1 → A occupée', zonesOccupees(db, tid, date, '18:00', '19:00').has(ZONE_A));
  h.assert('demi1 → B libre', !zonesOccupees(db, tid, date, '18:00', '19:00').has(ZONE_B));
  h.assert('2e demi OK', peutReserver('moitie', db, tid, date, '18:00', '19:00'));
  h.assertEqual('attribuer 2e → B', attribuerZone('moitie', db, tid, date, '18:00', '19:00'), ZONE_B);
  insertResa(db, { terrainId: tid, heureDebut: '18:00', heureFin: '19:00', format: 'moitie', zone: 'B' });
  h.assertEqual('2 demis = complet', etatCreneau(db, tid, date, '18:00', '19:00').etat, 'complet');
  h.assert('3e demi refusée', !peutReserver('moitie', db, tid, date, '18:00', '19:00'));

  // --- 2. Entier puis demi → refusé ; demi puis entier → refusé ---
  const date2 = '2026-12-16';
  insertResa(db, {
    terrainId: tid,
    date: date2,
    heureDebut: '10:00',
    heureFin: '11:00',
    format: 'entier',
    zone: 'AB',
  });
  h.assert('après entier, demi refusée', !peutReserver('moitie', db, tid, date2, '10:00', '11:00'));

  const date3 = '2026-12-17';
  insertResa(db, {
    terrainId: tid,
    date: date3,
    heureDebut: '10:00',
    heureFin: '11:00',
    format: 'moitie',
    zone: 'A',
  });
  h.assert('après demi, entier refusé', !peutReserver('entier', db, tid, date3, '10:00', '11:00'));
  h.assert('après demi, autre demi OK', peutReserver('moitie', db, tid, date3, '10:00', '11:00'));

  // --- 3. Durées mixtes : 18-20 A + 18-19 B → OK ; puis 19-20 B → OK ---
  const date4 = '2026-12-18';
  insertResa(db, {
    terrainId: tid,
    date: date4,
    heureDebut: '18:00',
    heureFin: '20:00',
    format: 'moitie',
    zone: 'A',
  });
  insertResa(db, {
    terrainId: tid,
    date: date4,
    heureDebut: '18:00',
    heureFin: '19:00',
    format: 'moitie',
    zone: 'B',
  });
  h.assertEqual('18-19 complet', etatCreneau(db, tid, date4, '18:00', '19:00').etat, 'complet');
  h.assertEqual('19-20 partiel (A)', etatCreneau(db, tid, date4, '19:00', '20:00').etat, 'partiel');
  h.assert('demi 19-20 B OK', peutReserver('moitie', db, tid, date4, '19:00', '20:00'));
  h.assertEqual('attribuer 19-20 → B', attribuerZone('moitie', db, tid, date4, '19:00', '20:00'), ZONE_B);
  insertResa(db, {
    terrainId: tid,
    date: date4,
    heureDebut: '19:00',
    heureFin: '20:00',
    format: 'moitie',
    zone: 'B',
  });
  h.assertEqual('19-20 complet après 2e demi', etatCreneau(db, tid, date4, '19:00', '20:00').etat, 'complet');

  // --- 4. Blocage A + demi → B ; blocage AB → complet ---
  const date5 = '2026-12-19';
  insertBlocage(db, { terrainId: tid, date: date5, heureDebut: '14:00', heureFin: '15:00', zone: 'A' });
  h.assert('blocage A : demi OK', peutReserver('moitie', db, tid, date5, '14:00', '15:00'));
  h.assertEqual('blocage A : attribuer B', attribuerZone('moitie', db, tid, date5, '14:00', '15:00'), ZONE_B);
  h.assert('blocage A : entier KO', !peutReserver('entier', db, tid, date5, '14:00', '15:00'));

  const date6 = '2026-12-20';
  insertBlocage(db, { terrainId: tid, date: date6, heureDebut: '14:00', heureFin: '15:00', zone: 'AB' });
  h.assertEqual('blocage AB = complet', etatCreneau(db, tid, date6, '14:00', '15:00').etat, 'complet');
  h.assert('blocage AB : demi KO', !peutReserver('moitie', db, tid, date6, '14:00', '15:00'));

  // --- Verrou pending sans zone consomme capacité ---
  const date7 = '2026-12-21';
  insertResa(db, {
    terrainId: tid,
    date: date7,
    heureDebut: '16:00',
    heureFin: '17:00',
    format: 'moitie',
    zone: null,
    statut: 'en_attente_paiement',
    verrouExpireAt: Date.now() + 60_000,
  });
  h.assertEqual('pending demi → partiel', etatCreneau(db, tid, date7, '16:00', '17:00').etat, 'partiel');
  // Verrou sans zone ne préempte pas A : le 1er confirmé prend A
  h.assertEqual('1er confirmé → A', attribuerZone('moitie', db, tid, date7, '16:00', '17:00'), ZONE_A);
  h.assert('2e demi encore OK', peutReserver('moitie', db, tid, date7, '16:00', '17:00'));

  // excludeReservationId au confirm
  const idPending = insertResa(db, {
    terrainId: tid,
    date: date7,
    heureDebut: '20:00',
    heureFin: '21:00',
    format: 'moitie',
    zone: null,
    statut: 'en_attente_paiement',
    verrouExpireAt: Date.now() + 60_000,
  });
  insertResa(db, {
    terrainId: tid,
    date: date7,
    heureDebut: '20:00',
    heureFin: '21:00',
    format: 'moitie',
    zone: 'A',
    statut: 'confirme',
  });
  h.assert(
    'confirm self exclu : encore 1 place',
    peutReserver('moitie', db, tid, date7, '20:00', '21:00', { excludeReservationId: idPending }),
  );
  h.assertEqual(
    'confirm self → B',
    attribuerZone('moitie', db, tid, date7, '20:00', '21:00', { excludeReservationId: idPending }),
    ZONE_B,
  );

  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  h.exitIfFailed();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
