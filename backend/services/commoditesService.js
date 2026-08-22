const { queryAll, queryOne, runSql } = require('../database');
const { logCommoditeAction } = require('./auditCommodites');

const CLE_RE = /^[a-z][a-z0-9_]*$/;
const ICONE_RE = /^[A-Z][A-Za-z0-9]+$/;

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function listCommodites(database, { actif } = {}) {
  if (actif === 1 || actif === 0) {
    return await queryAll(database, 'SELECT * FROM commodites WHERE actif = ? ORDER BY ordre ASC, id ASC', [actif]);
  }
  return await queryAll(database, 'SELECT * FROM commodites ORDER BY ordre ASC, id ASC');
}

async function getCommodite(database, id) {
  return await queryOne(database, 'SELECT * FROM commodites WHERE id = ?', [Number(id)]);
}

async function createCommodite(database, body, actor) {
  const cle = String(body?.cle || '').trim();
  const label_fr = String(body?.label_fr || '').trim();
  const icone = String(body?.icone || '').trim();
  const description = body?.description == null ? null : String(body.description).trim();
  const ordre = Number.isFinite(Number(body?.ordre)) ? Number(body.ordre) : 99;
  if (!CLE_RE.test(cle)) throw httpError('Clé invalide (snake_case, ex: eclairage)');
  if (!label_fr) throw httpError('Le label français est obligatoire');
  if (!ICONE_RE.test(icone)) throw httpError('Icône Lucide invalide (ex: Flag)');
  const exists = await queryOne(database, 'SELECT id FROM commodites WHERE cle = ?', [cle]);
  if (exists) throw httpError('Cette clé existe déjà');
  await runSql(
    database,
    `INSERT INTO commodites (cle, label_fr, icone, description, actif, ordre, modifiable_gerant, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [cle, label_fr, icone, description, ordre, body?.modifiable_gerant === 0 || body?.modifiable_gerant === false ? 0 : 1],
  );
  const created = await queryOne(database, 'SELECT * FROM commodites WHERE cle = ?', [cle]);
  await logCommoditeAction(database, {
    commodite_id: created.id,
    action: 'creation_commodite',
    fait_par: actor?.id,
    role: actor?.role,
    detail: `Création ${cle} — ${label_fr}`,
  });
  return created;
}

async function updateCommodite(database, id, body, actor) {
  const current = await getCommodite(database, id);
  if (!current) throw httpError('Commodité introuvable', 404);
  const label_fr = body?.label_fr == null ? current.label_fr : String(body.label_fr).trim();
  const icone = body?.icone == null ? current.icone : String(body.icone).trim();
  const description = body?.description === undefined ? current.description : (body.description == null ? null : String(body.description).trim());
  const ordre = body?.ordre == null ? current.ordre : Number(body.ordre);
  const actif = body?.actif === undefined ? current.actif : (body.actif ? 1 : 0);
  const modifiable_gerant = body?.modifiable_gerant === undefined
    ? (current.modifiable_gerant == null ? 1 : current.modifiable_gerant)
    : (body.modifiable_gerant ? 1 : 0);
  if (!label_fr) throw httpError('Le label français est obligatoire');
  if (!ICONE_RE.test(icone)) throw httpError('Icône Lucide invalide (ex: Flag)');
  await runSql(
    database,
    `UPDATE commodites SET label_fr = ?, icone = ?, description = ?, ordre = ?, actif = ?, modifiable_gerant = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [label_fr, icone, description, ordre, actif, modifiable_gerant, current.id],
  );
  if (Number(current.actif) === 1 && actif === 0) {
    await runSql(database, 'UPDATE terrain_commodites SET actif = 0 WHERE commodite_id = ?', [current.id]);
    await logCommoditeAction(database, {
      commodite_id: current.id,
      action: 'desactivation_commodite',
      fait_par: actor?.id,
      role: actor?.role,
      detail: `${current.cle} désactivée — retirée de tous les terrains`,
    });
    for (const row of await queryAll(database, 'SELECT DISTINCT terrain_id FROM terrain_commodites WHERE commodite_id = ?', [current.id])) {
      await syncTerrainCommoditesJson(database, row.terrain_id);
    }
  } else {
    await logCommoditeAction(database, {
      commodite_id: current.id,
      action: 'modification_commodite',
      fait_par: actor?.id,
      role: actor?.role,
      detail: `${current.cle} → ${label_fr} / ${icone}`,
    });
    for (const row of await queryAll(database, 'SELECT DISTINCT terrain_id FROM terrain_commodites WHERE commodite_id = ?', [current.id])) {
      await syncTerrainCommoditesJson(database, row.terrain_id);
    }
  }
  return getCommodite(database, current.id);
}

async function softDeleteCommodite(database, id, actor) {
  return updateCommodite(database, id, { actif: 0 }, actor);
}

async function listTerrainCommodites(database, terrainId) {
  const all = await listCommodites(database, { actif: 1 });
  const linked = await queryAll(
    database,
    'SELECT commodite_id, COALESCE(force_par_admin, 0) AS force_par_admin FROM terrain_commodites WHERE terrain_id = ? AND actif = 1',
    [Number(terrainId)],
  );
  const set = new Map(linked.map((r) => [Number(r.commodite_id), Number(r.force_par_admin) === 1]));
  return all.map((c) => ({
    ...c,
    associee: set.has(Number(c.id)),
    force_par_admin: set.get(Number(c.id)) ? 1 : 0,
    modifiable_gerant: Number(c.modifiable_gerant) === 0 ? 0 : 1,
  }));
}

