const { queryAll, queryOne, runSql } = require('./database');
const { hourlySlots, parseHour, veilleJour, jourDepuisDate } = require('./scheduleService');
const { bornesHorairesSemaine } = require('./scheduleService');
const { dureeMinutesOf, hhmm, addMinutesHhmm, timeToMinutes } = require('./services/creneauService');

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function prixBaseTerrain(terrain, format = 'entier') {
  if (format === 'moitie') {
    return Number(terrain.prix_moitie || Math.round(Number(terrain.prix_entier || terrain.prix_heure || 0) * 0.6));
  }
  return Number(terrain.prix_entier || terrain.prix_heure || 0);
}

async function overridePour(database, terrainId, jour, heure) {
  return await queryOne(
    database,
    'SELECT * FROM tarifs_dynamiques WHERE terrain_id = ? AND jour = ? AND heure = ?',
    [terrainId, jour, heure],
  );
}

async function prixHoraireEffectif(database, terrain, date, heureDebut, format = 'entier', jourOverride = null) {
  const heure = parseHour(heureDebut);
  let jour = jourOverride || jourDepuisDate(date);
  // Vendredi 00h (= Jeudi minuit) → grille tarifaire de la veille
  if (jourOverride == null && (heure === 0 || heure === 24)) {
    jour = veilleJour(jourDepuisDate(date));
  }
  const override = await overridePour(database, terrain.id, jour, heure === 24 ? 0 : heure);
  if (override) {
    return format === 'moitie' ? Number(override.prix_moitie) : Number(override.prix_entier);
  }
  return prixBaseTerrain(terrain, format);
}

async function prixDepuisRegleOuGrille(database, terrain, date, heureDebut, format = 'entier', jourOverride = null) {
  const { getPrixActif } = require('./services/tarifService');
  const actif = await getPrixActif(database, terrain.id, date, heureDebut, jourOverride);
  return format === 'moitie' ? Number(actif.prix_demi_terrain || 0) : Number(actif.prix_terrain_entier || 0);
}

/** Découpe une plage en segments horaires (dernier segment peut être partiel). */
function rangeHourSegments(heureDebut, heureFin) {
  const debut = hhmm(heureDebut);
  const fin = hhmm(heureFin);
  const total = dureeMinutesOf(debut, fin);
  if (!(total > 0)) return [];
  const segments = [];
  let cursor = debut;
  let remaining = total;
  while (remaining > 0) {
    const chunk = Math.min(60, remaining);
    const next = addMinutesHhmm(cursor, chunk);
    segments.push({
      heure_debut: cursor,
      heure_fin: next,
      minutes: chunk,
      fraction: chunk / 60,
    });
    cursor = next;
    remaining -= chunk;
    if (segments.length > 48) break;
  }
  return segments;
}

async function calculerPrixReservation(database, terrain, date, heureDebut, heureFin, format = 'entier') {
  const devis = await calculerDevis(database, terrain, {
    date,
    heure_debut: heureDebut,
    heure_fin: heureFin,
    format_terrain: format,
  });
  return Number(devis.montant || 0);
}

function calculerMontantAvance(terrain, prixChoisi) {
  const montant = Number(prixChoisi || 0);
  const pourcentageAvance = Number(terrain?.pourcentage_avance);
  if (Number.isFinite(pourcentageAvance) && pourcentageAvance > 0) {
    return Math.min(montant, Math.round((montant * pourcentageAvance) / 100));
  }
  return Math.min(montant, Number(terrain?.acompte || terrain?.montant_acompte || 5000));
}

async function calculerDevis(database, terrain, { date, heure_debut, heure_fin, format_terrain = 'entier' }) {
  const formatCle = String(format_terrain || 'entier').trim() || 'entier';
  const formatsService = require('./services/formatsTerrainService');
  const formatRow = await formatsService.getFormatByCle(database, terrain.id, formatCle);
  const grilleKey =
    formatRow?.map_grille === 'demi'
      ? 'moitie'
      : formatRow?.map_grille === 'entier'
        ? 'entier'
        : formatCle === 'moitie'
          ? 'moitie'
          : formatCle === 'entier'
            ? 'entier'
            : null;

  const segments = rangeHourSegments(heure_debut, heure_fin);
  if (!segments.length) {
    const err = new Error('Créneau invalide');
    err.statusCode = 400;
    throw err;
  }
  const { getPrixActif } = require('./services/tarifService');
  const detail = [];
  for (const seg of segments) {
    let prixH = 0;
    let nomTarif = formatRow?.label || formatCle;
    if (grilleKey === 'moitie' || grilleKey === 'entier') {
      const actif = await getPrixActif(database, terrain.id, date, seg.heure_debut);
      prixH = grilleKey === 'moitie' ? Number(actif.prix_demi_terrain || 0) : Number(actif.prix_terrain_entier || 0);
      nomTarif = actif.nom_tarif || nomTarif;
    } else {
      prixH = Number(formatRow?.prix_heure || prixBaseTerrain(terrain, 'entier') || 0);
    }
    const prix = Math.round(prixH * seg.fraction);
    detail.push({
      heure: seg.heure_debut,
      heure_fin: seg.heure_fin,
      prix,
      minutes: seg.minutes,
      nom_tarif: nomTarif,
    });
  }
  const montant = detail.reduce((sum, row) => sum + Number(row.prix || 0), 0);
  const montant_avance = calculerMontantAvance(terrain, montant);
  return {
    terrain_id: terrain.id,
    date,
    heure_debut: segments[0].heure_debut,
    heure_fin: segments[segments.length - 1].heure_fin,
    format_terrain: formatCle,
    duree_minutes: dureeMinutesOf(heure_debut, heure_fin),
    montant,
    montant_avance,
    montant_restant: Math.max(0, montant - montant_avance),
    montant_commission: calculerCommissionPrelevee(terrain, montant_avance),
    commission_pourcentage: Number(terrain.commission_pourcentage || 0),
    detail,
  };
}

