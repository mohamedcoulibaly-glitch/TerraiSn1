/**
 * Source de vérité multi-gérants (employes ↔ terrains).
 * gerant_id = employes.id
 * Adapté SQLite sync (sql.js) : getDb() async, queryOne/queryAll/runSql/transaction synchrones.
 */
const { getDb, queryAll, queryOne, runSql, transaction } = require('../database');
const { assertGerantCompatibleAvecTerrain } = require('./siteService');

function toYmdLocal(dateTime = new Date()) {
  const y = dateTime.getFullYear();
  const m = String(dateTime.getMonth() + 1).padStart(2, '0');
  const d = String(dateTime.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toHmLocal(dateTime = new Date()) {
  return dateTime.toTimeString().substring(0, 5);
}

/** JS getDay(): 0=dimanche → 0=lundi … 6=dimanche */
function jourSemaineLundi(dateTime = new Date()) {
  const jour = dateTime.getDay();
  return jour === 0 ? 6 : jour - 1;
}

function mapGerantRow(row) {
  if (!row) return null;
  return {
    ...row,
    gerant_id: Number(row.gerant_id),
    telephone: row.whatsapp_number || row.telephone || null,
    est_principal: Number(row.est_principal) === 1 ? 1 : 0,
  };
}

/**
 * Retourne le gérant de garde pour un terrain à un instant T.
 * Priorité :
 *   1. Planning date_specifique = aujourd'hui
 *   2. Planning jour_semaine
 *   3. Gérant principal
 *   4. Premier gérant actif
 */
async function getGerantDeGarde(terrain_id, dateTime = new Date()) {
  const db = await getDb();
  const tid = Number(terrain_id);
  const jourSemaine = jourSemaineLundi(dateTime);
  const heure = toHmLocal(dateTime);
  const dateStr = toYmdLocal(dateTime);

  const selectFields = `
    pg.gerant_id, e.telephone, e.whatsapp_number, e.prenom, e.nom,
    gt.est_principal
  `;

  const gardeSpecifique = queryOne(db, `
    SELECT ${selectFields}
    FROM planning_garde pg
    JOIN employes e ON e.id = pg.gerant_id
    JOIN gerants_terrains gt ON gt.gerant_id = pg.gerant_id AND gt.terrain_id = pg.terrain_id
    WHERE pg.terrain_id = ?
      AND pg.date_specifique = ?
      AND pg.actif = 1
      AND gt.actif = 1
      AND (pg.heure_debut IS NULL OR pg.heure_debut <= ?)
      AND (pg.heure_fin IS NULL OR pg.heure_fin >= ?)
    LIMIT 1
  `, [tid, dateStr, heure, heure]);
  if (gardeSpecifique) return mapGerantRow(gardeSpecifique);

  const gardeJour = queryOne(db, `
    SELECT ${selectFields}
    FROM planning_garde pg
    JOIN employes e ON e.id = pg.gerant_id
    JOIN gerants_terrains gt ON gt.gerant_id = pg.gerant_id AND gt.terrain_id = pg.terrain_id
    WHERE pg.terrain_id = ?
      AND pg.jour_semaine = ?
      AND pg.date_specifique IS NULL
      AND pg.actif = 1
      AND gt.actif = 1
      AND (pg.heure_debut IS NULL OR pg.heure_debut <= ?)
      AND (pg.heure_fin IS NULL OR pg.heure_fin >= ?)
    LIMIT 1
  `, [tid, jourSemaine, heure, heure]);
  if (gardeJour) return mapGerantRow(gardeJour);

  const principal = queryOne(db, `
    SELECT gt.gerant_id, e.telephone, e.whatsapp_number, e.prenom, e.nom, gt.est_principal
    FROM gerants_terrains gt
    JOIN employes e ON e.id = gt.gerant_id
    WHERE gt.terrain_id = ? AND gt.est_principal = 1 AND gt.actif = 1
    LIMIT 1
  `, [tid]);
  if (principal) return mapGerantRow(principal);

  const premier = queryOne(db, `
    SELECT gt.gerant_id, e.telephone, e.whatsapp_number, e.prenom, e.nom, gt.est_principal
    FROM gerants_terrains gt
    JOIN employes e ON e.id = gt.gerant_id
    WHERE gt.terrain_id = ? AND gt.actif = 1
    ORDER BY gt.id ASC
    LIMIT 1
  `, [tid]);

  if (!premier) {
    // Fallback absolu : employes.terrain_id (données pré-migration)
    const legacy = queryOne(db, `
      SELECT e.id AS gerant_id, e.telephone, e.whatsapp_number, e.prenom, e.nom, 1 AS est_principal
      FROM employes e
      WHERE e.terrain_id = ? AND e.is_active = 1
      ORDER BY e.id ASC
      LIMIT 1
    `, [tid]);
    if (!legacy) {
      console.error(`[GERANT] Aucun gérant trouvé pour terrain ${tid}`);
      return null;
    }
    return mapGerantRow(legacy);
  }

  return mapGerantRow(premier);
}

async function getGerantPrincipal(terrain_id) {
  const db = await getDb();
  const row = queryOne(db, `
    SELECT gt.gerant_id, e.telephone, e.whatsapp_number, e.prenom, e.nom, gt.est_principal
    FROM gerants_terrains gt
    JOIN employes e ON e.id = gt.gerant_id
    WHERE gt.terrain_id = ? AND gt.est_principal = 1 AND gt.actif = 1
    LIMIT 1
  `, [Number(terrain_id)]);
  if (row) return mapGerantRow(row);
  return await getGerantDeGarde(terrain_id);
}

async function getGerantsTerrain(terrain_id, { inclureInactifs = false } = {}) {
  const db = await getDb();
  const actifClause = inclureInactifs ? '' : 'AND gt.actif = 1';
  const rows = queryAll(db, `
    SELECT gt.*, e.prenom, e.nom, e.telephone, e.email, e.whatsapp_number, e.photo_url AS photo_profil,
      (SELECT COUNT(*) FROM planning_garde pg
        WHERE pg.terrain_id = gt.terrain_id AND pg.gerant_id = gt.gerant_id AND pg.actif = 1) AS nb_gardes
    FROM gerants_terrains gt
    JOIN employes e ON e.id = gt.gerant_id
    WHERE gt.terrain_id = ? ${actifClause}
    ORDER BY gt.est_principal DESC, gt.actif DESC, gt.id ASC
  `, [Number(terrain_id)]);
  return rows.map((r) => ({
    ...r,
    est_principal: Number(r.est_principal) === 1 ? 1 : 0,
    actif: Number(r.actif) === 1 ? 1 : 0,
  }));
}

async function verifierAccesTerrain(gerant_id, terrain_id) {
  const db = await getDb();
  return queryOne(db, `
    SELECT id FROM gerants_terrains
    WHERE gerant_id = ? AND terrain_id = ? AND actif = 1
  `, [Number(gerant_id), Number(terrain_id)]);
}

function enrichTerrainsGerantKpis(db, rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => Number(r.id)).filter(Boolean);
  if (!ids.length) return rows;

  const placeholders = ids.map(() => '?').join(',');
  const today = toYmdLocal();
  const now = new Date();
  const nowHm = toHmLocal(now);
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
  const limiteHm = toYmdLocal(inOneHour) === today ? toHmLocal(inOneHour) : '23:59';

  const photos = queryAll(db, `
    SELECT terrain_id, url
    FROM terrain_photos
    WHERE terrain_id IN (${placeholders})
    ORDER BY est_principale DESC, ordre ASC, id ASC
  `, ids);
  const photoByTerrain = new Map();
  for (const p of photos) {
    const tid = Number(p.terrain_id);
    if (!photoByTerrain.has(tid) && p.url) photoByTerrain.set(tid, p.url);
  }

  const kpis = queryAll(db, `
    SELECT terrain_id,
      COUNT(*) AS matchs_aujourd_hui,
      SUM(
        CASE
          WHEN qr_code_scanne_at IS NULL
            AND heure_debut > ?
            AND heure_debut <= ?
          THEN 1 ELSE 0
        END
      ) AS imminent_count,
      SUM(
        CASE
          WHEN qr_code_scanne_at IS NULL
            AND heure_debut <= ?
          THEN 1 ELSE 0
        END
      ) AS en_attente_scan
    FROM reservations
    WHERE terrain_id IN (${placeholders})
      AND date = ?
      AND LOWER(COALESCE(statut, '')) IN ('confirme', 'acceptee', 'confirmee', 'paye', 'valide')
    GROUP BY terrain_id
  `, [nowHm, limiteHm, nowHm, ...ids, today]);
  const kpiByTerrain = new Map(kpis.map((k) => [Number(k.terrain_id), k]));

  const libres = queryAll(db, `
    SELECT terrain_id, COUNT(*) AS creneaux_libres_maintenant
    FROM creneaux
    WHERE terrain_id IN (${placeholders})
      AND date = ?
      AND LOWER(COALESCE(statut, '')) = 'libre'
      AND heure_debut > ?
    GROUP BY terrain_id
  `, [...ids, today, nowHm]);
  const libresByTerrain = new Map(libres.map((r) => [Number(r.terrain_id), r]));

  return rows.map((row) => {
    const tid = Number(row.id);
    const kpi = kpiByTerrain.get(tid);
    const libre = libresByTerrain.get(tid);
    let photoPrincipale = photoByTerrain.get(tid) || null;
    if (!photoPrincipale && row.photos) {
      try {
        const parsed = typeof row.photos === 'string' ? JSON.parse(row.photos) : row.photos;
        if (Array.isArray(parsed) && parsed[0]) {
          photoPrincipale = typeof parsed[0] === 'string' ? parsed[0] : parsed[0].url || null;
        }
      } catch {
        /* ignore */
      }
    }
    const { photos: _photos, ...rest } = row;
    const imminent = Number(kpi?.imminent_count) || 0;
    const enAttenteScan = Number(kpi?.en_attente_scan) || 0;
    const libresNow = Number(libre?.creneaux_libres_maintenant) || 0;
    return {
      ...rest,
      quartier: row.adresse || row.ville || '',
      photo_principale: photoPrincipale,
      matchs_aujourd_hui: Number(kpi?.matchs_aujourd_hui) || 0,
      imminent_count: imminent,
      imminents_count: imminent,
      en_attente_scan: enAttenteScan,
      creneaux_libres_maintenant: libresNow,
    };
  });
}

/** Résumé alertes cross-terrain (tous les terrains actifs du gérant). */
async function listAlertesTerrainsGerant(gerant_id) {
  const terrains = await listTerrainsGerant(gerant_id);
  return {
    terrains: terrains.map((t) => ({
      id: Number(t.id),
      nom: t.nom,
      quartier: t.quartier || t.adresse || t.ville || '',
      site_id: t.site_id != null ? Number(t.site_id) : null,
      imminents_count: Number(t.imminents_count ?? t.imminent_count) || 0,
      en_attente_scan: Number(t.en_attente_scan) || 0,
      creneaux_libres_maintenant: Number(t.creneaux_libres_maintenant) || 0,
      matchs_aujourd_hui: Number(t.matchs_aujourd_hui) || 0,
    })),
    heure_serveur: new Date().toISOString(),
  };
}

async function listTerrainsGerant(gerant_id) {
  const db = await getDb();
  const rows = queryAll(db, `
    SELECT gt.terrain_id AS id, gt.est_principal, gt.note, gt.actif,
           t.nom, t.adresse, t.ville, t.photos, t.site_id, t.proprietaire_id
    FROM gerants_terrains gt
    JOIN terrains t ON t.id = gt.terrain_id
    WHERE gt.gerant_id = ? AND gt.actif = 1
    ORDER BY gt.est_principal DESC, t.nom ASC
  `, [Number(gerant_id)]);

  if (rows.length) return enrichTerrainsGerantKpis(db, rows);

  // Fallback JWT / employes.terrain_id
  const emp = queryOne(db, 'SELECT terrain_id FROM employes WHERE id = ?', [Number(gerant_id)]);
  if (!emp?.terrain_id) return [];
  const t = queryOne(
    db,
    'SELECT id, nom, adresse, ville, photos, site_id, proprietaire_id FROM terrains WHERE id = ?',
    [emp.terrain_id],
  );
  if (!t) return [];
  return enrichTerrainsGerantKpis(db, [{ ...t, est_principal: 1, note: null, actif: 1 }]);
}

function logAudit(db, { terrain_id, gerant_id, action, fait_par, role_fait_par, detail }) {
  runSql(db, `
    INSERT INTO audit_gerants_terrain
      (terrain_id, gerant_id, action, fait_par, role_fait_par, detail)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    terrain_id ? Number(terrain_id) : null,
    gerant_id ? Number(gerant_id) : null,
    action,
    fait_par != null ? Number(fait_par) : null,
    role_fait_par || null,
    detail || null,
  ]);
}

async function definirGerantPrincipal(terrain_id, nouveau_gerant_id, fait_par, role_fait_par = 'super_admin') {
  const db = await getDb();
  const tid = Number(terrain_id);
  const gid = Number(nouveau_gerant_id);
  const link = queryOne(db, `
    SELECT id FROM gerants_terrains WHERE terrain_id = ? AND gerant_id = ? AND actif = 1
  `, [tid, gid]);
  if (!link) {
    const err = new Error('Ce gérant n\'est pas rattaché à ce terrain');
    err.statusCode = 404;
    throw err;
  }

  transaction(db, () => {
    runSql(db, `
      UPDATE gerants_terrains SET est_principal = 0, updated_at = CURRENT_TIMESTAMP
      WHERE terrain_id = ? AND est_principal = 1
    `, [tid]);
    runSql(db, `
      UPDATE gerants_terrains SET est_principal = 1, updated_at = CURRENT_TIMESTAMP
      WHERE terrain_id = ? AND gerant_id = ?
    `, [tid, gid]);
    logAudit(db, {
      terrain_id: tid,
      gerant_id: gid,
      action: 'passage_principal',
      fait_par,
      role_fait_par,
      detail: 'Nouveau gérant principal défini',
    });
  });
  return await getGerantsTerrain(tid, { inclureInactifs: true });
}

async function ajouterGerant(terrain_id, payload, fait_par, role_fait_par = 'super_admin') {
  const db = await getDb();
  const tid = Number(terrain_id);
  const gid = Number(payload.gerant_id);
  if (!gid) {
    const err = new Error('gerant_id requis');
    err.statusCode = 400;
    throw err;
  }

  const employe = queryOne(db, 'SELECT id, terrain_id, is_active FROM employes WHERE id = ?', [gid]);
  if (!employe) {
    const err = new Error('Compte gérant introuvable');
    err.statusCode = 404;
    throw err;
  }

  // Même propriétaire + même site (si site_id renseigné)
  assertGerantCompatibleAvecTerrain(db, gid, tid);

  const existing = queryOne(db, `
    SELECT id, actif FROM gerants_terrains WHERE gerant_id = ? AND terrain_id = ?
  `, [gid, tid]);

  const estPrincipal = Number(payload.est_principal) === 1 ? 1 : 0;
  const dateDebut = payload.date_debut || toYmdLocal(new Date());
  const dateFin = payload.date_fin || null;
  const note = payload.note || null;

  transaction(db, () => {
    if (estPrincipal) {
      runSql(db, `
        UPDATE gerants_terrains SET est_principal = 0, updated_at = CURRENT_TIMESTAMP
        WHERE terrain_id = ? AND est_principal = 1
      `, [tid]);
    }

    if (existing) {
      runSql(db, `
        UPDATE gerants_terrains
        SET actif = 1, est_principal = ?, note = ?, date_debut = ?, date_fin = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [estPrincipal, note, dateDebut, dateFin, existing.id]);
    } else {
      runSql(db, `
        INSERT INTO gerants_terrains
          (gerant_id, terrain_id, est_principal, actif, date_debut, date_fin, note)
        VALUES (?, ?, ?, 1, ?, ?, ?)
      `, [gid, tid, estPrincipal, dateDebut, dateFin, note]);
    }

    // Compat JWT : si l'employé n'a pas de terrain_id, le fixer
    if (!employe.terrain_id) {
      runSql(db, 'UPDATE employes SET terrain_id = ? WHERE id = ?', [tid, gid]);
    }

    logAudit(db, {
      terrain_id: tid,
      gerant_id: gid,
      action: 'ajout',
      fait_par,
      role_fait_par,
      detail: note || (estPrincipal ? 'Ajout comme principal' : 'Ajout comme supplémentaire'),
    });
  });

  // Si aucun principal sur le terrain → forcer celui-ci
  const hasPrincipal = queryOne(db, `
    SELECT id FROM gerants_terrains WHERE terrain_id = ? AND est_principal = 1 AND actif = 1
  `, [tid]);
  if (!hasPrincipal) {
    await definirGerantPrincipal(tid, gid, fait_par, role_fait_par);
  }

  return await getGerantsTerrain(tid, { inclureInactifs: true });
}

