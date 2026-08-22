const crypto = require('crypto');
const { queryAll, queryOne, runSql } = require('../database');
const { hourlySlots, jourDepuisDate, addDaysYmd } = require('../scheduleService');
const { annulerReservationsConcurrentes } = require('../reservationLockService');

const TYPES = ['MANUEL', 'ABONNEMENT', 'TOURNOI'];
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const JOURS_SEMAINE = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];
const JOURS_WEEKEND = ['samedi', 'dimanche'];
const MAX_DAYS = 400;
const MAX_SLOTS = 2000;

function newGroupeId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function hhmm(value) {
  return String(value || '').trim().slice(0, 5);
}

function ymd(value) {
  return String(value || '').trim().slice(0, 10);
}

function parseJours(raw, fallback = JOURS_SEMAINE) {
  const listed = (Array.isArray(raw) ? raw : String(raw || '').split(','))
    .map((j) => String(j || '').trim().toLowerCase())
    .filter((j) => JOURS.includes(j));
  return listed.length ? listed : [...fallback];
}

function parseMontant(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function parseInclureCa(raw) {
  return raw === true || raw === 1 || raw === '1' || String(raw).toLowerCase() === 'true' ? 1 : 0;
}

async function sumEncaisseGroupe(db, groupeId) {
  const row = await queryOne(
    db,
    'SELECT COALESCE(SUM(montant), 0) AS total FROM encaissements_blocages WHERE groupe_id = ?',
    [groupeId],
  );
  return Number(row?.total || 0);
}

async function mapGroupeFinance(db, g) {
  const contrat = Number(g.montant || 0);
  const encaisse = await sumEncaisseGroupe(db, g.id);
  const reste = Math.max(0, contrat - encaisse);
  return {
    ...g,
    montant_contrat: contrat,
    montant_encaisse: encaisse,
    reste_a_encaisser: reste,
    nb_encaissements: Number(
      (await queryOne(db, 'SELECT COUNT(*) AS total FROM encaissements_blocages WHERE groupe_id = ?', [g.id]))
        ?.total || 0,
    ),
  };
}

function eachDate(debut, fin) {
  const dates = [];
  let cursor = debut;
  let guard = 0;
  while (cursor <= fin && guard < MAX_DAYS) {
    dates.push(cursor);
    cursor = addDaysYmd(cursor, 1);
    guard += 1;
  }
  return dates;
}

async function insertSlot(db, opts) {
  const terrainId = Number(opts.terrain_id);
  const date = ymd(opts.date);
  const heure_debut = hhmm(opts.heure_debut);
  const heure_fin = hhmm(opts.heure_fin);
  if (!date || !heure_debut || !heure_fin) {
    return { ok: false, error: 'Créneau invalide' };
  }

  const chevauchementResa = await queryAll(
    db,
    `SELECT id FROM reservations
      WHERE terrain_id = ? AND date = ?
        AND statut IN ('confirme', 'acceptee')
        AND heure_debut < ? AND heure_fin > ?`,
    [terrainId, date, heure_fin, heure_debut],
  );
  if (chevauchementResa.length) {
    return { ok: false, error: 'Réservation existante', date, heure_debut };
  }

  const chevauchementBlocage = await queryAll(
    db,
    `SELECT id FROM blocages_creneaux
      WHERE terrain_id = ? AND date = ?
        AND heure_debut < ? AND heure_fin > ?`,
    [terrainId, date, heure_fin, heure_debut],
  );
  if (chevauchementBlocage.length) {
    return { ok: false, error: 'Déjà bloqué', date, heure_debut };
  }

  const type_blocage = TYPES.includes(opts.type_blocage) ? opts.type_blocage : 'MANUEL';
  const result = await runSql(
    db,
    `INSERT INTO blocages_creneaux
      (terrain_id, employe_id, date, heure_debut, heure_fin, motif,
       type_blocage, montant, libelle, groupe_id, date_debut, date_fin, jours, inclure_dans_ca)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      terrainId,
      opts.employe_id || null,
      date,
      heure_debut,
      heure_fin,
      opts.motif || null,
      type_blocage,
      opts.montant ?? null,
      opts.libelle || null,
      opts.groupe_id || null,
      opts.date_debut || null,
      opts.date_fin || null,
      opts.jours || null,
      parseInclureCa(opts.inclure_dans_ca),
    ],
  );

  await runSql(
    db,
    `UPDATE creneaux SET statut = 'bloque'
      WHERE terrain_id = ? AND date = ?
        AND heure_debut >= ? AND heure_debut < ?`,
    [terrainId, date, heure_debut, heure_fin],
  );
  const existing = await queryOne(
    db,
    `SELECT id FROM creneaux
      WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?
      ORDER BY id DESC`,
    [terrainId, date, heure_debut, heure_fin],
  );
  if (!existing) {
    await runSql(
      db,
      'INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, ?)',
      [terrainId, date, heure_debut, heure_fin, 'bloque'],
    );
  }

  const blocage =
    await queryOne(db, 'SELECT * FROM blocages_creneaux WHERE id = ?', [result.lastInsertRowid]) ||
    await queryOne(
      db,
      `SELECT * FROM blocages_creneaux
        WHERE terrain_id = ? AND date = ? AND heure_debut = ? AND heure_fin = ?
        ORDER BY id DESC`,
      [terrainId, date, heure_debut, heure_fin],
    );

  const loserIds = await annulerReservationsConcurrentes(db, {
    id: 0,
    terrain_id: terrainId,
    date,
    heure_debut,
    heure_fin,
  });

  return { ok: true, blocage, loserIds: loserIds || [] };
}

function expandHourly(heureDebut, heureFin, creneaux) {
  if (Array.isArray(creneaux) && creneaux.length) {
    return creneaux
      .map((c) => ({
        heure_debut: hhmm(c.heure_debut),
        heure_fin: hhmm(c.heure_fin),
      }))
      .filter((c) => c.heure_debut && c.heure_fin);
  }
  return hourlySlots(heureDebut, heureFin);
}

async function createPeriode(db, body) {
  const terrainId = Number(body.terrain_id);
  const type_blocage = TYPES.includes(body.type_blocage) ? body.type_blocage : 'MANUEL';
  const date_debut = ymd(body.date_debut);
  const date_fin = ymd(body.date_fin || body.date_debut);
  const heure_debut = hhmm(body.heure_debut);
  const heure_fin = hhmm(body.heure_fin);
  const libelle = String(body.libelle || '').trim() || null;
  const montant = parseMontant(body.montant) || 0;
  const inclure_dans_ca = 0;
  const motif = body.motif ? String(body.motif) : type_blocage.toLowerCase();

  if (!date_debut || !date_fin || date_fin < date_debut) {
    const err = new Error('Période invalide (date début → date fin)');
    err.statusCode = 400;
    throw err;
  }

  const recouvreJours = type_blocage === 'ABONNEMENT' || type_blocage === 'TOURNOI';
  const jours = recouvreJours
    ? parseJours(body.jours, type_blocage === 'TOURNOI' ? JOURS_WEEKEND : JOURS_SEMAINE)
    : JOURS;
  const hourly = expandHourly(heure_debut, heure_fin, body.creneaux);
  if (!hourly.length) {
    const err = new Error('Indique une plage horaire ou des créneaux');
    err.statusCode = 400;
    throw err;
  }

  const dates = eachDate(date_debut, date_fin).filter((d) => {
    if (!recouvreJours) return true;
    return jours.includes(jourDepuisDate(d));
  });
  if (!dates.length) {
    const err = new Error('Aucun jour ne correspond à la récurrence choisie');
    err.statusCode = 400;
    throw err;
  }

  const planned = [];
  for (const date of dates) {
    for (const slot of hourly) {
      planned.push({ date, ...slot });
      if (planned.length > MAX_SLOTS) {
        const err = new Error('Période trop longue (maximum 2000 créneaux)');
        err.statusCode = 400;
        throw err;
      }
    }
  }

  const groupe_id = newGroupeId();
  const created = [];
  const errors = [];
  const loserIds = [];

  for (const slot of planned) {
    const result = await insertSlot(db, {
      terrain_id: terrainId,
      employe_id: body.employe_id,
      date: slot.date,
      heure_debut: slot.heure_debut,
      heure_fin: slot.heure_fin,
      motif,
      type_blocage,
      montant,
      libelle,
      groupe_id,
      date_debut,
      date_fin,
      jours: jours.join(','),
      inclure_dans_ca,
    });
    if (result.ok && result.blocage) {
      created.push(result.blocage);
      if (result.loserIds?.length) loserIds.push(...result.loserIds);
    } else {
      errors.push({
        date: slot.date,
        heure_debut: slot.heure_debut,
        error: result.error || 'Créneau non bloqué',
      });
    }
  }

  if (!created.length) {
    const err = new Error(errors[0]?.error || 'Aucun créneau bloqué');
    err.statusCode = 409;
    err.code = 'CRENEAU_CONFLIT';
    err.errors = errors;
    throw err;
  }

  await runSql(
    db,
    `INSERT INTO blocages_groupes
      (id, terrain_id, employe_id, type_blocage, libelle, date_debut, date_fin,
       jours, heure_debut, heure_fin, montant, motif, inclure_dans_ca)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      groupe_id,
      terrainId,
      body.employe_id || null,
      type_blocage,
      libelle,
      date_debut,
      date_fin,
      jours.join(','),
      hourly[0].heure_debut,
      hourly[hourly.length - 1].heure_fin,
      montant,
      motif,
      inclure_dans_ca,
    ],
  );

  const groupe = await queryOne(db, 'SELECT * FROM blocages_groupes WHERE id = ?', [groupe_id]);
  return {
    groupe,
    count: created.length,
    skipped: errors.length,
    blocages: created,
    errors,
    loserIds,
    message: `${created.length} créneau(x) bloqué(s) ✓`,
  };
}

