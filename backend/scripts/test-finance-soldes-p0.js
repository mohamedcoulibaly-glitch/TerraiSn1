/**
 * P0 finances : soldes_encaissees = paiements SOLDE-* seulement ;
 * encaisserSoldeSurPlace crédite portefeuille_gerant sans toucher dus.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDb = path.join(os.tmpdir(), `tp-finance-p0-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';

const { getDb, runSql, queryOne, transaction, saveDb } = require('../database');
const { agregatsNetTerrains } = require('../services/financeNetService');
const { encaisserSoldeSurPlace } = require('../services/portefeuilleService');
const { duExistant } = require('../services/ledgerService');

function assert(label, cond, detail) {
  if (!cond) {
    console.error('FAIL', label, detail || '');
    process.exitCode = 1;
    throw new Error(label);
  }
  console.log('OK', label);
}

async function main() {
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);

  const proprioId = runSql(
    db,
    `INSERT INTO users (nom, email, password_hash, role, telephone) VALUES ('Proprio','p@t.sn','x','proprietaire','770000001')`,
  ).lastInsertRowid;
  const terrainId = runSql(
    db,
    `INSERT INTO terrains (proprietaire_id, nom, ville, prix_heure, commission_pourcentage, is_active)
     VALUES (?, 'Terrain Test', 'Dakar', 40000, 10, 1)`,
    [proprioId],
  ).lastInsertRowid;
  const gerantId = runSql(
    db,
    `INSERT INTO employes (proprietaire_id, terrain_id, nom, email, password_hash, telephone, whatsapp_number, is_active)
     VALUES (?, ?, 'Gerant', 'g@t.sn', 'x', '770000002', '770000002', 1)`,
    [proprioId, terrainId],
  ).lastInsertRowid;

  const resaId = runSql(
    db,
    `INSERT INTO reservations
      (terrain_id, joueur_nom, joueur_telephone, date, heure_debut, heure_fin,
       montant, prix_total, montant_avance, acompte, montant_restant, reste_a_payer, statut)
     VALUES (?, 'Joueur', '770000003', ?, '18:00', '19:00',
             40000, 40000, 5000, 5000, 35000, 35000, 'match_joue')`,
    [terrainId, today],
  ).lastInsertRowid;

  // Avant encaissement : soldes = 0 malgré match_joue
  let net = agregatsNetTerrains(db, [terrainId], today, today);
  assert('soldes avant encaissement = 0', Number(net.soldes_encaissees) === 0, net);

  const avantWallet = queryOne(
    db,
    'SELECT solde_disponible FROM portefeuille_gerant WHERE gerant_id = ? AND terrain_id = ?',
    [gerantId, terrainId],
  );
  const avantDu = duExistant(db, resaId);

  const resa = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [resaId]);
  const encaisse = transaction(db, () => encaisserSoldeSurPlace(db, resa, gerantId, 'especes'));
  saveDb();
  assert('encaissé 35000', encaisse === 35000);

  net = agregatsNetTerrains(db, [terrainId], today, today);
  assert('soldes après SOLDE-* = 35000', Number(net.soldes_encaissees) === 35000, net);

  const apresWallet = queryOne(
    db,
    'SELECT solde_disponible, total_encaisse, total_commission_prelevee FROM portefeuille_gerant WHERE gerant_id = ? AND terrain_id = ?',
    [gerantId, terrainId],
  );
  assert('wallet crédité du solde', Number(apresWallet?.solde_disponible || 0) === Number(avantWallet?.solde_disponible || 0) + 35000, apresWallet);
  assert('commission solde = 0', Number(apresWallet?.total_commission_prelevee || 0) === Number(avantWallet?.total_commission_prelevee || 0));

  const apresDu = duExistant(db, resaId);
  assert(
    'dus inchangé (pas de ligne créée)',
    Boolean(!avantDu && !apresDu) || (avantDu && apresDu && Number(avantDu.du_gerant) === Number(apresDu.du_gerant)),
    { avantDu, apresDu },
  );

  const double = transaction(db, () => {
    const again = queryOne(db, 'SELECT * FROM reservations WHERE id = ?', [resaId]);
    return encaisserSoldeSurPlace(db, again, gerantId, 'especes');
  });
  assert('double encaissement = 0', double === 0);

  console.log('\nTous les asserts P0 finances OK');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }
    try { fs.unlinkSync(`${tmpDb}-wal`); } catch { /* ignore */ }
    try { fs.unlinkSync(`${tmpDb}-shm`); } catch { /* ignore */ }
  });
