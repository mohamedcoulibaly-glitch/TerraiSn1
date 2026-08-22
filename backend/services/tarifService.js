const { queryAll, queryOne, runSql } = require('../database');
const { jourDepuisDate } = require('../scheduleService');

const TYPES = ['semaine', 'weekend', 'soiree', 'special'];
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const JOURS_SEMAINE = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];
const JOURS_WEEKEND = ['samedi', 'dimanche'];

function hhmm(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, 5);
}

function parseJours(raw, type) {
  const listed = String(raw || '')
    .split(',')
    .map((j) => j.trim().toLowerCase())
    .filter((j) => JOURS.includes(j));
  if (listed.length) return listed;
  if (type === 'weekend') return [...JOURS_WEEKEND];
  if (type === 'semaine') return [...JOURS_SEMAINE];
  return [...JOURS];
}

function joursCorrespondent(tarif, jour) {
  return parseJours(tarif.jours, tarif.type).includes(String(jour || '').toLowerCase());
}

function heureCorrespond(tarif, heureDebut) {
  const debut = hhmm(tarif.heure_debut);
  const fin = hhmm(tarif.heure_fin);
  if (!debut || !fin) return true;
  const h = hhmm(heureDebut) || '00:00';
  return h >= debut && h < fin;
}

function friendlyNom(nom) {
  const raw = String(nom || '').trim();
  if (!raw) return 'Tarif';
  if (/^CORR\s+Soir[ée]e$/i.test(raw) || /^soiree$/i.test(raw)) return 'Soirée (après 18h)';
  if (/^CORR\s+/i.test(raw)) return raw.replace(/^CORR\s+/i, '');
  return raw;
}

function mapRegle(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    terrain_id: Number(row.terrain_id),
    nom: friendlyNom(row.nom),
    nom_brut: row.nom,
    prix_demi_terrain: Number(row.prix_demi_terrain || 0),
    prix_terrain_entier: Number(row.prix_terrain_entier || 0),
    type: row.type,
    jours: parseJours(row.jours, row.type),
    jours_raw: row.jours || '',
    heure_debut: hhmm(row.heure_debut) || null,
    heure_fin: hhmm(row.heure_fin) || null,
    priorite: Number(row.priorite || 0),
    actif: Number(row.actif) ? 1 : 0,
    source: row.source || 'manuelle',
  };
}

async function listRegles(db, terrainId, { actifsUniquement = false } = {}) {
  const extra = actifsUniquement ? ' AND actif = 1' : '';
  const rows = await queryAll(
    db,
    `SELECT * FROM regles_tarifs
      WHERE terrain_id = ?${extra}
      ORDER BY priorite DESC, id DESC`,
    [terrainId],
  );
  return rows.map(mapRegle);
}

async function getPrixActif(db, terrainId, date, heureDebut, jourOverride = null) {
  const terrain = await queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) {
    return { prix_demi_terrain: 0, prix_terrain_entier: 0, nom_tarif: 'Tarif de base' };
  }

  const jour = jourOverride || jourDepuisDate(date);
  const tarifs = await queryAll(
    db,
    `SELECT * FROM regles_tarifs
      WHERE terrain_id = ? AND actif = 1
      ORDER BY priorite DESC, id DESC`,
    [terrainId],
  );

  for (const tarif of tarifs) {
    if (joursCorrespondent(tarif, jour) && heureCorrespond(tarif, heureDebut)) {
      return {
        prix_demi_terrain: Number(tarif.prix_demi_terrain || 0),
        prix_terrain_entier: Number(tarif.prix_terrain_entier || 0),
        nom_tarif: friendlyNom(tarif.nom),
        source: 'regle',
        regle_id: Number(tarif.id),
      };
    }
  }

  const { prixHoraireEffectif, prixBaseTerrain } = require('../pricingService');
  const prixEntier = await prixHoraireEffectif(db, terrain, date, heureDebut, 'entier', jourOverride);
  const prixMoitie = await prixHoraireEffectif(db, terrain, date, heureDebut, 'moitie', jourOverride);
  const baseEntier = prixBaseTerrain(terrain, 'entier');
  const baseMoitie = prixBaseTerrain(terrain, 'moitie');
  const personnalise = Number(prixEntier) !== Number(baseEntier) || Number(prixMoitie) !== Number(baseMoitie);
  return {
    prix_demi_terrain: Number(prixMoitie || 0),
    prix_terrain_entier: Number(prixEntier || 0),
    nom_tarif: personnalise ? 'Tarif horaire' : 'Tarif de base',
    source: personnalise ? 'cellule' : 'base',
  };
}

