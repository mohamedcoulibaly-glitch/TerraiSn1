/**
 * Tests d'intégration sensibles : contrat superadmin + modes Babacar + ledger gérant.
 * Usage : node scripts/test-cdc-integration.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `terrainsn-int-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.PAYMENT_MODE = 'simulation';
process.env.PAYTECH_MOCK = 'true';
process.env.WHATSAPP_MOCK = 'true';
process.env.PAYTECH_PAYOUT_ENABLED = 'true';
process.env.WHATSAPP_DEV_NUMBER = '771112233';

const { getDb, queryOne, queryAll, runSql, transaction } = require('../database');
const { chargerContrat, enregistrerContrat, resumeListeTerrain } = require('../services/contratService');
const { portefeuilleTerrain, duExistant } = require('../services/ledgerService');
const { tenterAutoSiPayable } = require('../services/payoutEngine');
const { fileFenetre, filePayable, rapprochement } = require('../services/caisseService');
const { ownerRevenueRowsSql, summarizeOwnerRevenue } = require('../ownerRevenueService');
const { applyMode } = require('../services/modeRevenuService');
const { traiterConfirmationPaytech } = require('../payments/flow');

let failed = 0;
let passed = 0;

function assert(name, cond, extra) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    passed += 1;
    console.log(`OK    ${name}`);
  }
}

async function confirmer(db, reservationId) {
  const ref = `TF-${reservationId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const result = await traiterConfirmationPaytech(db, reservationId, ref);
  if (result.action === 'confirm' && result.ledgerInfo) {
    await tenterAutoSiPayable(db, {
      du: result.ledgerInfo.du,
      contrat: result.ledgerInfo.contrat,
    });
  }
  return result;
}

function creerReservation(db, { terrainId, joueurId, avance = 5000, prix = 40000, date = '2026-09-01', heure = '18:00' }) {
  const creneauId = runSql(db, `INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut)
    VALUES (?, ?, ?, '19:00', 'en_attente_paiement')`, [terrainId, date, heure]).lastInsertRowid;
  return runSql(db, `INSERT INTO reservations (
      terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
      montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant, statut, creneau_id
    ) VALUES (?, ?, 'Joueur', '779876543', ?, ?, '19:00', ?, ?, ?, ?, ?, ?, 'en_attente', ?)`,
    [terrainId, joueurId, date, heure, prix, prix, avance, avance, prix - avance, prix - avance, creneauId]).lastInsertRowid;
}

async function main() {
  const db = await getDb();
  const proprioId = runSql(db, `INSERT INTO proprietaires (nom, email, password_hash, telephone, statut)
    VALUES ('P', 'p@int.sn', 'x', '781000009', 'actif')`).lastInsertRowid;
  const terrainId = runSql(db, `INSERT INTO terrains (
      proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_entier, prix_moitie,
      pourcentage_avance, commission_pourcentage, modele_revenus, is_active
    ) VALUES (?, 'Terrain INT', 'Dakar', 'Dakar', 'foot', '11v11', 40000, 40000, 24000, 12.5, 10, 'commission', 1)`, [proprioId]).lastInsertRowid;
  const gerantId = runSql(db, `INSERT INTO employes (proprietaire_id, terrain_id, nom, email, password_hash, telephone, whatsapp_number, is_active)
    VALUES (?, ?, 'G INT', 'g@int.sn', 'x', '771234567', '771234567', 1)`, [proprioId, terrainId]).lastInsertRowid;
  const joueurId = runSql(db, `INSERT INTO users (nom, email, password_hash, telephone, role, is_active)
    VALUES ('J', 'j@int.sn', 'x', '779876543', 'joueur', 1)`).lastInsertRowid;

  const saved = transaction(db, () => enregistrerContrat(db, terrainId, {
    pourcentage_avance: 12.5,
    commission_pourcentage: 10,
    remboursement_autorise: 0,
    payout_mode: 'auto',
    payout_frais_politique: 'partage',
    frais_payout_pct_gerant: 1,
    frais_payout_pct_plateforme: 1,
    numeros_identiques_whatsapp: 1,
    canal_reversement: 'wave',
    gerant_id: gerantId,
    wave_statut: 'verifie',
    om_statut: 'verifie',
    paiement_production: 0,
  }, { auteurId: 1 }));
  assert('contrat persisté Wave depuis WhatsApp', saved.wave_numero === '221771234567', saved.wave_numero);
  assert('contrat persisté mode auto', saved.payout_mode === 'auto');
  assert('production encore inactive', Number(saved.paiement_production) === 0);

  const rid0 = creerReservation(db, { terrainId, joueurId, date: '2026-09-02', heure: '10:00' });
  await confirmer(db, rid0);
  const du0 = duExistant(db, rid0);
  assert('sans production : dû créé mais pas versé', du0 && du0.statut !== 'verse', du0 && du0.statut);
  const po0 = queryAll(db, "SELECT * FROM payouts WHERE reservation_id = ? AND statut = 'envoye'", [rid0]);
  assert('sans production : aucun payout auto', po0.length === 0, po0.length);

  transaction(db, () => enregistrerContrat(db, terrainId, { paiement_production: 1, wave_statut: 'verifie', om_statut: 'verifie' }, { auteurId: 1 }));
  const rid1 = creerReservation(db, { terrainId, joueurId, date: '2026-09-03', heure: '11:00' });
  await confirmer(db, rid1);
  const du1 = duExistant(db, rid1);
  assert('avec production : payout auto versé', du1.statut === 'verse', du1.statut);

  const waveAvant = chargerContrat(db, terrainId).wave_numero;
  runSql(db, `UPDATE terrains SET acompte = ?, montant_acompte = ?, commission = ?, pourcentage_avance = ?,
    modele_revenus = ?, commission_pourcentage = ? WHERE id = ?`,
    [5000, 5000, 500, 12.5, 'commission', 10, terrainId]);
  const afterTarifs = chargerContrat(db, terrainId);
  assert('PATCH tarifs ne casse pas Wave', afterTarifs.wave_numero === waveAvant, afterTarifs.wave_numero);
  assert('PATCH tarifs ne casse pas payout_mode', afterTarifs.payout_mode === 'auto');

  const terrainRow = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  transaction(db, () => applyMode(db, terrainRow, { mode: 'commission', commission_pourcentage: 12 }, 1));
  const afterMode = chargerContrat(db, terrainId);
  assert('mode revenu Babacar : commission MAJ', afterMode.commission_pourcentage === 12);
  assert('mode revenu Babacar : Wave intact', afterMode.wave_numero === waveAvant);
  assert('mode revenu Babacar : payout_mode intact', afterMode.payout_mode === 'auto');

  runSql(db, 'UPDATE terrains SET remboursement_autorise = ?, delai_remboursement_heures = ? WHERE id = ?', [1, 6, terrainId]);
  const afterPol = chargerContrat(db, terrainId);
  assert('politique annulation sync contrat', afterPol.remboursement_autorise === 1 && afterPol.delai_remboursement_heures === 6);

  transaction(db, () => enregistrerContrat(db, terrainId, {
    remboursement_autorise: 0,
    payout_mode: 'retrait',
    commission_pourcentage: 10,
    wave_statut: 'verifie',
    paiement_production: 1,
  }, { auteurId: 1 }));
  const rid2 = creerReservation(db, { terrainId, joueurId, date: '2026-09-04', heure: '12:00' });
  await confirmer(db, rid2);
  const payable = filePayable(db);
  assert('file payable superadmin voit le dû retrait', payable.some((d) => Number(d.reservation_id) === rid2));
  assert('file fenêtre vide si pas de refund', fileFenetre(db).every((d) => Number(d.reservation_id) !== rid2));

  const wallet = portefeuilleTerrain(db, terrainId, gerantId);
  assert('gérant voit solde retrait', wallet.payout_mode === 'retrait' && wallet.solde_disponible > 0, JSON.stringify({ m: wallet.payout_mode, s: wallet.solde_disponible }));

  const resume = resumeListeTerrain(db, queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]));
  assert('liste terrains expose contrat_resume', resume.contrat_resume && resume.contrat_resume.payout_mode === 'retrait');
  assert('liste terrains Wave/OM vérifiés', resume.contrat_resume.wave_om_verifies === true);

  const ownerRows = queryAll(db, ownerRevenueRowsSql({ ownerWhere: 't.proprietaire_id = ?', dateWhere: '' }), [proprioId]);
  const ownerSum = summarizeOwnerRevenue(ownerRows);
  assert('proprio avances < 40000 par match', ownerSum.avances_encaissees > 0 && ownerSum.avances_encaissees < 40000 * (ownerSum.reservations || 1));
  assert('proprio verse + encore_du = montants_reverses', ownerSum.montants_reverses === ownerSum.verse_au_gerant + ownerSum.encore_du, JSON.stringify(ownerSum));

  const dated = queryAll(
    db,
    ownerRevenueRowsSql({ ownerWhere: 't.proprietaire_id = ?', dateWhere: 'AND r.date >= ?' }),
    ['2026-09-01', proprioId],
  );
  assert('SQL revenus avec filtre date ne plante pas', Array.isArray(dated) && dated.length >= 1);

  const essaiTerrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  transaction(db, () => applyMode(db, essaiTerrain, { mode: 'essai', essai_duree_jours: 14 }, 1));
  const essai = queryOne(db, 'SELECT mode_essai, payout_mode, wave_numero FROM terrains WHERE id = ?', [terrainId]);
  assert('essai Babacar n\'efface pas Wave', essai.wave_numero === waveAvant && essai.payout_mode === 'retrait');
  const ridEssai = creerReservation(db, { terrainId, joueurId, date: '2026-09-05', heure: '13:00' });
  await confirmer(db, ridEssai);
  assert('essai : le joueur paie quand même, dû créé', Boolean(duExistant(db, ridEssai)));

  const rappro = rapprochement(db);
  assert('rapprochement toujours équilibré après mix Babacar', rappro.equilibre === true, JSON.stringify(rappro));

  console.log(`\n${passed} OK / ${failed} FAIL`);
  try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }
  process.exit(1);
});