async function grilleTarifs(database, terrain, heureMin = null, heureMax = null) {
  const horaires = await queryAll(database, 'SELECT * FROM horaires WHERE terrain_id = ?', [terrain.id]);
  const bornes = bornesHorairesSemaine(horaires);
  const minH = heureMin == null ? bornes.heure_min : heureMin;
  const maxH = heureMax == null ? bornes.heure_max : heureMax;

  const overrides = await queryAll(
    database,
    'SELECT jour, heure, prix_entier, prix_moitie FROM tarifs_dynamiques WHERE terrain_id = ?',
    [terrain.id],
  );
  const map = new Map(overrides.map((o) => [`${o.jour}-${o.heure}`, o]));
  const baseEntier = prixBaseTerrain(terrain, 'entier');
  const baseMoitie = prixBaseTerrain(terrain, 'moitie');
  const cellules = [];

  for (const jour of JOURS) {
    for (let heure = minH; heure < maxH; heure += 1) {
      const hourKey = heure === 24 ? 0 : heure;
      if (heure === 24) continue;
      const ov = map.get(`${jour}-${hourKey}`);
      cellules.push({
        jour,
        heure: hourKey,
        prix_entier: ov ? Number(ov.prix_entier) : baseEntier,
        prix_moitie: ov ? Number(ov.prix_moitie) : baseMoitie,
        est_personnalise: Boolean(ov),
        label: hourKey === 0 ? 'Minuit (nuit veille)' : undefined,
      });
    }
  }

  return {
    terrain_id: terrain.id,
    prix_entier_base: baseEntier,
    prix_moitie_base: baseMoitie,
    pourcentage_avance: Number(terrain.pourcentage_avance || 12.5),
    heure_min: minH,
    heure_max: maxH > 24 ? 24 : maxH,
    jours: JOURS,
    cellules,
    note_minuit:
      'Le créneau 00:00 du calendrier (ex. vendredi) correspond à « Jeudi minuit » en programmation locale.',
  };
}

/**
 * Remplace / met à jour la grille. Les cellules égales au tarif de base sont retirées (pas d'override inutile).
 */
async function sauvegarderGrille(database, terrainId, payload) {
  const terrain = await queryOne(database, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  if (!terrain) {
    const err = new Error('Terrain non trouvé');
    err.statusCode = 404;
    throw err;
  }

  const prixEntierBase = Number(payload.prix_entier_base ?? terrain.prix_entier ?? terrain.prix_heure);
  const prixMoitieBase = Number(payload.prix_moitie_base ?? terrain.prix_moitie ?? Math.round(prixEntierBase * 0.6));
  if (!(prixEntierBase > 0) || !(prixMoitieBase > 0)) {
    const err = new Error('Les tarifs de base doivent être positifs');
    err.statusCode = 400;
    throw err;
  }

  await runSql(
    database,
    `UPDATE terrains SET prix_heure = ?, prix_entier = ?, prix_moitie = ?,
      montant_acompte = ROUND(? * COALESCE(pourcentage_avance, 12.5) / 100.0),
      acompte = ROUND(? * COALESCE(pourcentage_avance, 12.5) / 100.0)
     WHERE id = ?`,
    [prixEntierBase, prixEntierBase, prixMoitieBase, prixEntierBase, prixEntierBase, terrainId],
  );

  const cellules = Array.isArray(payload.cellules) ? payload.cellules : [];
  await runSql(database, 'DELETE FROM tarifs_dynamiques WHERE terrain_id = ?', [terrainId]);

  for (const cell of cellules) {
    const jour = String(cell.jour || '').toLowerCase();
    const heure = Number(cell.heure);
    const pe = Number(cell.prix_entier);
    const pm = Number(cell.prix_moitie);
    if (!JOURS.includes(jour) || !Number.isInteger(heure) || heure < 0 || heure > 23) continue;
    if (!(pe > 0) || !(pm > 0)) continue;
    const sameAsBase = pe === prixEntierBase && pm === prixMoitieBase;
    if (sameAsBase) continue;
    await runSql(
      database,
      `INSERT INTO tarifs_dynamiques (terrain_id, jour, heure, prix_entier, prix_moitie)
       VALUES (?, ?, ?, ?, ?)`,
      [terrainId, jour, heure, pe, pm],
    );
  }

  const updated = await queryOne(database, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);
  return grilleTarifs(database, updated);
}

function calculerCommissionPrelevee(terrain, montantAvance) {
  if (terrain?.modele_revenus && terrain.modele_revenus !== 'commission') return 0;
  const commissionPourcentage = Number(terrain?.commission_pourcentage);
  if (Number.isFinite(commissionPourcentage) && commissionPourcentage > 0) {
    return Math.min(montantAvance, Math.round((montantAvance * commissionPourcentage) / 100));
  }
  return Math.min(montantAvance, Number(terrain?.commission || 0));
}

module.exports = {
  JOURS,
  jourDepuisDate,
  prixBaseTerrain,
  prixHoraireEffectif,
  calculerPrixReservation,
  calculerDevis,
  calculerMontantAvance,
  calculerCommissionPrelevee,
  grilleTarifs,
  sauvegarderGrille,
};