async function modifierGerant(terrain_id, gerant_id, payload, fait_par, role_fait_par = 'super_admin') {
  const db = await getDb();
  const tid = Number(terrain_id);
  const gid = Number(gerant_id);
  const link = queryOne(db, `
    SELECT * FROM gerants_terrains WHERE terrain_id = ? AND gerant_id = ?
  `, [tid, gid]);
  if (!link) {
    const err = new Error('Liaison introuvable');
    err.statusCode = 404;
    throw err;
  }

  const nextActif = payload.actif != null ? (Number(payload.actif) ? 1 : 0) : Number(link.actif);
  const nextPrincipal = payload.est_principal != null
    ? (Number(payload.est_principal) ? 1 : 0)
    : Number(link.est_principal);
  const nextNote = payload.note !== undefined ? payload.note : link.note;
  const nextDebut = payload.date_debut !== undefined ? payload.date_debut : link.date_debut;
  const nextFin = payload.date_fin !== undefined ? payload.date_fin : link.date_fin;

  if (Number(link.actif) === 1 && nextActif === 0) {
    const actifs = queryOne(db, `
      SELECT COUNT(*) AS n FROM gerants_terrains
      WHERE terrain_id = ? AND actif = 1 AND gerant_id != ?
    `, [tid, gid]);
    if (Number(actifs?.n || 0) < 1) {
      const err = new Error('Impossible de désactiver le seul gérant actif du terrain');
      err.statusCode = 400;
      throw err;
    }
  }

  transaction(db, () => {
    if (nextPrincipal === 1) {
      runSql(db, `
        UPDATE gerants_terrains SET est_principal = 0, updated_at = CURRENT_TIMESTAMP
        WHERE terrain_id = ? AND est_principal = 1
      `, [tid]);
    }

    runSql(db, `
      UPDATE gerants_terrains
      SET actif = ?, est_principal = ?, note = ?, date_debut = ?, date_fin = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE terrain_id = ? AND gerant_id = ?
    `, [nextActif, nextPrincipal, nextNote, nextDebut, nextFin, tid, gid]);

    let action = null;
    if (Number(link.actif) === 1 && nextActif === 0) action = 'desactivation';
    else if (Number(link.est_principal) !== 1 && nextPrincipal === 1) action = 'passage_principal';

    if (action) {
      logAudit(db, {
        terrain_id: tid,
        gerant_id: gid,
        action,
        fait_par,
        role_fait_par,
        detail: JSON.stringify({ note: nextNote, actif: nextActif }),
      });
    }

    // Si on a retiré le principal, promouvoir un autre
    if (nextPrincipal === 0 || nextActif === 0) {
      const stillPrincipal = queryOne(db, `
        SELECT id FROM gerants_terrains WHERE terrain_id = ? AND est_principal = 1 AND actif = 1
      `, [tid]);
      if (!stillPrincipal) {
        const other = queryOne(db, `
          SELECT gerant_id FROM gerants_terrains
          WHERE terrain_id = ? AND actif = 1
          ORDER BY id ASC LIMIT 1
        `, [tid]);
        if (other) {
          runSql(db, `
            UPDATE gerants_terrains SET est_principal = 1, updated_at = CURRENT_TIMESTAMP
            WHERE terrain_id = ? AND gerant_id = ?
          `, [tid, other.gerant_id]);
          logAudit(db, {
            terrain_id: tid,
            gerant_id: other.gerant_id,
            action: 'passage_principal',
            fait_par,
            role_fait_par,
            detail: 'Promotion automatique après modification',
          });
        }
      }
    }
  });

  return await getGerantsTerrain(tid, { inclureInactifs: true });
}