function nextDateForWeekday(weekdayName) {
  const target = JOURS.indexOf(weekdayName);
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const current = (now.getDay() + 6) % 7;
  const delta = (target - current + 7) % 7;
  now.setDate(now.getDate() + delta);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function apercuPrix(db, terrainId) {
  const samples = [
    { quand: 'Ce samedi à 20h', date: nextDateForWeekday('samedi'), heure: '20:00' },
    { quand: 'Ce lundi à 14h', date: nextDateForWeekday('lundi'), heure: '14:00' },
  ];
  const out = [];
  for (const s of samples) {
    const prix = await getPrixActif(db, terrainId, s.date, s.heure);
    out.push({
      quand: s.quand,
      date: s.date,
      heure: s.heure,
      nom_tarif: prix.nom_tarif,
      prix_demi_terrain: prix.prix_demi_terrain,
      prix_terrain_entier: prix.prix_terrain_entier,
    });
  }
  return out;
}

function assertPayload(body) {
  const nom = String(body?.nom || '').trim();
  const type = String(body?.type || '').trim();
  const prixDemi = Number(body?.prix_demi_terrain);
  const prixEntier = Number(body?.prix_terrain_entier);
  const priorite = Number(body?.priorite ?? 0);
  if (!nom) {
    const err = new Error('Nom de la règle requis');
    err.statusCode = 400;
    throw err;
  }
  if (!TYPES.includes(type)) {
    const err = new Error('Type invalide');
    err.statusCode = 400;
    throw err;
  }
  if (!(prixDemi > 0) || !(prixEntier > 0)) {
    const err = new Error('Les prix doivent être positifs');
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(priorite) || priorite < 0 || priorite > 10) {
    const err = new Error('Priorité entre 0 et 10');
    err.statusCode = 400;
    throw err;
  }
  const jours = parseJours(Array.isArray(body?.jours) ? body.jours.join(',') : body?.jours, type);
  const heure_debut = hhmm(body?.heure_debut) || null;
  const heure_fin = hhmm(body?.heure_fin) || null;
  if ((heure_debut && !heure_fin) || (!heure_debut && heure_fin)) {
    const err = new Error('Heure début et heure fin vont ensemble');
    err.statusCode = 400;
    throw err;
  }
  return {
    nom,
    type,
    prix_demi_terrain: Math.round(prixDemi),
    prix_terrain_entier: Math.round(prixEntier),
    jours: jours.join(','),
    heure_debut,
    heure_fin,
    priorite: Math.round(priorite),
    actif: body?.actif === 0 || body?.actif === false ? 0 : 1,
    source: String(body?.source || 'manuelle'),
  };
}

async function creerRegle(db, terrainId, body) {
  const payload = assertPayload(body);
  const result = await runSql(
    db,
    `INSERT INTO regles_tarifs
      (terrain_id, nom, prix_demi_terrain, prix_terrain_entier, type, jours, heure_debut, heure_fin, priorite, actif, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      terrainId,
      payload.nom,
      payload.prix_demi_terrain,
      payload.prix_terrain_entier,
      payload.type,
      payload.jours,
      payload.heure_debut,
      payload.heure_fin,
      payload.priorite,
      payload.actif,
      payload.source,
    ],
  );
  return await queryOne(db, 'SELECT * FROM regles_tarifs WHERE id = ?', [result.lastInsertRowid]);
}

async function modifierRegle(db, terrainId, regleId, body) {
  const existing = await queryOne(db, 'SELECT * FROM regles_tarifs WHERE id = ? AND terrain_id = ?', [regleId, terrainId]);
  if (!existing) {
    const err = new Error('Règle introuvable');
    err.statusCode = 404;
    throw err;
  }
  const payload = assertPayload({ ...existing, ...body, jours: body?.jours ?? existing.jours });
  await runSql(
    db,
    `UPDATE regles_tarifs SET
      nom = ?, prix_demi_terrain = ?, prix_terrain_entier = ?, type = ?,
      jours = ?, heure_debut = ?, heure_fin = ?, priorite = ?, actif = ?, source = ?
     WHERE id = ? AND terrain_id = ?`,
    [
      payload.nom,
      payload.prix_demi_terrain,
      payload.prix_terrain_entier,
      payload.type,
      payload.jours,
      payload.heure_debut,
      payload.heure_fin,
      payload.priorite,
      payload.actif,
      payload.source,
      regleId,
      terrainId,
    ],
  );
  return await queryOne(db, 'SELECT * FROM regles_tarifs WHERE id = ?', [regleId]);
}

async function toggleRegle(db, terrainId, regleId, actif) {
  const existing = await queryOne(db, 'SELECT * FROM regles_tarifs WHERE id = ? AND terrain_id = ?', [regleId, terrainId]);
  if (!existing) {
    const err = new Error('Règle introuvable');
    err.statusCode = 404;
    throw err;
  }
  const next = actif === undefined ? (Number(existing.actif) ? 0 : 1) : (actif ? 1 : 0);
  await runSql(db, 'UPDATE regles_tarifs SET actif = ? WHERE id = ? AND terrain_id = ?', [next, regleId, terrainId]);
  return await queryOne(db, 'SELECT * FROM regles_tarifs WHERE id = ?', [regleId]);
}

async function supprimerRegle(db, terrainId, regleId) {
  const existing = await queryOne(db, 'SELECT * FROM regles_tarifs WHERE id = ? AND terrain_id = ?', [regleId, terrainId]);
  if (!existing) {
    const err = new Error('Règle introuvable');
    err.statusCode = 404;
    throw err;
  }
  await runSql(db, 'DELETE FROM regles_tarifs WHERE id = ? AND terrain_id = ?', [regleId, terrainId]);
  return { ok: true, id: Number(regleId) };
}

function money(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  const fb = Number(fallback);
  return Number.isFinite(fb) && fb > 0 ? Math.round(fb) : 0;
}

function emptyGrille(base = {}) {
  const entier = money(base.prix_entier_base || base.prix_entier, 0);
  const demi = money(base.prix_moitie_base || base.prix_moitie, Math.round(entier / 2) || 0);
  const pair = { demi, entier };
  return {
    heure_pivot_semaine: '18:00',
    heure_pivot_weekend: '18:00',
    semaine: { avant: { ...pair }, apres: { ...pair } },
    weekend: { avant: { ...pair }, apres: { ...pair } },
  };
}

function normalizeGrille(body, base = {}) {
  const fallback = emptyGrille(base);
  const pivotS = hhmm(body?.heure_pivot_semaine) || fallback.heure_pivot_semaine;
  const pivotW = hhmm(body?.heure_pivot_weekend) || fallback.heure_pivot_weekend;
  const grille = {
    heure_pivot_semaine: pivotS,
    heure_pivot_weekend: pivotW,
    semaine: {
      avant: {
        demi: money(body?.semaine?.avant?.demi, fallback.semaine.avant.demi),
        entier: money(body?.semaine?.avant?.entier, fallback.semaine.avant.entier),
      },
      apres: {
        demi: money(body?.semaine?.apres?.demi, fallback.semaine.apres.demi),
        entier: money(body?.semaine?.apres?.entier, fallback.semaine.apres.entier),
      },
    },
    weekend: {
      avant: {
        demi: money(body?.weekend?.avant?.demi, fallback.weekend.avant.demi),
        entier: money(body?.weekend?.avant?.entier, fallback.weekend.avant.entier),
      },
      apres: {
        demi: money(body?.weekend?.apres?.demi, fallback.weekend.apres.demi),
        entier: money(body?.weekend?.apres?.entier, fallback.weekend.apres.entier),
      },
    },
  };
  const prices = [
    grille.semaine.avant.demi,
    grille.semaine.avant.entier,
    grille.semaine.apres.demi,
    grille.semaine.apres.entier,
    grille.weekend.avant.demi,
    grille.weekend.avant.entier,
    grille.weekend.apres.demi,
    grille.weekend.apres.entier,
  ];
  if (prices.some((p) => !(p > 0))) {
    const err = new Error('Tous les tarifs (demi-terrain et terrain entier) doivent être positifs');
    err.statusCode = 400;
    throw err;
  }
  return grille;
}

function rulesFromGrille(grille) {
  const g = normalizeGrille(grille);
  return [
    {
      nom: `Semaine — avant ${g.heure_pivot_semaine.replace(':', 'h')}`,
      type: 'semaine',
      jours: JOURS_SEMAINE,
      heure_debut: '00:00',
      heure_fin: g.heure_pivot_semaine,
      prix_demi_terrain: g.semaine.avant.demi,
      prix_terrain_entier: g.semaine.avant.entier,
      priorite: 4,
      actif: 1,
      source: 'grille_standard',
    },
    {
      nom: `Semaine — à partir de ${g.heure_pivot_semaine.replace(':', 'h')}`,
      type: 'semaine',
      jours: JOURS_SEMAINE,
      heure_debut: g.heure_pivot_semaine,
      heure_fin: '24:00',
      prix_demi_terrain: g.semaine.apres.demi,
      prix_terrain_entier: g.semaine.apres.entier,
      priorite: 5,
      actif: 1,
      source: 'grille_standard',
    },
    {
      nom: `Week-end — avant ${g.heure_pivot_weekend.replace(':', 'h')}`,
      type: 'weekend',
      jours: JOURS_WEEKEND,
      heure_debut: '00:00',
      heure_fin: g.heure_pivot_weekend,
      prix_demi_terrain: g.weekend.avant.demi,
      prix_terrain_entier: g.weekend.avant.entier,
      priorite: 6,
      actif: 1,
      source: 'grille_standard',
    },
    {
      nom: `Week-end — à partir de ${g.heure_pivot_weekend.replace(':', 'h')}`,
      type: 'weekend',
      jours: JOURS_WEEKEND,
      heure_debut: g.heure_pivot_weekend,
      heure_fin: '24:00',
      prix_demi_terrain: g.weekend.apres.demi,
      prix_terrain_entier: g.weekend.apres.entier,
      priorite: 7,
      actif: 1,
      source: 'grille_standard',
    },
  ];
}

function pickBand(regles, type, when) {
  const list = (regles || []).filter((r) => r.type === type && Number(r.actif) !== 0);
  if (when === 'apres') {
    return (
      list.find((r) => hhmm(r.heure_debut) >= '18:00') ||
      list.find((r) => hhmm(r.heure_debut) && hhmm(r.heure_debut) !== '00:00')
    );
  }
  return list.find((r) => !r.heure_debut || hhmm(r.heure_debut) === '00:00' || hhmm(r.heure_debut) < '18:00');
}

function grilleFromRegles(regles, base = {}) {
  const grille = emptyGrille(base);
  const mapped = (regles || [])
    .map((r) => (r && r.prix_demi_terrain != null && r.jours ? r : mapRegle(r)))
    .filter(Boolean);
  const standard = mapped.filter((r) => r.source === 'grille_standard');
  const pool = standard.length ? standard : mapped;

  const sAvant = pickBand(pool, 'semaine', 'avant');
  const sApres = pickBand(pool, 'semaine', 'apres') || pool.find((r) => r.type === 'soiree');
  const wAvant = pickBand(pool, 'weekend', 'avant');
  const wApres = pickBand(pool, 'weekend', 'apres');

  if (sAvant) {
    grille.semaine.avant = { demi: sAvant.prix_demi_terrain, entier: sAvant.prix_terrain_entier };
    if (sAvant.heure_fin) grille.heure_pivot_semaine = hhmm(sAvant.heure_fin);
  }
  if (sApres) {
    grille.semaine.apres = { demi: sApres.prix_demi_terrain, entier: sApres.prix_terrain_entier };
    if (sApres.heure_debut && hhmm(sApres.heure_debut) !== '00:00') {
      grille.heure_pivot_semaine = hhmm(sApres.heure_debut);
    }
  }
  if (wAvant) {
    grille.weekend.avant = { demi: wAvant.prix_demi_terrain, entier: wAvant.prix_terrain_entier };
    if (wAvant.heure_fin) grille.heure_pivot_weekend = hhmm(wAvant.heure_fin);
  }
  if (wApres) {
    grille.weekend.apres = { demi: wApres.prix_demi_terrain, entier: wApres.prix_terrain_entier };
    if (wApres.heure_debut && hhmm(wApres.heure_debut) !== '00:00') {
      grille.heure_pivot_weekend = hhmm(wApres.heure_debut);
    }
  }
  return grille;
}

async function appliquerGrille(db, terrainId, body, base = {}) {
  const grille = normalizeGrille(body, base);
  await runSql(
    db,
    `UPDATE regles_tarifs SET actif = 0
      WHERE terrain_id = ? AND type IN ('semaine', 'weekend', 'soiree')`,
    [terrainId],
  );
  await runSql(db, `DELETE FROM regles_tarifs WHERE terrain_id = ? AND source = 'grille_standard'`, [terrainId]);
  const created = [];
  for (const rule of rulesFromGrille(grille)) {
    created.push(mapRegle(await creerRegle(db, terrainId, rule)));
  }
  return { grille, regles: created, apercu: await apercuPrix(db, terrainId) };
}

function parsePayload(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mapProposition(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    terrain_id: Number(row.terrain_id),
    demandeur_type: row.demandeur_type,
    demandeur_id: row.demandeur_id,
    statut: row.statut,
    commentaire: row.commentaire || null,
    created_at: row.created_at,
    traite_at: row.traite_at,
    payload: parsePayload(row.payload),
  };
}

async function getPropositionPending(db, terrainId) {
  return mapProposition(
    await queryOne(
      db,
      `SELECT * FROM propositions_grille_tarifs
        WHERE terrain_id = ? AND statut = 'en_attente'
        ORDER BY id DESC LIMIT 1`,
      [terrainId],
    ),
  );
}

async function proposerGrille(db, terrainId, body, demandeur) {
  const grille = normalizeGrille(body);
  const existing = await queryOne(
    db,
    `SELECT * FROM propositions_grille_tarifs
      WHERE terrain_id = ? AND statut = 'en_attente'
      ORDER BY id DESC LIMIT 1`,
    [terrainId],
  );
  const payload = JSON.stringify(grille);
  if (existing) {
    await runSql(
      db,
      `UPDATE propositions_grille_tarifs
        SET payload = ?, demandeur_type = ?, demandeur_id = ?, created_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [payload, demandeur?.type || null, demandeur?.id || null, existing.id],
    );
    return mapProposition(await queryOne(db, 'SELECT * FROM propositions_grille_tarifs WHERE id = ?', [existing.id]));
  }
  const result = await runSql(
    db,
    `INSERT INTO propositions_grille_tarifs
      (terrain_id, demandeur_type, demandeur_id, payload, statut)
     VALUES (?, ?, ?, ?, 'en_attente')`,
    [terrainId, demandeur?.type || null, demandeur?.id || null, payload],
  );
  return mapProposition(
    await queryOne(db, 'SELECT * FROM propositions_grille_tarifs WHERE id = ?', [result.lastInsertRowid]),
  );
}

