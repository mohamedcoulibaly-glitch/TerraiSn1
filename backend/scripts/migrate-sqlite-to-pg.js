/**
 * One-shot : copie terrainsn.db (SQLite) → PostgreSQL (DATABASE_URL).
 * Préserve les IDs et le contenu exact des tables.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { Pool } = require('pg');
const { getDb } = require('../database');

const SQLITE_PATH = path.resolve(__dirname, '..', 'terrainsn.db');

const TABLE_ORDER = [
  'users',
  'proprietaires',
  'terrains',
  'employes',
  'horaires',
  'commodites',
  'blocages_groupes',
  'blocages_creneaux',
  'encaissements_blocages',
  'creneaux',
  'reservations',
  'paiements',
  'matchs',
  'auth_otps',
  'tarifs_dynamiques',
  'regles_tarifs',
  'propositions_grille_tarifs',
  'portefeuille_gerant',
  'reversements',
  'abonnements',
  'terrain_photos',
  'terrain_commodites',
  'audit_photos',
  'audit_commodites',
  'terrain_features',
  'dettes_commissions',
  'audit_dette',
  'plateforme_settings',
  'mode_revenu_history',
  'activite_gerant',
  'score_confiance',
  'gerants_terrains',
  'planning_garde',
  'audit_gerants_terrain',
  'sessions_gerant_actives',
  'avis',
  'notifications',
  'push_subscriptions',
  'push_preferences',
  'reservation_reminders',
  'audit_logs',
];

function sqliteQueryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function main() {
  if (!fs.existsSync(SQLITE_PATH)) {
    throw new Error(`Fichier introuvable: ${SQLITE_PATH}`);
  }

  console.log('📦 Lecture SQLite:', SQLITE_PATH);
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database(fs.readFileSync(SQLITE_PATH));

  const sqliteTables = new Set(
    sqliteQueryAll(sqlite, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(
      (r) => r.name,
    ),
  );
  console.log(`   ${sqliteTables.size} tables SQLite`);

  await getDb(); // assure schéma PG
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL || 'postgresql://terrainsn:terrainsn@localhost:5433/terrainsn',
  });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET session_replication_role = replica');

    const pgTablesRes = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const pgTables = new Set(pgTablesRes.rows.map((r) => r.tablename));

    const ordered = [
      ...TABLE_ORDER.filter((t) => sqliteTables.has(t) && pgTables.has(t)),
      ...[...sqliteTables].filter((t) => !TABLE_ORDER.includes(t) && pgTables.has(t)).sort(),
    ];

    // Vide PG (ordre inverse pour FK, CASCADE pour rester safe)
    const toTruncate = ordered.filter((t) => pgTables.has(t));
    if (toTruncate.length) {
      await client.query(`TRUNCATE TABLE ${toTruncate.map(quoteIdent).join(', ')} RESTART IDENTITY CASCADE`);
      console.log(`🧹 Truncate ${toTruncate.length} tables PG`);
    }

    let totalRows = 0;
    for (const table of ordered) {
      const rows = sqliteQueryAll(sqlite, `SELECT * FROM ${table}`);
      if (!rows.length) {
        console.log(`   — ${table}: 0`);
        continue;
      }

      const colsRes = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [table],
      );
      const pgCols = new Set(colsRes.rows.map((r) => r.column_name));
      const cols = Object.keys(rows[0]).filter((c) => pgCols.has(c));
      if (!cols.length) {
        console.warn(`   ⚠ ${table}: aucune colonne commune, skip`);
        continue;
      }

      const colList = cols.map(quoteIdent).join(', ');
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const insertSql = `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${placeholders})`;

      for (const row of rows) {
        const values = cols.map((c) => {
          const v = row[c];
          if (v === undefined) return null;
          return v;
        });
        await client.query(insertSql, values);
      }
      totalRows += rows.length;
      console.log(`   ✓ ${table}: ${rows.length}`);
    }

    // Reset sequences SERIAL (tables avec colonne id entière)
    for (const table of ordered) {
      const colCheck = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id'
           AND data_type IN ('integer', 'bigint', 'smallint')`,
        [table],
      );
      if (!colCheck.rowCount) continue;
      const seqRes = await client.query(`SELECT pg_get_serial_sequence($1, 'id') AS seq`, [table]);
      const seq = seqRes.rows[0]?.seq;
      if (!seq) continue;
      await client.query(
        `SELECT setval($1::regclass, COALESCE((SELECT MAX(id) FROM ${quoteIdent(table)}), 1), true)`,
        [seq],
      );
    }

    await client.query('SET session_replication_role = DEFAULT');
    await client.query('COMMIT');
    console.log(`\n✅ Migration terminée : ${totalRows} lignes copiées depuis terrainsn.db`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