async function listGroupes(db, terrainId, { type } = {}) {
  const types = type === 'ABONNEMENT' || type === 'TOURNOI' ? [type] : ['ABONNEMENT', 'TOURNOI'];
  const groupes = await queryAll(
    db,
    `SELECT * FROM blocages_groupes
      WHERE terrain_id = ? AND type_blocage IN (${types.map(() => '?').join(',')})
      ORDER BY date_debut DESC, created_at DESC`,
    [terrainId, ...types],
  );
  const out = [];
  for (const g of groupes) {
    const count = await queryOne(
      db,
      'SELECT COUNT(*) AS total FROM blocages_creneaux WHERE groupe_id = ?',
      [g.id],
    );
    out.push({ ...(await mapGroupeFinance(db, g)), nb_creneaux: Number(count?.total || 0) });
  }
  return out;
}

async function deleteGroupe(db, terrainId, groupeId) {
  const groupe = await queryOne(
    db,
    'SELECT * FROM blocages_groupes WHERE id = ? AND terrain_id = ?',
    [String(groupeId), terrainId],
  );
  if (!groupe) {
    const err = new Error('Série introuvable');
    err.statusCode = 404;
    throw err;
  }
  const slots = await queryAll(
    db,
    'SELECT * FROM blocages_creneaux WHERE groupe_id = ? AND terrain_id = ?',
    [groupe.id, terrainId],
  );
  for (const slot of slots) {
    await runSql(db, 'DELETE FROM blocages_creneaux WHERE id = ? AND terrain_id = ?', [slot.id, terrainId]);
    await runSql(
      db,
      `UPDATE creneaux SET statut = 'libre'
        WHERE terrain_id = ? AND date = ?
          AND heure_debut >= ? AND heure_debut < ?
          AND statut = 'bloque'`,
      [terrainId, slot.date, slot.heure_debut, slot.heure_fin],
    );
  }
  await runSql(db, 'DELETE FROM encaissements_blocages WHERE groupe_id = ?', [groupe.id]);
  await runSql(db, 'DELETE FROM blocages_groupes WHERE id = ? AND terrain_id = ?', [groupe.id, terrainId]);
  return { ok: true, id: groupe.id, count: slots.length };
}