async function listPropositions(db, { terrainId, statut } = {}) {
  const where = [];
  const params = [];
  if (terrainId) {
    where.push('terrain_id = ?');
    params.push(terrainId);
  }
  if (statut) {
    where.push('statut = ?');
    params.push(statut);
  }
  const sql = `SELECT * FROM propositions_grille_tarifs
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC, id DESC`;
  const rows = await queryAll(db, sql, params);
  return rows.map(mapProposition);
}

async function validerProposition(db, propositionId, adminId, base = {}) {
  const row = await queryOne(db, 'SELECT * FROM propositions_grille_tarifs WHERE id = ?', [propositionId]);
  if (!row) {
    const err = new Error('Proposition introuvable');
    err.statusCode = 404;
    throw err;
  }
  if (row.statut !== 'en_attente') {
    const err = new Error('Cette proposition a déjà été traitée');
    err.statusCode = 409;
    throw err;
  }
  const applied = await appliquerGrille(db, row.terrain_id, parsePayload(row.payload), base);
  await runSql(
    db,
    `UPDATE propositions_grille_tarifs
      SET statut = 'acceptee', traite_at = CURRENT_TIMESTAMP, traite_par = ?
      WHERE id = ?`,
    [adminId || null, propositionId],
  );
  return {
    proposition: mapProposition(
      await queryOne(db, 'SELECT * FROM propositions_grille_tarifs WHERE id = ?', [propositionId]),
    ),
    ...applied,
  };
}

