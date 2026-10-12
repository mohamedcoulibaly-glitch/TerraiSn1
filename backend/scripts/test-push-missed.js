/**
 * Tests notifications manquées (push_logs) + déclencheurs in-app.
 * Usage : node scripts/test-push-missed.js
 */
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `terrainsn-push-missed-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.PAYMENT_MODE = 'simulation';
process.env.PAYTECH_MOCK = 'true';
process.env.WHATSAPP_MOCK = 'true';

const { createHarness } = require('../test/helpers/harness');
const { seedMohamedCompte, creerReservationMohamed } = require('../test/helpers/dbFixtures');
const { getDb, queryOne, queryAll, runSql } = require('../database');
const pushService = require('../pushService');
const { confirmerPaiementEtNotifier } = require('../payments/flow');
const { rappelsDettesCommission, rappelsFinEssai } = require('../services/rappelsEcheances');

const h = createHarness('push-missed');

async function main() {
  const db = await getDb();
  const fx = seedMohamedCompte(db, { payoutMode: 'retrait' });

  // colonne clique présente
  const cols = queryAll(db, 'PRAGMA table_info(push_logs)').map((c) => c.name);
  h.assert('push_logs.clique existe', cols.includes('clique'));

  // 1. Paiement confirmé → gérant + joueur notifiés (pending = pas d'abonnement push)
  const { reservationId, refCommand } = creerReservationMohamed(db, fx);
  await confirmerPaiementEtNotifier(reservationId, refCommand);

  const gerantMissed = await pushService.listMissedNotifications({ userId: fx.gerantId, accountType: 'employe' });
  h.assert('gérant : nouvelle réservation en notifications manquées',
    gerantMissed.some((n) => n.type === 'nouvelle_reservation' && n.level === 'success'));
  h.assert('gérant : statut pending', gerantMissed.every((n) => n.statut === 'pending'));

  const joueurMissed = await pushService.listMissedNotifications({ userId: fx.joueurId, accountType: 'user' });
  h.assert('joueur : confirmation en notifications manquées',
    joueurMissed.some((n) => n.type === 'reservation_confirmation' && n.level === 'success'));

  // isolation par compte (même id, autre account_type)
  const autre = await pushService.listMissedNotifications({ userId: fx.gerantId, accountType: 'proprietaire' });
  h.assert('isolation account_type', !autre.some((n) => n.type === 'nouvelle_reservation' && n.id === gerantMissed[0].id));

  // 2. Marquer comme vu
  const ids = gerantMissed.map((n) => n.id);
  await pushService.marquerNotificationsVues({ userId: fx.gerantId, accountType: 'employe', ids });
  const after = await pushService.listMissedNotifications({ userId: fx.gerantId, accountType: 'employe' });
  h.assertEqual('gérant : plus rien après seen', after.length, 0);

  // un autre compte ne peut pas marquer
  await pushService.marquerNotificationsVues({ userId: fx.joueurId, accountType: 'user', ids: joueurMissed.map((n) => n.id) });
  const joueurAfter = await pushService.listMissedNotifications({ userId: fx.joueurId, accountType: 'user' });
  h.assertEqual('joueur : plus rien après seen', joueurAfter.length, 0);

  // 3. Fenêtre 24 h
  const vieux = runSql(
    db,
    `INSERT INTO push_logs (user_id, account_type, type_notif, titre, corps, statut, clique, created_at)
     VALUES (?, 'employe', 'test', 'Vieux', 'x', 'pending', 0, datetime('now', '-30 hours'))`,
    [fx.gerantId],
  ).lastInsertRowid;
  const fenetre = await pushService.listMissedNotifications({ userId: fx.gerantId, accountType: 'employe' });
  h.assert('> 24 h exclu', !fenetre.some((n) => n.id === vieux));

  // 4. Anti-doublon par tag
  await pushService.notifyAccount({ userId: fx.gerantId, accountType: 'employe', type: 'match_imminent', titre: 'A', corps: 'b', tag: 'dup-1' });
  await pushService.notifyAccount({ userId: fx.gerantId, accountType: 'employe', type: 'match_imminent', titre: 'A', corps: 'b', tag: 'dup-1' });
  const dups = queryAll(db, "SELECT id FROM push_logs WHERE user_id = ? AND data LIKE '%dup-1%'", [fx.gerantId]);
  h.assertEqual('anti-doublon tag', dups.length, 1);

  // 5. Préférence désactivée
  runSql(db, `INSERT INTO notif_preferences (user_id, account_type, push_nouvelle_resa) VALUES (?, 'employe', 0)`, [fx.gerantId]);
  const skipped = await pushService.notifyAccount({
    userId: fx.gerantId, accountType: 'employe', type: 'nouvelle_reservation', titre: 'x', corps: 'y', prefColumn: 'push_nouvelle_resa',
  });
  h.assert('préférence désactivée → skipped', skipped.skipped === true);

  // 6. Rappels dette (J-3)
  const resa2 = creerReservationMohamed(db, { ...fx, date: '2026-09-16', heure: '19:00' });
  const echeance = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  runSql(
    db,
    `INSERT INTO dettes_commissions
      (terrain_id, gerant_id, reservation_id, montant_commission, montant_avance_manuelle, statut, periode, date_echeance)
     VALUES (?, ?, ?, 1000, 5000, 'en_attente', '2026-10', ?)`,
    [fx.terrainId, fx.gerantId, resa2.reservationId, echeance],
  );
  const n1 = await rappelsDettesCommission();
  const n2 = await rappelsDettesCommission();
  h.assertEqual('dette J-3 envoyée une fois', n1, 1);
  h.assertEqual('dette J-3 pas de doublon', n2, 0);
  const detteNotif = queryOne(db, "SELECT * FROM push_logs WHERE type_notif = 'dette_rappel' AND user_id = ?", [fx.gerantId]);
  h.assert('dette_rappel loggé niveau warning', detteNotif && JSON.parse(detteNotif.data).level === 'warning');

  // 7. Rappel fin d'essai (J-7)
  const fin = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
  runSql(db, 'UPDATE terrains SET mode_essai = 1, essai_fin_at = ?, essai_debut_at = date(?, "-30 days") WHERE id = ?', [fin, fin, fx.terrainId]);
  const e1 = await rappelsFinEssai();
  const e2 = await rappelsFinEssai();
  h.assertEqual('essai fin envoyé une fois', e1, 1);
  h.assertEqual('essai fin pas de doublon', e2, 0);

  h.exitIfFailed();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