async function libererSlot(db, terrainId, slot) {
  await runSql(db, 'DELETE FROM blocages_creneaux WHERE id = ? AND terrain_id = ?', [slot.id, terrainId]);
  await runSql(
    db,
    `UPDATE creneaux SET statut = 'libre'
      WHERE terrain_id = ? AND date = ?
        AND heure_debut >= ? AND heure_debut < ?
        AND statut = 'bloque'`,
    [terrainId, slot.date, slot.heure_debut, slot.heure_fin],
  );
}

async function deleteMany(db, terrainId, ids) {
  const unique = [...new Set((ids || []).map((id) => Number(id)).filter((id) => id > 0))];
  let count = 0;
  for (const id of unique) {
    const slot = await queryOne(db, 'SELECT * FROM blocages_creneaux WHERE id = ? AND terrain_id = ?', [id, terrainId]);
    if (!slot) continue;
    await libererSlot(db, terrainId, slot);
    count += 1;
  }
  return { ok: true, count };
}

function overlapYmd(a1, a2, b1, b2) {
  const start = a1 > b1 ? a1 : b1;
  const end = a2 < b2 ? a2 : b2;
  if (!start || !end || end < start) return null;
  return { start, end };
}

async function getGroupe(db, terrainId, groupeId) {
  const groupe = await queryOne(db, 'SELECT * FROM blocages_groupes WHERE id = ? AND terrain_id = ?', [
    String(groupeId),
    terrainId,
  ]);
  if (!groupe) {
    const err = new Error('Fiche introuvable');
    err.statusCode = 404;
    throw err;
  }
  const mapped = await mapGroupeFinance(db, groupe);
  const encaissements = await queryAll(
    db,
    `SELECT * FROM encaissements_blocages WHERE groupe_id = ? ORDER BY date_encaissement DESC, id DESC`,
    [groupe.id],
  );
  return {
    ...mapped,
    encaissements: encaissements.map((e) => ({
      id: Number(e.id),
      montant: Number(e.montant || 0),
      date_encaissement: ymd(e.date_encaissement),
      note: e.note || null,
      created_at: e.created_at,
    })),
  };
}