async function retirerGerant(terrain_id, gerant_id, fait_par, role_fait_par = 'super_admin') {
  const db = await getDb();
  const tid = Number(terrain_id);
  const gid = Number(gerant_id);
  const link = queryOne(db, `
    SELECT * FROM gerants_terrains WHERE terrain_id = ? AND gerant_id = ?
  `, [tid, gid]);
  if (!link) {
    const err = new Error('Liaison introuvable');
    err.statusCode = 404;
    throw err;
  }

  const actifs = queryOne(db, `
    SELECT COUNT(*) AS n FROM gerants_terrains
    WHERE terrain_id = ? AND actif = 1 AND gerant_id != ?
  `, [tid, gid]);
  if (Number(link.actif) === 1 && Number(actifs?.n || 0) < 1) {
    const err = new Error('Impossible de retirer le seul gérant actif du terrain');
    err.statusCode = 400;
    throw err;
  }

  transaction(db, () => {
    runSql(db, `
      UPDATE gerants_terrains
      SET actif = 0, est_principal = 0, updated_at = CURRENT_TIMESTAMP
      WHERE terrain_id = ? AND gerant_id = ?
    `, [tid, gid]);

    logAudit(db, {
      terrain_id: tid,
      gerant_id: gid,
      action: 'suppression',
      fait_par,
      role_fait_par,
      detail: 'Soft delete (actif = 0)',
    });

    const stillPrincipal = queryOne(db, `
      SELECT id FROM gerants_terrains WHERE terrain_id = ? AND est_principal = 1 AND actif = 1
    `, [tid]);
    if (!stillPrincipal) {
      const other = queryOne(db, `
        SELECT gerant_id FROM gerants_terrains
        WHERE terrain_id = ? AND actif = 1
        ORDER BY id ASC LIMIT 1
      `, [tid]);
      if (other) {
        runSql(db, `
          UPDATE gerants_terrains SET est_principal = 1, updated_at = CURRENT_TIMESTAMP
          WHERE terrain_id = ? AND gerant_id = ?
        `, [tid, other.gerant_id]);
        logAudit(db, {
          terrain_id: tid,
          gerant_id: other.gerant_id,
          action: 'passage_principal',
          fait_par,
          role_fait_par,
          detail: 'Promotion automatique après retrait',
        });
      }
    }
  });

  return await getGerantsTerrain(tid, { inclureInactifs: true });
}

