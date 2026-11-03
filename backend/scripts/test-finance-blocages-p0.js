/**
 * Vérifie que agregatsEncaissementsBlocages compte ABONNEMENT / TOURNOI.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDb = path.join(os.tmpdir(), `tp-blocages-p0-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.NODE_ENV = 'test';

const { getDb, runSql, saveDb } = require('../database');
const { agregatsEncaissementsBlocages } = require('../services/financeNetService');

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
    `INSERT INTO users (nom, email, password_hash, role, telephone) VALUES ('P','p2@t.sn','x','proprietaire','770000011')`,
  ).lastInsertRowid;
  const terrainId = runSql(
    db,
    `INSERT INTO terrains (proprietaire_id, nom, ville, prix_heure, commission_pourcentage, is_active)
     VALUES (?, 'T', 'Dakar', 40000, 10, 1)`,
    [proprioId],
  ).lastInsertRowid;
  const gerantId = runSql(
    db,
    `INSERT INTO employes (proprietaire_id, terrain_id, nom, email, password_hash, telephone, whatsapp_number, is_active)
     VALUES (?, ?, 'G', 'g2@t.sn', 'x', '770000012', '770000012', 1)`,
    [proprioId, terrainId],
  ).lastInsertRowid;

  const aboId = `abo-${Date.now()}`;
  const tournoiId = `tournoi-${Date.now()}`;
  runSql(
    db,
    `INSERT INTO blocages_groupes (id, terrain_id, employe_id, type_blocage, libelle, montant)
     VALUES (?, ?, ?, 'ABONNEMENT', 'Abo test', 100000)`,
    [aboId, terrainId, gerantId],
  );
  runSql(
    db,
    `INSERT INTO blocages_groupes (id, terrain_id, employe_id, type_blocage, libelle, montant)
     VALUES (?, ?, ?, 'TOURNOI', 'Tournoi test', 50000)`,
    [tournoiId, terrainId, gerantId],
  );

  runSql(
    db,
    `INSERT INTO encaissements_blocages (groupe_id, terrain_id, employe_id, montant, date_encaissement)
     VALUES (?, ?, ?, 40000, ?)`,
    [aboId, terrainId, gerantId, today],
  );
  runSql(
    db,
    `INSERT INTO encaissements_blocages (groupe_id, terrain_id, employe_id, montant, date_encaissement)
     VALUES (?, ?, ?, 25000, ?)`,
    [tournoiId, terrainId, gerantId, today],
  );
  saveDb();

  const empty = agregatsEncaissementsBlocages(db, [terrainId], '2099-01-01', '2099-01-01');
  assert('période vide = 0', empty.encaisse_blocages === 0, empty);

  const agg = agregatsEncaissementsBlocages(db, [terrainId], today, today);
  assert('abo = 40000', agg.encaisse_abonnements === 40000, agg);
  assert('tournoi = 25000', agg.encaisse_tournois === 25000, agg);
  assert('total = 65000', agg.encaisse_blocages === 65000, agg);

  console.log('\nTous les asserts blocages OK');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }
  });