async function encaisserGroupe(db, terrainId, groupeId, body, employeId) {
  const fiche = await getGroupe(db, terrainId, groupeId);
  const montant = parseMontant(body?.montant);
  if (!(montant > 0)) {
    const err = new Error('Indique un montant à encaisser');
    err.statusCode = 400;
    throw err;
  }
  if (fiche.montant_contrat > 0 && montant > fiche.reste_a_encaisser) {
    const err = new Error(
      `Le reste à encaisser est de ${fiche.reste_a_encaisser.toLocaleString('fr-FR')} FCFA`,
    );
    err.statusCode = 400;
    throw err;
  }
  const date_encaissement = ymd(body?.date_encaissement) || ymd(new Date().toISOString());
  const note = String(body?.note || '').trim() || null;
  const result = await runSql(
    db,
    `INSERT INTO encaissements_blocages
      (groupe_id, terrain_id, employe_id, montant, date_encaissement, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [fiche.id, terrainId, employeId || null, montant, date_encaissement, note],
  );
  const ligne = await queryOne(db, 'SELECT * FROM encaissements_blocages WHERE id = ?', [result.lastInsertRowid]);
  return {
    encaissement: ligne,
    fiche: await getGroupe(db, terrainId, groupeId),
  };
}

async function encaissementsPeriode(db, terrainId, from, to) {
  const rows = await queryAll(
    db,
    `SELECT e.*, g.type_blocage, g.libelle
      FROM encaissements_blocages e
      JOIN blocages_groupes g ON g.id = e.groupe_id
      WHERE e.terrain_id = ?
        AND e.date_encaissement >= ? AND e.date_encaissement <= ?
      ORDER BY e.date_encaissement DESC, e.id DESC`,
    [terrainId, from, to],
  );
  let encaisse_abonnements = 0;
  let encaisse_tournois = 0;
  const historique = rows.map((e) => {
    const montant = Number(e.montant || 0);
    if (e.type_blocage === 'TOURNOI') encaisse_tournois += montant;
    else encaisse_abonnements += montant;
    return {
      id: `b-${e.id}`,
      date: ymd(e.date_encaissement),
      heure_debut: '',
      joueur_nom: e.libelle || (e.type_blocage === 'TOURNOI' ? 'Tournoi' : 'Abonnement'),
      montant_avance: montant,
      source: e.type_blocage === 'TOURNOI' ? 'tournoi' : 'abonnement',
    };
  });
  const encaisse_blocages = encaisse_abonnements + encaisse_tournois;
  const mention =
    encaisse_blocages > 0
      ? `Abonnements et tournois encaissés : ${encaisse_blocages.toLocaleString('fr-FR')} FCFA`
      : 'Les montants d’abonnement / tournoi ne sont pas pris en compte pour le moment';

  return {
    encaisse_abonnements,
    encaisse_tournois,
    encaisse_blocages,
    historique,
    mention,
  };
}

module.exports = {
  TYPES,
  insertSlot,
  createPeriode,
  listGroupes,
  deleteGroupe,
  deleteMany,
  getGroupe,
  encaisserGroupe,
  encaissementsPeriode,
};