async function assertEstGerantPrincipal(terrain_id, gerant_id) {
  const db = await getDb();
  const row = queryOne(db, `
    SELECT id FROM gerants_terrains
    WHERE terrain_id = ? AND gerant_id = ? AND est_principal = 1 AND actif = 1
  `, [Number(terrain_id), Number(gerant_id)]);
  if (!row) {
    const err = new Error('Seul le gérant principal peut modifier les plannings.');
    err.statusCode = 403;
    throw err;
  }
  return true;
}

/**
 * Remplace le planning d'un gérant sur un terrain.
 * Réutilisé par l'admin et par le gérant principal (même table planning_garde).
 */
async function remplacerPlanning(terrain_id, gerant_id, { planning_hebdo = [], dates_specifiques = [] }, fait_par, role_fait_par = 'super_admin') {
  const db = await getDb();
  const tid = Number(terrain_id);
  const gid = Number(gerant_id);
  const link = await verifierAccesTerrain(gid, tid);
  if (!link) {
    // autoriser aussi inactif pour config avant activation
    const any = queryOne(db, `
      SELECT id FROM gerants_terrains WHERE gerant_id = ? AND terrain_id = ?
    `, [gid, tid]);
    if (!any) {
      const err = new Error('Gérant non rattaché à ce terrain');
      err.statusCode = 404;
      throw err;
    }
  }

  transaction(db, () => {
    runSql(db, `
      DELETE FROM planning_garde WHERE terrain_id = ? AND gerant_id = ?
    `, [tid, gid]);

    for (const slot of planning_hebdo) {
      if (slot == null || slot.actif === false || slot.actif === 0) continue;
      const jour = slot.jour_semaine;
      if (jour == null || jour < 0 || jour > 6) continue;
      runSql(db, `
        INSERT INTO planning_garde
          (terrain_id, gerant_id, jour_semaine, heure_debut, heure_fin, date_specifique, actif)
        VALUES (?, ?, ?, ?, ?, NULL, 1)
      `, [tid, gid, Number(jour), slot.heure_debut || null, slot.heure_fin || null]);
    }

    for (const slot of dates_specifiques) {
      if (!slot?.date_specifique) continue;
      runSql(db, `
        INSERT INTO planning_garde
          (terrain_id, gerant_id, jour_semaine, heure_debut, heure_fin, date_specifique, actif)
        VALUES (?, ?, NULL, ?, ?, ?, 1)
      `, [tid, gid, slot.heure_debut || null, slot.heure_fin || null, slot.date_specifique]);
    }

    logAudit(db, {
      terrain_id: tid,
      gerant_id: gid,
      action: 'planning_modifie',
      fait_par,
      role_fait_par,
      detail: `${planning_hebdo.length} créneaux hebdo, ${dates_specifiques.length} dates spécifiques`,
    });
  });

  return await listPlanningGerant(tid, gid);
}

