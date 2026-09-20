/**
 * Upsert comptes Mohamed (joueur + gérant + proprio) + terrain à SON numéro.
 * Numéro : +221 77 826 12 25  — mot de passe : password123
 *
 * Usage : node scripts/ensure-mohamed-accounts.js
 *         require('./scripts/ensure-mohamed-accounts').ensureMohamedAccounts()
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const bcrypt = require('bcryptjs');
const { getDb, queryOne, queryAll, runSql, saveDb, transaction } = require('../database');
const { enregistrerContrat } = require('../services/contratService');
const { traiterConfirmationPaytech } = require('../payments/flow');

const DEMO_PASSWORD = 'password123';
const PHONE_STORE = '+221 77 826 12 25';
const PHONE_WA = '+221778261225';
const JOUEUR_EMAIL = 'mohamed.joueur@gmail.com';
const GERANT_EMAIL = 'mohamed.gerant@gmail.com';
const PROPRIO_EMAIL = 'mohamed.proprietaire@gmail.com';
const ADMIN_EMAIL = 'mohamed.admin@gmail.com';
const TERRAIN_NOM = 'Arena Mohamed Parcelles';

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

function upsertJoueur(db, hash) {
  const existing = queryOne(db, 'SELECT id FROM users WHERE email = ?', [JOUEUR_EMAIL]);
  if (existing) {
    runSql(
      db,
      `UPDATE users SET nom = ?, prenom = ?, password_hash = ?, telephone = ?, role = 'joueur',
        is_active = 1, telephone_verified = 1, must_change_password = 0, is_banned = 0
       WHERE id = ?`,
      ['Mohamed Coulibaly', 'Mohamed', hash, PHONE_STORE, existing.id],
    );
    return existing.id;
  }
  return runSql(
    db,
    `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active, telephone_verified, must_change_password)
     VALUES (?, ?, ?, ?, ?, 'joueur', 1, 1, 0)`,
    ['Mohamed Coulibaly', 'Mohamed', JOUEUR_EMAIL, hash, PHONE_STORE],
  ).lastInsertRowid;
}

function upsertAdmin(db, hash) {
  const existing = queryOne(db, 'SELECT id FROM users WHERE email = ?', [ADMIN_EMAIL]);
  if (existing) {
    runSql(
      db,
      `UPDATE users SET nom = ?, prenom = ?, password_hash = ?, telephone = ?, role = 'superadmin',
        is_active = 1, telephone_verified = 1, must_change_password = 0, is_banned = 0
       WHERE id = ?`,
      ['Mohamed Admin', 'Mohamed', hash, PHONE_STORE, existing.id],
    );
    return existing.id;
  }
  return runSql(
    db,
    `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active, telephone_verified, must_change_password)
     VALUES (?, ?, ?, ?, ?, 'superadmin', 1, 1, 0)`,
    ['Mohamed Admin', 'Mohamed', ADMIN_EMAIL, hash, PHONE_STORE],
  ).lastInsertRowid;
}

function upsertProprio(db, hash) {
  const existing = queryOne(db, 'SELECT id FROM proprietaires WHERE email = ?', [PROPRIO_EMAIL]);
  if (existing) {
    runSql(
      db,
      `UPDATE proprietaires SET nom = ?, prenom = ?, password_hash = ?, telephone = ?, statut = 'actif'
       WHERE id = ?`,
      ['Mohamed Coulibaly', 'Mohamed', hash, PHONE_STORE, existing.id],
    );
    return existing.id;
  }
  return runSql(
    db,
    `INSERT INTO proprietaires (nom, prenom, email, password_hash, telephone, plan, statut)
     VALUES (?, ?, ?, ?, ?, 'premium', 'actif')`,
    ['Mohamed Coulibaly', 'Mohamed', PROPRIO_EMAIL, hash, PHONE_STORE],
  ).lastInsertRowid;
}

function assurerHorairesEtCreneaux(db, terrainId) {
  const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  for (const jour of jours) {
    const row = queryOne(db, 'SELECT id FROM horaires WHERE terrain_id = ? AND jour = ?', [terrainId, jour]);
    if (row) {
      runSql(db, 'UPDATE horaires SET heure_debut = ?, heure_fin = ?, est_ouvert = 1 WHERE id = ?', ['08:00', '23:00', row.id]);
    } else {
      runSql(db, 'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, 1)', [terrainId, jour, '08:00', '23:00']);
    }
  }
  for (let dayOffset = 1; dayOffset <= 3; dayOffset += 1) {
    const dateStr = ymd(addDays(dayOffset));
    for (const hour of [18, 19, 20, 21]) {
      const debut = `${String(hour).padStart(2, '0')}:00`;
      const fin = `${String(hour + 1).padStart(2, '0')}:00`;
      const exists = queryOne(db, 'SELECT id FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ?', [terrainId, dateStr, debut]);
      if (!exists) {
        runSql(db, "INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, 'libre')", [terrainId, dateStr, debut, fin]);
      }
    }
  }
}

function upsertTerrainMohamed(db, proprioId) {
  const existing = queryOne(
    db,
    `SELECT id FROM terrains WHERE nom = ? OR telephone LIKE '%778261225%' OR telephone LIKE '%77 826 12 25%' LIMIT 1`,
    [TERRAIN_NOM],
  );
  const prix = 8000;
  const commodites = JSON.stringify(['dossards', 'eau', 'vestiaires', 'parking']);
  const description = 'Terrain de test Mohamed — WhatsApp / Wave / OM : 77 826 12 25.';
  if (existing) {
    runSql(
      db,
      `UPDATE terrains SET proprietaire_id = ?, nom = ?, adresse = ?, ville = ?, sport = ?, type = ?,
        prix_heure = ?, prix_entier = ?, prix_moitie = ?, description = ?, telephone = ?,
        is_active = 1, commodites = ?
       WHERE id = ?`,
      [proprioId, TERRAIN_NOM, 'Parcelles Assainies, Dakar', 'Dakar', 'foot', '7v7',
        prix, prix, Math.round(prix * 0.6), description, PHONE_STORE, commodites, existing.id],
    );
    assurerHorairesEtCreneaux(db, existing.id);
    return existing.id;
  }
  const terrainId = Number(runSql(
    db,
    `INSERT INTO terrains (proprietaire_id, nom, adresse, ville, sport, type, prix_heure, description, telephone, photos, is_active, commodites)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [proprioId, TERRAIN_NOM, 'Parcelles Assainies, Dakar', 'Dakar', 'foot', '7v7', prix, description, PHONE_STORE, '[]', commodites],
  ).lastInsertRowid);
  runSql(db, 'UPDATE terrains SET prix_entier = ?, prix_moitie = ? WHERE id = ?', [prix, Math.round(prix * 0.6), terrainId]);
  assurerHorairesEtCreneaux(db, terrainId);
  return terrainId;
}

function upsertGerant(db, hash, terrainId, proprioId) {
  const existing = queryOne(db, 'SELECT id FROM employes WHERE email = ?', [GERANT_EMAIL]);
  if (existing) {
    runSql(
      db,
      `UPDATE employes SET nom = ?, prenom = ?, password_hash = ?, telephone = ?, whatsapp_number = ?,
        is_active = 1, terrain_id = ?, proprietaire_id = ?, must_change_password = 0
       WHERE id = ?`,
      ['Mohamed Coulibaly', 'Mohamed', hash, PHONE_STORE, PHONE_WA, terrainId, proprioId, existing.id],
    );
    return existing.id;
  }
  return runSql(
    db,
    `INSERT INTO employes (proprietaire_id, terrain_id, nom, prenom, email, password_hash, telephone, whatsapp_number, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [proprioId, terrainId, 'Mohamed Coulibaly', 'Mohamed', GERANT_EMAIL, hash, PHONE_STORE, PHONE_WA],
  ).lastInsertRowid;
}

function nettoyerAnciennesResasMohamed(db, joueurId, terrainId) {
  const rows = queryAll(
    db,
    `SELECT id FROM reservations
      WHERE code_reservation LIKE 'TF-MOH-%'
         OR (joueur_id = ? AND (terrain_id = ? OR joueur_telephone LIKE '%826%'))`,
    [joueurId, terrainId],
  );
  for (const row of rows) {
    runSql(db, 'DELETE FROM paiements WHERE reservation_id = ?', [row.id]);
    runSql(db, 'DELETE FROM dus WHERE reservation_id = ?', [row.id]);
    runSql(db, 'DELETE FROM payouts WHERE reservation_id = ?', [row.id]);
    runSql(db, 'DELETE FROM matchs WHERE reservation_id = ?', [row.id]);
    runSql(db, 'DELETE FROM reservations WHERE id = ?', [row.id]);
  }
}

function creerReservationEnAttente(db, { terrainId, joueurId, date, heure, prix }) {
  const heureFin = `${String(Number(heure.slice(0, 2)) + 1).padStart(2, '0')}:00`;
  let creneau = queryOne(
    db,
    'SELECT id FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ?',
    [terrainId, date, heure],
  );
  if (!creneau) {
    const id = runSql(
      db,
      `INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut)
       VALUES (?, ?, ?, ?, 'en_attente_paiement')`,
      [terrainId, date, heure, heureFin],
    ).lastInsertRowid;
    creneau = { id };
  } else {
    runSql(db, "UPDATE creneaux SET statut = 'en_attente_paiement' WHERE id = ?", [creneau.id]);
  }
  const avance = Math.round(prix * 0.125);
  const reservationId = runSql(
    db,
    `INSERT INTO reservations (
      terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
      montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant,
      statut, creneau_id, cree_par, code_reservation
    ) VALUES (?, ?, 'Mohamed Coulibaly', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?, 'joueur', ?)`,
    [
      terrainId, joueurId, PHONE_STORE, date, heure, heureFin,
      prix, prix, avance, avance, prix - avance, prix - avance,
      creneau.id, `TF-MOH-${date.replace(/-/g, '')}-${heure.slice(0, 2)}`,
    ],
  ).lastInsertRowid;
  return reservationId;
}

/**
 * Crée / met à jour les comptes Mohamed + Arena + résas démo.
 * @param {{ db?: object, silent?: boolean }} [opts]
 */