async function publicCommodites(database, terrainId) {
  return await queryAll(
    database,
    `SELECT c.cle, c.label_fr, c.icone
     FROM terrain_commodites tc
     JOIN commodites c ON c.id = tc.commodite_id
     WHERE tc.terrain_id = ? AND tc.actif = 1 AND c.actif = 1
     ORDER BY c.ordre ASC, c.id ASC`,
    [Number(terrainId)],
  );
}

async function syncTerrainCommoditesJson(database, terrainId) {
  const rows = await publicCommodites(database, terrainId);
  await runSql(database, 'UPDATE terrains SET commodites = ? WHERE id = ?', [JSON.stringify(rows.map((r) => r.cle)), Number(terrainId)]);
}

async function setTerrainCommodites(database, terrainId, commoditeIds, actor) {
  const wanted = [...new Set((commoditeIds || []).map(Number).filter((n) => n > 0))];
  const current = await queryAll(database, 'SELECT commodite_id FROM terrain_commodites WHERE terrain_id = ? AND actif = 1', [Number(terrainId)]);
  const currentSet = new Set(current.map((r) => Number(r.commodite_id)));
  const wantedSet = new Set(wanted);

  for (const cid of wanted) {
    const def = await getCommodite(database, cid);
    if (!def || !def.actif) throw httpError(`Commodité ${cid} introuvable ou inactive`);
  }

  await runSql(database, 'UPDATE terrain_commodites SET actif = 0 WHERE terrain_id = ?', [Number(terrainId)]);
  for (const cid of wanted) {
    const existing = await queryOne(database, 'SELECT id FROM terrain_commodites WHERE terrain_id = ? AND commodite_id = ?', [Number(terrainId), cid]);
    if (existing) {
      await runSql(database, 'UPDATE terrain_commodites SET actif = 1 WHERE id = ?', [existing.id]);
    } else {
      await runSql(database, 'INSERT INTO terrain_commodites (terrain_id, commodite_id, actif) VALUES (?, ?, 1)', [Number(terrainId), cid]);
    }
    if (!currentSet.has(cid)) {
      const def = await getCommodite(database, cid);
      await logCommoditeAction(database, {
        terrain_id: Number(terrainId),
        commodite_id: cid,
        action: 'ajout',
        fait_par: actor?.id,
        role: actor?.role,
        detail: `Ajout ${def?.label_fr || cid}`,
      });
    }
  }
  for (const cid of currentSet) {
    if (!wantedSet.has(cid)) {
      const def = await getCommodite(database, cid);
      await logCommoditeAction(database, {
        terrain_id: Number(terrainId),
        commodite_id: cid,
        action: 'suppression',
        fait_par: actor?.id,
        role: actor?.role,
        detail: `Retrait ${def?.label_fr || cid}`,
      });
    }
  }
  await syncTerrainCommoditesJson(database, terrainId);
  const forceIds = [...new Set((actor?.forceIds || []).map(Number).filter((n) => n > 0))];
  if (forceIds.length) {
    await runSql(database, 'UPDATE terrain_commodites SET force_par_admin = 0 WHERE terrain_id = ?', [Number(terrainId)]);
    for (const cid of forceIds) {
      await runSql(
        database,
        'UPDATE terrain_commodites SET force_par_admin = 1 WHERE terrain_id = ? AND commodite_id = ? AND actif = 1',
        [Number(terrainId), cid],
      );
    }
  }
  return listTerrainCommodites(database, terrainId);
}

async function setGerantCommodites(database, terrainId, commoditeIds, actor) {
  const wanted = new Set((commoditeIds || []).map(Number).filter((n) => n > 0));
  const catalog = await listTerrainCommodites(database, terrainId);
  const next = [];
  for (const c of catalog) {
    const id = Number(c.id);
    const forced = Number(c.force_par_admin) === 1;
    const locked = Number(c.modifiable_gerant) === 0;
    if (forced || locked) {
      if (c.associee) next.push(id);
      continue;
    }
    if (wanted.has(id)) next.push(id);
  }
  return setTerrainCommodites(database, terrainId, next, actor);
}

async function publicCommoditesByTerrainIds(database, terrainIds) {
  const ids = (terrainIds || []).map(Number).filter((n) => n > 0);
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await queryAll(
    database,
    `SELECT tc.terrain_id, c.cle, c.label_fr, c.icone
     FROM terrain_commodites tc
     JOIN commodites c ON c.id = tc.commodite_id
     WHERE tc.terrain_id IN (${placeholders}) AND tc.actif = 1 AND c.actif = 1
     ORDER BY c.ordre ASC, c.id ASC`,
    ids,
  );
  const map = new Map();
  for (const row of rows) {
    const key = Number(row.terrain_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ cle: row.cle, label_fr: row.label_fr, icone: row.icone });
  }
  return map;
}

function actorFromReq(req) {
  const role = req.user?.role === 'superadmin' ? 'super_admin' : req.user?.role;
  return { id: req.user?.id, role };
}

module.exports = {
  CLE_RE,
  ICONE_RE,
  listCommodites,
  getCommodite,
  createCommodite,
  updateCommodite,
  softDeleteCommodite,
  listTerrainCommodites,
  publicCommodites,
  publicCommoditesByTerrainIds,
  setTerrainCommodites,
  setGerantCommodites,
  syncTerrainCommoditesJson,
  actorFromReq,
};