async function refuserProposition(db, propositionId, adminId, commentaire) {
  const row = await queryOne(db, 'SELECT * FROM propositions_grille_tarifs WHERE id = ?', [propositionId]);
  if (!row) {
    const err = new Error('Proposition introuvable');
    err.statusCode = 404;
    throw err;
  }
  if (row.statut !== 'en_attente') {
    const err = new Error('Cette proposition a déjà été traitée');
    err.statusCode = 409;
    throw err;
  }
  await runSql(
    db,
    `UPDATE propositions_grille_tarifs
      SET statut = 'refusee', commentaire = ?, traite_at = CURRENT_TIMESTAMP, traite_par = ?
      WHERE id = ?`,
    [commentaire || null, adminId || null, propositionId],
  );
  return mapProposition(await queryOne(db, 'SELECT * FROM propositions_grille_tarifs WHERE id = ?', [propositionId]));
}

module.exports = {
  TYPES,
  JOURS,
  getPrixActif,
  listRegles,
  apercuPrix,
  creerRegle,
  modifierRegle,
  toggleRegle,
  supprimerRegle,
  mapRegle,
  friendlyNom,
  emptyGrille,
  normalizeGrille,
  grilleFromRegles,
  appliquerGrille,
  proposerGrille,
  getPropositionPending,
  listPropositions,
  validerProposition,
  refuserProposition,
};
