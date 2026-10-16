/**
 * Base sqlite temporaire. Le fichier de test doit fixer DB_PATH
 * avant de charger ce module.
 */
const { getDb, runSql, queryOne, queryAll, transaction } = require('../../database');

async function openDb() {
  return getDb();
}

async function seedMonde(db) {
  const proprioId = runSql(
    db,
    `INSERT INTO proprietaires (nom, email, password_hash, telephone, statut)
     VALUES ('Proprio Fixture', 'proprio-fixture@test.sn', 'x', '221781000001', 'actif')`,
  ).lastInsertRowid;

  function terrain(nom, politique) {
    return runSql(
      db,
      `INSERT INTO terrains (
        proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_entier, prix_moitie,
        pourcentage_avance, commission_pourcentage, modele_revenus, is_active, politique_paiement,
        delai_verrou_paiement_min, prix_carte_source, config_version
      ) VALUES (?, ?, 'Dakar', 'Dakar', 'foot', '5v5', 30000, 40000, 18000, 12.5, 10, 'commission', 1, ?, 15, 'demi', 0)`,
      [proprioId, nom, politique],
    ).lastInsertRowid;
  }

  const terrainAvance = terrain('Arena Avance', 'avance');
  const terrainSans = terrain('Arena Sans', 'sans_avance');

  const gerantId = runSql(
    db,
    `INSERT INTO employes (proprietaire_id, terrain_id, nom, email, password_hash, telephone, whatsapp_number, is_active)
     VALUES (?, ?, 'Gerant Fixture', 'gerant-fixture@test.sn', 'x', '221771110000', '221771110000', 1)`,
    [proprioId, terrainAvance],
  ).lastInsertRowid;
  runSql(db, 'UPDATE terrains SET gerant_id = ? WHERE id = ?', [gerantId, terrainAvance]);
  runSql(db, 'UPDATE terrains SET gerant_id = ? WHERE id = ?', [gerantId, terrainSans]);

  const joueurA = runSql(
    db,
    `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active, telephone_verified)
     VALUES ('Sow', 'Abdou', 'a@test.sn', 'x', '+221 77 111 00 01', 'joueur', 1, 1)`,
  ).lastInsertRowid;
  const joueurB = runSql(
    db,
    `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active, telephone_verified)
     VALUES ('Diallo', 'Fatou', 'b@test.sn', 'x', '+221 77 111 00 02', 'joueur', 1, 1)`,
  ).lastInsertRowid;

  return { proprioId, terrainAvance, terrainSans, gerantId, joueurA, joueurB };
}

function poserReservation(db, {
  terrainId,
  joueurId,
  statut = 'en_attente_paiement',
  date = '2026-11-02',
  heureDebut = '18:00',
  heureFin = '19:00',
  verrouExpireAt = Date.now() + 15 * 60 * 1000,
  telephone = '221771110001',
  nom = 'Joueur',
}) {
  return transaction(db, () => {
    const { lockCreneauxAtomique } = require('../../reservationLockService');
    const creneauId = lockCreneauxAtomique(db, terrainId, date, heureDebut, heureFin);
    const reservationId = runSql(
      db,
      `INSERT INTO reservations (
        terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
        montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant,
        statut, creneau_id, verrou_expire_at, cree_par, mode_paiement
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 30000, 30000, 5000, 5000, 25000, 25000, ?, ?, ?, 'joueur', 'en_ligne')`,
      [terrainId, joueurId, nom, telephone, date, heureDebut, heureFin, statut, creneauId, verrouExpireAt],
    ).lastInsertRowid;
    return { reservationId, creneauId };
  });
}

function spies() {
  const calls = [];
  const events = [];
  return {
    calls,
    events,
    ports: {
      async confirmationJoueur(id) {
        calls.push(['wa', id]);
      },
      async pushJoueur(id) {
        calls.push(['push', id]);
      },
      async pushGerant(reservation) {
        calls.push(['push-gerant', reservation.id, reservation.code_reservation]);
      },
      publish(terrainId, type, payload) {
        events.push({ terrainId, type, payload });
      },
    },
  };
}

module.exports = { openDb, seedMonde, poserReservation, spies, queryOne, queryAll, runSql, transaction };