/**
 * Gérant principal → édite le planning d'un collègue (ou le sien) sur son terrain.
 */
async function remplacerPlanningParPrincipal(terrain_id, cible_gerant_id, payload, fait_par) {
  const tid = Number(terrain_id);
  const cible = Number(cible_gerant_id);
  const auteur = Number(fait_par);
  await assertEstGerantPrincipal(tid, auteur);

  const cibleOk = await verifierAccesTerrain(cible, tid);
  if (!cibleOk) {
    const err = new Error('Ce gérant n\'est pas rattaché à ce terrain');
    err.statusCode = 404;
    throw err;
  }

  return remplacerPlanning(
    tid,
    cible,
    payload || {},
    auteur,
    'gerant_principal',
  );
}

async function listPlanningGerant(terrain_id, gerant_id = null) {
  const db = await getDb();
  const params = [Number(terrain_id)];
  let sql = `
    SELECT pg.*, e.prenom, e.nom
    FROM planning_garde pg
    JOIN employes e ON e.id = pg.gerant_id
    WHERE pg.terrain_id = ? AND pg.actif = 1
  `;
  if (gerant_id != null) {
    sql += ' AND pg.gerant_id = ?';
    params.push(Number(gerant_id));
  }
  sql += ' ORDER BY pg.date_specifique IS NULL, pg.date_specifique, pg.jour_semaine, pg.heure_debut';
  return queryAll(db, sql, params);
}

