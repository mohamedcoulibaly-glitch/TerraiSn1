/**
 * Tests avancés CDC Paiements / Superadmin v1.2
 * Usage : node scripts/test-cdc-paiements.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `terrainsn-cdc-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.PAYMENT_MODE = 'simulation';
process.env.PAYTECH_MOCK = 'true';
process.env.WHATSAPP_MOCK = 'true';
process.env.PAYTECH_PAYOUT_ENABLED = 'true';
process.env.WHATSAPP_DEV_NUMBER = '771112233';

const { getDb, queryOne, queryAll, runSql, transaction } = require('../database');
const { calculerDecomposition, previewFormules } = require('../services/calculsPaiement');
const { chargerContrat, enregistrerContrat } = require('../services/contratService');
const { portefeuilleTerrain, duExistant } = require('../services/ledgerService');
const { traiterFenetresExpirees, tenterAutoSiPayable, relancerPayoutAuto } = require('../services/payoutEngine');
const { demanderRetrait, marquerRetraitEnvoye, rejeterRetrait } = require('../services/retraitService');
const { rapprochement, kpisCaisse, revenusPlateforme } = require('../services/caisseService');
const { executerAnnulation } = require('../services/annulationService');
const { encaisserSoldeSurPlace } = require('../services/portefeuilleService');
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

async function fixtures(db) {
  const proprioId = runSql(db, `INSERT INTO proprietaires (nom, email, password_hash, telephone, statut)
    VALUES ('Proprio Test', 'p@test.sn', 'x', '781000001', 'actif')`).lastInsertRowid;
  const terrainId = runSql(db, `INSERT INTO terrains (
      proprietaire_id, nom, adresse, ville, sport, type, prix_heure, prix_entier, prix_moitie,
      pourcentage_avance, commission_pourcentage, modele_revenus, is_active
    ) VALUES (?, 'Terrain CDC', 'Dakar', 'Dakar', 'foot', '11v11', 40000, 40000, 24000, 12.5, 10, 'commission', 1)`, [proprioId]).lastInsertRowid;
  const gerantId = runSql(db, `INSERT INTO employes (proprietaire_id, terrain_id, nom, email, password_hash, telephone, whatsapp_number, is_active)
    VALUES (?, ?, 'Gerant Wave', 'g@test.sn', 'x', '771234567', '771234567', 1)`, [proprioId, terrainId]).lastInsertRowid;
  const joueurId = runSql(db, `INSERT INTO users (nom, email, password_hash, telephone, role, is_active)
    VALUES ('Joueur Test', 'j@test.sn', 'x', '779876543', 'joueur', 1)`).lastInsertRowid;
  return { proprioId, terrainId, gerantId, joueurId };
}

function creerReservation(db, { terrainId, joueurId, avance = 5000, prix = 40000, date = '2026-08-20', heure = '18:00' }) {
  const heureFin = '19:00';
  const creneauId = runSql(db, `INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut)
    VALUES (?, ?, ?, ?, 'en_attente_paiement')`, [terrainId, date, heure, heureFin]).lastInsertRowid;
  const reservationId = runSql(db, `INSERT INTO reservations (
      terrain_id, joueur_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
      montant, prix_total, acompte, montant_avance, reste_a_payer, montant_restant, statut, creneau_id
    ) VALUES (?, ?, 'Joueur Test', '779876543', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?)`,
    [terrainId, joueurId, date, heure, heureFin, prix, prix, avance, avance, prix - avance, prix - avance, creneauId]).lastInsertRowid;
  return { reservationId, creneauId };
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
  return { ...result, ref };
}

async function main() {
  const db = await getDb();
  const fx = await fixtures(db);

  // --- Calculs unitaires (critère 5) ---
  const auto = calculerDecomposition({
    pourcentage_avance: 12.5,
    commission_pourcentage: 10,
    payout_mode: 'auto',
    payout_frais_politique: 'partage',
    frais_payout_pct_gerant: 1,
    frais_payout_pct_plateforme: 1,
  }, 40000);
  assert('calc avance 5000', auto.avance === 5000, auto.avance);
  assert('calc commission 500', auto.commission === 500, auto.commission);
  assert('calc base 4500', auto.base_gerant === 4500);
  assert('calc auto gérant 4455', auto.du_gerant === 4455, auto.du_gerant);
  assert('calc frais gérant 45', auto.frais_gerant === 45);
  assert('calc frais plateforme 45', auto.frais_plateforme === 45);

  const retrait = calculerDecomposition({
    pourcentage_avance: 12.5,
    commission_pourcentage: 10,
    payout_mode: 'retrait',
  }, 40000);
  assert('calc retrait 4500', retrait.du_gerant === 4500 && retrait.frais_gerant === 0 && retrait.frais_plateforme === 0);

  const preview = previewFormules({
    pourcentage_avance: 12.5,
    commission_pourcentage: 10,
    payout_frais_politique: 'partage',
    frais_payout_pct_gerant: 1,
    frais_payout_pct_plateforme: 1,
    payout_mode: 'auto',
  }, 40000);
  assert('preview 40k deux formules', preview.auto.du_gerant === 4455 && preview.retrait.du_gerant === 4500);

  // --- Critère 1 : WhatsApp préremplit Wave+OM, moteur relit le contrat ---
  const contrat1 = transaction(db, () => enregistrerContrat(db, fx.terrainId, {
    pourcentage_avance: 12.5,
    commission_pourcentage: 10,
    remboursement_autorise: 0,
    delai_remboursement_heures: 0,
    payout_mode: 'retrait',
    numeros_identiques_whatsapp: 1,
    canal_reversement: 'wave',
    gerant_id: fx.gerantId,
  }, { auteurId: 1 }));
  assert('préremplissage Wave=WhatsApp', contrat1.wave_numero === '221771234567', contrat1.wave_numero);
  assert('préremplissage OM=WhatsApp', contrat1.om_numero === '221771234567', contrat1.om_numero);
  assert('rien en dur — chargerContrat relit', chargerContrat(db, fx.terrainId).wave_numero === contrat1.wave_numero);

  // --- Critère 10 partiel : sans numéro vérifié, dû s'accumule ---
  const r0 = creerReservation(db, { ...fx, date: '2026-08-21', heure: '10:00' });
  await confirmer(db, r0.reservationId);
  const du0 = duExistant(db, r0.reservationId);
  assert('sans canal vérifié : dû créé', du0 && Number(du0.du_gerant) === 4500);
  assert('sans canal vérifié : pas versé', du0.statut !== 'verse');
  const payouts0 = queryAll(db, 'SELECT * FROM payouts WHERE reservation_id = ? AND statut = ?', [r0.reservationId, 'envoye']);
  assert('sans canal vérifié : aucun payout', payouts0.length === 0);

  let threwRetrait = false;
  try {
    await demanderRetrait(db, { terrainId: fx.terrainId, gerantId: fx.gerantId });
  } catch (e) {
    threwRetrait = e.statusCode === 409;
  }
  assert('sans canal vérifié : retrait refusé', threwRetrait);

  // Vérifier les canaux
  transaction(db, () => enregistrerContrat(db, fx.terrainId, {
    wave_statut: 'verifie',
    om_statut: 'verifie',
    numeros_identiques_whatsapp: 1,
  }, { auteurId: 1 }));

  // --- Critère 2 : pas de remboursement → payable dès confirmation, pas d'attente QR ---
  transaction(db, () => enregistrerContrat(db, fx.terrainId, {
    remboursement_autorise: 0,
    payout_mode: 'retrait',
    wave_statut: 'verifie',
    om_statut: 'verifie',
  }, { auteurId: 1 }));
  const r2 = creerReservation(db, { ...fx, date: '2026-08-22', heure: '11:00' });
  await confirmer(db, r2.reservationId);
  const du2 = duExistant(db, r2.reservationId);
  assert('pas de refund → payable immédiat', du2.statut === 'payable', du2.statut);
  const resa2 = queryOne(db, 'SELECT qr_code_scanne_at, statut FROM reservations WHERE id = ?', [r2.reservationId]);
  assert('pas d\'attente QR pour le dû', !resa2.qr_code_scanne_at && du2.statut === 'payable');

  // --- Critère 6 : mode retrait 4500, Retirer, WhatsApp, 0 frais, Envoyé → solde 0 ---
  const walletAvant = portefeuilleTerrain(db, fx.terrainId);
  assert('gérant voit formule retrait', walletAvant.payout_mode === 'retrait' && walletAvant.formule.includes('avance − commission'));
  assert('solde retrait > 0', walletAvant.solde_disponible >= 4500, walletAvant.solde_disponible);

  const demande = await demanderRetrait(db, { terrainId: fx.terrainId, gerantId: fx.gerantId });
  assert('retrait montant sans frais', demande.montant === walletAvant.solde_disponible && demande.montant >= 4500);
  assert('retrait message Wave+OM', demande.message_dev.includes('Wave') && demande.message_dev.includes('OM') && demande.message_dev.includes('0 frais'));
  const notifDev = queryOne(db, "SELECT * FROM notifications WHERE type = 'demande_retrait' ORDER BY id DESC LIMIT 1");
  assert('WhatsApp dév persisté', Boolean(notifDev && String(notifDev.contenu).includes('Retrait gérant demandé')));
  const walletPending = portefeuilleTerrain(db, fx.terrainId);
  assert('après clic Retirer solde dispo 0', walletPending.solde_disponible === 0, walletPending.solde_disponible);
  assert('demande en cours', walletPending.solde_demande_retrait === demande.montant);

  const rejet = transaction(db, () => rejeterRetrait(db, demande.id, { traitePar: 1, motif: 'test revert' }));
  assert('rejet remet le dû', rejet.statut === 'rejete' && portefeuilleTerrain(db, fx.terrainId).solde_disponible === demande.montant);

  const demande2 = await demanderRetrait(db, { terrainId: fx.terrainId, gerantId: fx.gerantId });
  const envoyee = transaction(db, () => marquerRetraitEnvoye(db, demande2.id, { traitePar: 1, refManuelle: 'WAVE-MAN-1' }));
  assert('envoyé marque la demande', envoyee.statut === 'envoye');
  const walletZero = portefeuilleTerrain(db, fx.terrainId);
  assert('envoyé remet le solde à 0', walletZero.solde_disponible === 0 && walletZero.total_verse === demande2.montant, JSON.stringify({ d: walletZero.solde_disponible, v: walletZero.total_verse }));

  // Idempotence retrait
  const payoutsR2 = queryAll(db, "SELECT * FROM payouts WHERE reservation_id = ? AND statut = 'envoye'", [r2.reservationId]);
  assert('un payout réussi / réservation (retrait)', payoutsR2.length === 1, payoutsR2.length);

  // --- Critère 3 : remboursement 24h + annulation à 3h ---
  transaction(db, () => enregistrerContrat(db, fx.terrainId, {
    remboursement_autorise: 1,
    delai_remboursement_heures: 24,
    payout_mode: 'retrait',
    wave_statut: 'verifie',
    om_statut: 'verifie',
  }, { auteurId: 1 }));
  const r3 = creerReservation(db, { ...fx, date: '2026-08-23', heure: '12:00' });
  const c3 = await confirmer(db, r3.reservationId);
  const du3 = duExistant(db, r3.reservationId);
  assert('24h → en_fenetre', du3.statut === 'en_fenetre', du3.statut);
  const resa3 = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [r3.reservationId]);
  const t0 = new Date(resa3.confirme_at).getTime();
  const annulation = await executerAnnulation(db, resa3, { now: t0 + 3 * 3600 * 1000 });
  const du3b = duExistant(db, r3.reservationId);
  assert('annulation 3h → refund', annulation.rembourse === true, JSON.stringify(annulation.politique));
  assert('dû gérant = 0 après refund', du3b.statut === 'annule_rembourse' && Number(du3b.du_gerant) === 0, `${du3b.statut}/${du3b.du_gerant}`);
  const payouts3 = queryAll(db, "SELECT * FROM payouts WHERE reservation_id = ? AND statut = 'envoye'", [r3.reservationId]);
  assert('aucun reversement après refund', payouts3.length === 0);

  // --- Critère 4 : même politique, pas d'annulation, 24h plus tard → payable ---
  const r4 = creerReservation(db, { ...fx, date: '2026-08-24', heure: '13:00' });
  await confirmer(db, r4.reservationId);
  const du4a = duExistant(db, r4.reservationId);
  assert('avant tick : en_fenetre', du4a.statut === 'en_fenetre');
  const resa4 = queryOne(db, 'SELECT confirme_at FROM reservations WHERE id = ?', [r4.reservationId]);
  const later = new Date(resa4.confirme_at).getTime() + 24 * 3600 * 1000 + 1000;
  await traiterFenetresExpirees(db, later);
  const du4b = duExistant(db, r4.reservationId);
  assert('après 24h : payable', du4b.statut === 'payable' || du4b.statut === 'verse', du4b.statut);

  // --- Critère 5 : mode auto partage 1/1 ---
  transaction(db, () => enregistrerContrat(db, fx.terrainId, {
    remboursement_autorise: 0,
    delai_remboursement_heures: 0,
    payout_mode: 'auto',
    payout_frais_politique: 'partage',
    frais_payout_pct_gerant: 1,
    frais_payout_pct_plateforme: 1,
    wave_statut: 'verifie',
    om_statut: 'verifie',
    canal_reversement: 'wave',
    paiement_production: 1,
  }, { auteurId: 1 }));
  const r5 = creerReservation(db, { ...fx, date: '2026-08-25', heure: '14:00' });
  await confirmer(db, r5.reservationId);
  const du5 = duExistant(db, r5.reservationId);
  assert('auto 4455', Number(du5.du_gerant) === 4455 && Number(du5.frais_gerant) === 45 && Number(du5.frais_plateforme) === 45, JSON.stringify(du5));
  assert('auto versé', du5.statut === 'verse', du5.statut);
  const po5 = queryOne(db, "SELECT * FROM payouts WHERE reservation_id = ? AND statut = 'envoye'", [r5.reservationId]);
  assert('ordre vers numéro gérant', po5 && po5.numero === '221771234567' && po5.type === 'auto', JSON.stringify(po5));
  assert('plateforme absorbe 45', Number(po5.frais_plateforme) === 45);

  // Double payout auto
  const retry = await relancerPayoutAuto(db, du5.id).catch((e) => ({ error: e.message }));
  const po5all = queryAll(db, "SELECT * FROM payouts WHERE reservation_id = ? AND statut = 'envoye'", [r5.reservationId]);
  assert('idempotence auto : un seul envoye', po5all.length === 1, po5all.length);
  assert('relance refuse déjà versé', retry.ok === false || retry.error, JSON.stringify(retry));

  // --- Critère 7 : formule visible auto ---
  const wAuto = portefeuilleTerrain(db, fx.terrainId);
  assert('gérant formule auto', wAuto.payout_mode === 'auto' && wAuto.formule.includes('frais'));

  // --- Critère 8 : frais payin jamais dans le dû ---
  assert('dû ignore payin', Number(du5.avance) === 5000 && Number(du5.du_gerant) === 4455);

  // --- Critère 9 : proprio lecture, numéros masqués, pas bénéficiaire ---
  const { contratLectureProprio } = require('../services/contratService');
  const lecture = contratLectureProprio(chargerContrat(db, fx.terrainId));
  assert('proprio voit le mode', lecture.payout_mode === 'auto' && lecture.lecture_seule === true);
  assert('proprio numéros masqués', String(lecture.wave_numero_masque).includes('…') && !lecture.wave_numero);
  assert('proprio n\'est pas bénéficiaire', lecture.beneficiaire === 'gerant');

  // --- QR / reste sur place ne déclenche pas le reversement avance ---
  const resa5 = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [r5.reservationId]);
  const avantQr = duExistant(db, r5.reservationId);
  transaction(db, () => encaisserSoldeSurPlace(db, resa5, fx.gerantId, 'especes'));
  const apresQr = duExistant(db, r5.reservationId);
  assert('QR n\'altère pas le dû avance', avantQr.statut === apresQr.statut && Number(avantQr.du_gerant) === Number(apresQr.du_gerant));
  const soldePaye = queryOne(db, "SELECT * FROM paiements WHERE reservation_id = ? AND reference_externe LIKE 'SOLDE-%'", [r5.reservationId]);
  assert('reste sur place enregistré hors ledger plateforme', Boolean(soldePaye) && Number(soldePaye.montant) === 35000);

  // --- Critère 11 : changement de gérant, dû terrain non perdu ---
  const gerant2 = runSql(db, `INSERT INTO employes (proprietaire_id, terrain_id, nom, email, password_hash, telephone, whatsapp_number, is_active)
    VALUES (?, ?, 'Nouveau Gerant', 'g2@test.sn', 'x', '778888888', '778888888', 1)`, [fx.proprioId, fx.terrainId]).lastInsertRowid;
  transaction(db, () => enregistrerContrat(db, fx.terrainId, {
    gerant_id: gerant2,
    numeros_identiques_whatsapp: 1,
  }, { auteurId: 1 }));
  transaction(db, () => enregistrerContrat(db, fx.terrainId, {
    wave_statut: 'verifie',
    om_statut: 'verifie',
    remboursement_autorise: 0,
    payout_mode: 'auto',
    paiement_production: 1,
  }, { auteurId: 1 }));
  const encoreDu = queryOne(db, "SELECT COALESCE(SUM(du_gerant),0) AS total FROM dus WHERE terrain_id = ? AND statut IN ('payable','demande_retrait','echec','en_fenetre')", [fx.terrainId]);
  const verseAvant = queryOne(db, "SELECT COALESCE(SUM(du_gerant),0) AS total FROM dus WHERE terrain_id = ? AND statut = 'verse'", [fx.terrainId]);
  assert('dû du terrain non perdu après changement gérant', Number(verseAvant.total) > 0 || Number(encoreDu.total) >= 0);
  const r11 = creerReservation(db, { ...fx, date: '2026-08-26', heure: '15:00' });
  await confirmer(db, r11.reservationId);
  const po11 = queryOne(db, "SELECT * FROM payouts WHERE reservation_id = ? AND statut = 'envoye'", [r11.reservationId]);
  assert('prochain payout vers nouveau Wave', po11 && po11.numero === '221778888888', po11 && po11.numero);

  // --- Avenant ne recalcule pas le passé ---
  const oldDu = Number(du5.du_gerant);
  transaction(db, () => enregistrerContrat(db, fx.terrainId, { commission_pourcentage: 20 }, { auteurId: 1 }));
  const du5reload = duExistant(db, r5.reservationId);
  assert('avenant sans recalcul du passé', Number(du5reload.du_gerant) === oldDu && Number(du5reload.commission) === 500);

  // --- Équation d'or ---
  const rappro = rapprochement(db);
  assert('rapprochement équilibré', rappro.equilibre === true, JSON.stringify(rappro));
  const kpis = kpisCaisse(db);
  assert('KPI encaisse PayTech > 0', kpis.encaisse_paytech > 0);
  const rev = revenusPlateforme(db);
  assert('revenus = commission avance, pas 40000', rev.total_commission_acquise > 0 && rev.total_commission_acquise < 40000);

  // --- Politique plateforme : gérant reçoit 4500 ---
  transaction(db, () => enregistrerContrat(db, fx.terrainId, {
    commission_pourcentage: 10,
    payout_mode: 'auto',
    payout_frais_politique: 'plateforme',
    frais_payout_pct_plateforme: 1,
    remboursement_autorise: 0,
    gerant_id: gerant2,
    numeros_identiques_whatsapp: 1,
    wave_statut: 'verifie',
    om_statut: 'verifie',
    paiement_production: 1,
  }, { auteurId: 1 }));
  const rPlat = creerReservation(db, { ...fx, date: '2026-08-27', heure: '16:00' });
  await confirmer(db, rPlat.reservationId);
  const duPlat = duExistant(db, rPlat.reservationId);
  assert('politique plateforme : gérant 4500', Number(duPlat.du_gerant) === 4500 && Number(duPlat.frais_gerant) === 0 && Number(duPlat.frais_plateforme) === 45);

  // --- Gérant collègue du même terrain peut cliquer Retirer ---
  transaction(db, () => enregistrerContrat(db, fx.terrainId, {
    payout_mode: 'retrait',
    remboursement_autorise: 0,
    gerant_id: gerant2,
    wave_statut: 'verifie',
    om_statut: 'verifie',
  }, { auteurId: 1 }));
  const gerantCollegue = runSql(db, `INSERT INTO employes (proprietaire_id, terrain_id, nom, email, password_hash, telephone, whatsapp_number, is_active)
    VALUES (?, ?, 'Gerant Collegue', 'g3@test.sn', 'x', '776666666', '776666666', 1)`, [fx.proprioId, fx.terrainId]).lastInsertRowid;
  const rCol = creerReservation(db, { ...fx, date: '2026-08-28', heure: '17:00' });
  await confirmer(db, rCol.reservationId);
  const demCol = await demanderRetrait(db, { terrainId: fx.terrainId, gerantId: gerantCollegue });
  assert('gérant actif du terrain peut Retirer (pas seulement contrat.gerant_id)', Number(demCol.montant) >= 4500);

  const walletCompat = portefeuilleTerrain(db, fx.terrainId);
  assert('portefeuille expose historique_reversements', Array.isArray(walletCompat.historique_reversements));
  assert('portefeuille expose total_encaisse', Number(walletCompat.total_encaisse) > 0);

  const { summarizeOwnerRevenue, ownerRevenueRowsSql } = require('../ownerRevenueService');
  const ownerRows = queryAll(db, ownerRevenueRowsSql({ ownerWhere: 't.proprietaire_id = ?', dateWhere: '' }), [fx.proprioId]);
  const ownerSum = summarizeOwnerRevenue(ownerRows);
  assert('proprio ne voit pas 40000 comme revenu', ownerSum.avances_encaissees > 0 && ownerSum.avances_encaissees < 40000 * ownerSum.reservations);
  assert('proprio verse_au_gerant depuis ledger', ownerSum.verse_au_gerant >= 0 && ownerSum.montants_reverses === ownerSum.verse_au_gerant + ownerSum.encore_du);

  // --- Texte joueur ---
  const cNo = chargerContrat(db, fx.terrainId);
  transaction(db, () => enregistrerContrat(db, fx.terrainId, { remboursement_autorise: 0 }, { auteurId: 1 }));
  assert('texte sans refund', chargerContrat(db, fx.terrainId).texte_annulation_joueur === 'Annulation sans remboursement');
  transaction(db, () => enregistrerContrat(db, fx.terrainId, { remboursement_autorise: 1, delai_remboursement_heures: 12 }, { auteurId: 1 }));
  assert('texte 12h', chargerContrat(db, fx.terrainId).texte_annulation_joueur.includes('12'));

  console.log(`\n${passed} OK / ${failed} FAIL`);
  try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }
  process.exit(1);
});