async function ensureMohamedAccounts(opts = {}) {
  const db = opts.db || (await getDb());
  const silent = Boolean(opts.silent);
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  const joueurId = upsertJoueur(db, hash);
  upsertAdmin(db, hash);
  const proprioId = upsertProprio(db, hash);
  const terrainId = upsertTerrainMohamed(db, proprioId);
  const gerantId = upsertGerant(db, hash, terrainId, proprioId);

  transaction(db, () => {
    enregistrerContrat(db, terrainId, {
      gerant_id: gerantId,
      numeros_identiques_whatsapp: 1,
      payout_mode: 'retrait',
      remboursement_autorise: 0,
      pourcentage_avance: 12.5,
      commission_pourcentage: 10,
    }, { auteurId: gerantId });
  });
  transaction(db, () => {
    enregistrerContrat(db, terrainId, {
      wave_statut: 'verifie',
      om_statut: 'verifie',
      numeros_identiques_whatsapp: 1,
    }, { auteurId: gerantId });
  });

  nettoyerAnciennesResasMohamed(db, joueurId, terrainId);

  const r1 = creerReservationEnAttente(db, {
    terrainId, joueurId, date: ymd(addDays(1)), heure: '18:00', prix: 40000,
  });
  const r2 = creerReservationEnAttente(db, {
    terrainId, joueurId, date: ymd(addDays(2)), heure: '19:00', prix: 40000,
  });

  const c1 = await traiterConfirmationPaytech(db, r1, `TF-${r1}-${Date.now()}-MOH1`);
  const c2 = await traiterConfirmationPaytech(db, r2, `TF-${r2}-${Date.now()}-MOH2`);

  runSql(db, "DELETE FROM notifications WHERE contenu LIKE '%Mohamed%' AND type IN ('confirmation','du_accumule','seed_mohamed')");
  runSql(
    db,
    `INSERT INTO notifications (destinataire_type, destinataire_id, type, canal, contenu, lu)
     VALUES ('user', ?, 'confirmation', 'whatsapp', ?, 0)`,
    [joueurId, `Réservation confirmée (${TERRAIN_NOM}). Avance payée. Présente ton QR au gérant.`],
  );
  runSql(
    db,
    `INSERT INTO notifications (destinataire_type, destinataire_id, type, canal, contenu, lu)
     VALUES ('gerant', ?, 'du_accumule', 'whatsapp', ?, 0)`,
    [gerantId, `Avance joueur Mohamed confirmée sur ${TERRAIN_NOM}. Ouvre Finances pour Retirer.`],
  );

  saveDb();

  const joueur = queryOne(db, 'SELECT id, email, telephone, role, is_active FROM users WHERE email = ?', [JOUEUR_EMAIL]);
  const admin = queryOne(db, 'SELECT id, email, role, is_active FROM users WHERE email = ?', [ADMIN_EMAIL]);
  const gerant = queryOne(db, 'SELECT id, email, telephone, whatsapp_number, terrain_id, is_active FROM employes WHERE email = ?', [GERANT_EMAIL]);
  const terrain = queryOne(db, 'SELECT id, nom, telephone, is_active FROM terrains WHERE id = ?', [terrainId]);
  const contrat = queryOne(db, 'SELECT payout_mode, wave_numero, wave_statut, gerant_id FROM terrains WHERE id = ?', [terrainId]);
  const dus = queryAll(db, 'SELECT id, statut, du_gerant FROM dus WHERE reservation_id IN (?, ?)', [r1, r2]);

  const okLoginJoueur = Boolean(joueur?.id && joueur.is_active && bcrypt.compareSync(DEMO_PASSWORD, queryOne(db, 'SELECT password_hash FROM users WHERE id = ?', [joueur.id]).password_hash));
  const okLoginGerant = Boolean(gerant?.id && gerant.is_active && bcrypt.compareSync(DEMO_PASSWORD, queryOne(db, 'SELECT password_hash FROM employes WHERE id = ?', [gerant.id]).password_hash));
  const okLoginAdmin = Boolean(admin?.id && admin.is_active);

  if (!silent) {
    console.log('\n=== Terrain + comptes Mohamed ===');
    console.log(`Terrain  ${terrain.nom}  id=${terrain.id}  tel=${terrain.telephone}  actif=${terrain.is_active}`);
    console.log(`Joueur   ${joueur.email}  tel=${joueur.telephone}  login=${okLoginJoueur}`);
    console.log(`Gérant   ${gerant.email}  tel=${gerant.telephone}  wa=${gerant.whatsapp_number}  terrain=${gerant.terrain_id}  login=${okLoginGerant}`);
    console.log(`Proprio  ${PROPRIO_EMAIL}`);
    console.log(`Admin    ${ADMIN_EMAIL}  login=${okLoginAdmin}`);
    console.log(`Mot de passe : ${DEMO_PASSWORD}`);
    console.log(`Contrat : mode=${contrat.payout_mode} wave=${contrat.wave_numero} ${contrat.wave_statut}`);
    console.log('Dûs :', dus);
    console.log('Confirm flow :', c1.action, c2.action);
  }

  if (!okLoginJoueur || !okLoginGerant || !okLoginAdmin || contrat.wave_statut !== 'verifie' || !String(terrain.telephone).includes('826')) {
    const err = new Error('ensure-mohamed-accounts : validation login / contrat échouée');
    if (!silent) process.exitCode = 1;
    throw err;
  }

  return {
    joueurId,
    gerantId,
    proprioId,
    terrainId,
    adminId: admin.id,
  };
}

module.exports = {
  ensureMohamedAccounts,
  DEMO_PASSWORD,
  MOHAMED_PHONE_RAW: PHONE_WA,
  MOHAMED_PHONE_STORE: PHONE_STORE,
  JOUEUR_EMAIL,
  GERANT_EMAIL,
  PROPRIO_EMAIL,
  ADMIN_EMAIL,
  TERRAIN_NOM,
};

if (require.main === module) {
  ensureMohamedAccounts().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