async function listPlanningGerantConnecte(gerant_id) {
  const db = await getDb();
  return queryAll(db, `
    SELECT pg.*, t.nom AS terrain_nom, gt.est_principal
    FROM planning_garde pg
    JOIN terrains t ON t.id = pg.terrain_id
    JOIN gerants_terrains gt ON gt.gerant_id = pg.gerant_id AND gt.terrain_id = pg.terrain_id
    WHERE pg.gerant_id = ? AND pg.actif = 1 AND gt.actif = 1
    ORDER BY pg.terrain_id, pg.date_specifique IS NULL, pg.jour_semaine, pg.heure_debut
  `, [Number(gerant_id)]);
}

async function heartbeat(gerant_id, terrain_id) {
  const db = await getDb();
  const gid = Number(gerant_id);
  const tid = Number(terrain_id);
  const access = await verifierAccesTerrain(gid, tid);
  if (!access) {
    // fallback employes.terrain_id
    const emp = queryOne(db, 'SELECT id FROM employes WHERE id = ? AND terrain_id = ? AND is_active = 1', [gid, tid]);
    if (!emp) {
      const err = new Error('Accès terrain refusé');
      err.statusCode = 403;
      throw err;
    }
  }

  const existing = queryOne(db, `
    SELECT id FROM sessions_gerant_actives WHERE gerant_id = ? AND terrain_id = ?
  `, [gid, tid]);
  if (existing) {
    runSql(db, `
      UPDATE sessions_gerant_actives SET derniere_activite = CURRENT_TIMESTAMP WHERE id = ?
    `, [existing.id]);
  } else {
    runSql(db, `
      INSERT INTO sessions_gerant_actives (gerant_id, terrain_id, derniere_activite)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `, [gid, tid]);
  }
  return { ok: true };
}

