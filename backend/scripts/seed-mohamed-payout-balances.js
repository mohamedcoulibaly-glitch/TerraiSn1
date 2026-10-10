/**
 * Assure comptes Mohamed + solde payout (dûs payable + payins paytech pour caisse).
 * Usage : node scripts/seed-mohamed-payout-balances.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getDb, queryOne, queryAll, runSql, saveDb, transaction } = require('../database');
const {
  ensureMohamedAccounts,
  DEMO_PASSWORD,
  GERANT_EMAIL,
  MOHAMED_PHONE_STORE,
} = require('./ensure-mohamed-accounts');
const PHONE_STORE = MOHAMED_PHONE_STORE || '+221 77 826 12 25';
const { traiterConfirmationPaytech } = require('../payments/flow');
const { portefeuilleTerrain } = require('../services/ledgerService');
const { caisseDisponible } = require('../services/payoutEngine');
const { enregistrerContrat } = require('../services/contratService');

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

function creerReservationEnAttente(db, { terrainId, joueurId, date, heure, prix, code }) {
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
  return runSql(
    db,
    `INSERT INTO reservations (
      terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
      montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant,
      statut, creneau_id, cree_par, code_reservation, canal_paiement
    ) VALUES (?, ?, 'Mohamed Coulibaly', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?, 'joueur', ?, 'wave')`,
    [
      terrainId,
      joueurId,
      PHONE_STORE,
      date,
      heure,
      heureFin,
      prix,
      prix,
      avance,
      avance,
      prix - avance,
      prix - avance,
      creneau.id,
      code,
    ],
  ).lastInsertRowid;
}

async function main() {
  const db = await getDb();
  const accounts = await ensureMohamedAccounts({ db, silent: false });
  const { terrainId, joueurId, gerantId } = accounts;

  transaction(db, () => {
    enregistrerContrat(
      db,
      terrainId,
      {
        gerant_id: gerantId,
        payout_mode: 'retrait',
        remboursement_autorise: 0,
        pourcentage_avance: 12.5,
        commission_pourcentage: 10,
        paiement_production: 1,
        numeros_identiques_whatsapp: 1,
        canal_reversement: 'wave',
      },
      { auteurId: gerantId },
    );
  });
  transaction(db, () => {
    enregistrerContrat(
      db,
      terrainId,
      {
        wave_statut: 'verifie',
        om_statut: 'verifie',
        numeros_identiques_whatsapp: 1,
        paiement_production: 1,
      },
      { auteurId: gerantId },
    );
  });

  const slots = [
    { day: 3, heure: '10:00', prix: 40000 },
    { day: 3, heure: '14:00', prix: 50000 },
    { day: 4, heure: '11:00', prix: 35000 },
    { day: 4, heure: '16:00', prix: 45000 },
    { day: 5, heure: '18:00', prix: 40000 },
  ];

  const created = [];
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const date = ymd(addDays(slot.day));
    const code = `TF-PAYOUT-${ymd(new Date()).replace(/-/g, '')}-${slot.heure.slice(0, 2)}-${i}`;
    try {
      // Remplace une éventuelle résa précédente sur le même code
      const old = queryOne(db, 'SELECT id FROM reservations WHERE code_reservation = ?', [code]);
      if (old) {
        runSql(db, 'DELETE FROM paiements WHERE reservation_id = ?', [old.id]);
        runSql(db, 'DELETE FROM dus WHERE reservation_id = ?', [old.id]);
        runSql(db, 'DELETE FROM payouts WHERE reservation_id = ?', [old.id]);
        runSql(db, 'DELETE FROM matchs WHERE reservation_id = ?', [old.id]);
        runSql(db, 'DELETE FROM reservations WHERE id = ?', [old.id]);
      }

      const resaId = creerReservationEnAttente(db, {
        terrainId,
        joueurId,
        date,
        heure: slot.heure,
        prix: slot.prix,
        code,
      });
      const conf = await traiterConfirmationPaytech(db, resaId, `TF-${resaId}-${Date.now()}-PAYOUT${i}`, {
        canal: 'wave',
      });
      created.push({ resaId, code, action: conf?.action });
    } catch (err) {
      console.warn(`Slot ${slot.heure} J+${slot.day} ignoré: ${err.message}`);
    }
  }

  runSql(
    db,
    `UPDATE dus SET statut = 'payable',
        payable_at = COALESCE(payable_at, CURRENT_TIMESTAMP),
        gerant_id = COALESCE(gerant_id, ?),
        wave_numero = COALESCE(NULLIF(wave_numero, ''), '221778261225'),
        om_numero = COALESCE(NULLIF(om_numero, ''), '221778261225'),
        canal_reversement = COALESCE(NULLIF(canal_reversement, ''), 'wave'),
        payout_mode = 'retrait'
     WHERE terrain_id = ? AND statut IN ('en_fenetre', 'payable', 'echec')`,
    [gerantId, terrainId],
  );
  saveDb();

  const dus = queryAll(
    db,
    `SELECT id, reservation_id, statut, du_gerant, avance, commission, payout_mode, wave_numero
     FROM dus WHERE terrain_id = ? ORDER BY id DESC LIMIT 20`,
    [terrainId],
  );
  const portefeuille = portefeuilleTerrain(db, terrainId);
  const caisse = caisseDisponible(db);
  const terrain = queryOne(
    db,
    `SELECT id, nom, payout_mode, wave_statut, om_statut, wave_numero, paiement_production
     FROM terrains WHERE id = ?`,
    [terrainId],
  );

  console.log('\n=== Soldes Mohamed (payout ready) ===');
  console.log(`Gérant       : ${GERANT_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`Terrain      : ${terrain?.nom} (#${terrainId})`);
  console.log(`Wave         : ${terrain?.wave_numero} (${terrain?.wave_statut})`);
  console.log(`Mode payout  : ${terrain?.payout_mode} | production=${terrain?.paiement_production}`);
  console.log(`Pay-ins ajoutés: ${created.length}`, created.map((c) => c.code).join(', '));
  console.log('Portefeuille :', {
    disponible: portefeuille.solde_disponible,
    en_fenetre: portefeuille.solde_en_fenetre,
    verse: portefeuille.total_verse,
    bouton_retirer: portefeuille.bouton_retirer,
  });
  console.log('Caisse plateforme:', caisse);
  console.log('Dûs:');
  for (const d of dus) {
    console.log(`  #${d.id} resa=${d.reservation_id} ${d.statut} du=${d.du_gerant} FCFA (avance ${d.avance})`);
  }

  if (!portefeuille.bouton_retirer || Number(portefeuille.solde_disponible) <= 0) {
    console.error('\nÉCHEC: solde non retirable — vérifie Wave vérifié + dûs payable.');
    process.exit(1);
  }
  console.log('\nOK — connecte-toi en gérant et ouvre Finances → Retirer.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