/** Sessions actives = activité < 90s */
async function gerantsEnLigne(terrain_id, excludeGerantId = null) {
  const db = await getDb();
  const params = [Number(terrain_id)];
  let sql = `
    SELECT s.gerant_id, e.prenom, e.nom, s.derniere_activite
    FROM sessions_gerant_actives s
    JOIN employes e ON e.id = s.gerant_id
    WHERE s.terrain_id = ?
      AND s.derniere_activite >= datetime('now', '-90 seconds')
  `;
  if (excludeGerantId != null) {
    sql += ' AND s.gerant_id != ?';
    params.push(Number(excludeGerantId));
  }
  sql += ' ORDER BY e.prenom ASC';
  return queryAll(db, sql, params);
}

async function searchGerantsDisponibles(q = '') {
  const db = await getDb();
  const term = `%${String(q || '').trim()}%`;
  return queryAll(db, `
    SELECT e.id, e.prenom, e.nom, e.telephone, e.whatsapp_number, e.email, e.terrain_id,
      (SELECT COUNT(*) FROM gerants_terrains gt WHERE gt.gerant_id = e.id AND gt.actif = 1) AS nb_terrains
    FROM employes e
    WHERE e.is_active = 1
      AND (
        ? = '%%'
        OR e.nom LIKE ? OR e.prenom LIKE ? OR e.telephone LIKE ?
        OR e.whatsapp_number LIKE ? OR e.email LIKE ?
      )
    ORDER BY e.nom ASC
    LIMIT 40
  `, [term, term, term, term, term, term]);
}

module.exports = {
  getGerantDeGarde,
  getGerantPrincipal,
  getGerantsTerrain,
  verifierAccesTerrain,
  listTerrainsGerant,
  listAlertesTerrainsGerant,
  definirGerantPrincipal,
  ajouterGerant,
  modifierGerant,
  retirerGerant,
  assertEstGerantPrincipal,
  remplacerPlanning,
  remplacerPlanningParPrincipal,
  listPlanningGerant,
  listPlanningGerantConnecte,
  heartbeat,
  gerantsEnLigne,
  searchGerantsDisponibles,
  jourSemaineLundi,
  toYmdLocal,
  toHmLocal,
};
