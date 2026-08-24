/**
 * Agrège détail terrain + créneaux du jour en un seul payload (anti-waterfall mobile).
 */
const { queryOne, queryAll } = require('../database');
const { listTerrainPhotos } = require('../terrainPhotoService');
const commoditesService = require('./commoditesService');
const formatsService = require('./formatsTerrainService');
const featuresService = require('./terrainFeaturesService');
const bookingAvail = require('./terrainBookingAvailability');
const creneauService = require('./creneauService');

function todayLocalYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Ne PAS griser les créneaux libres quand WhatsApp est down :
 * le joueur doit pouvoir voir la dispo de la semaine ; seul le paiement en ligne est bloqué.
 */
function annotateEnLigneIndispo(creneaux, availability) {
  if (!availability?.en_ligne_indisponible) return creneaux || [];
  return (creneaux || []).map((c) => ({
    ...c,
    en_ligne_indisponible: true,
    // disponible reste inchangé (libre = libre visuellement)
    booking_online_blocked: Boolean(c.disponible),
  }));
}

/**
 * @param {import('pg').Pool|any} db
 * @param {number} terrainId
 * @param {{ date?: string, duree_minutes?: number|null, serializeTerrain: Function }} opts
 */
async function getTerrainFullDetails(db, terrainId, opts) {
  const tid = Number(terrainId);
  const dateStr = String(opts.date || todayLocalYmd()).slice(0, 10);
  const dureeParam = opts.duree_minutes != null ? Number(opts.duree_minutes) : null;
  const serializeTerrain = opts.serializeTerrain;

  const terrain = await queryOne(
    db,
    `
      SELECT t.*,
        COALESCE(ROUND(AVG(a.note), 1), 0) as note,
        COUNT(a.id) as avis_count,
        p.nom as proprietaire_nom
      FROM terrains t
      LEFT JOIN avis a ON a.terrain_id = t.id
      LEFT JOIN proprietaires p ON p.id = t.proprietaire_id
      WHERE t.id = ?
      GROUP BY t.id, p.nom
    `,
    [tid],
  );
  if (!terrain) {
    const err = new Error('Terrain non trouvé');
    err.statusCode = 404;
    throw err;
  }

  const [
    horaires,
    avis,
    employe,
    photoRows,
    formatsPayload,
    features,
    commodites,
    availability,
    creneauxPayload,
  ] = await Promise.all([
    queryAll(
      db,
      `SELECT * FROM horaires WHERE terrain_id = ?
       ORDER BY CASE jour
         WHEN 'lundi' THEN 1 WHEN 'mardi' THEN 2 WHEN 'mercredi' THEN 3
         WHEN 'jeudi' THEN 4 WHEN 'vendredi' THEN 5 WHEN 'samedi' THEN 6 WHEN 'dimanche' THEN 7 END`,
      [tid],
    ),
    queryAll(
      db,
      `SELECT a.*, u.nom as joueur_nom
       FROM avis a LEFT JOIN users u ON u.id = a.joueur_id
       WHERE a.terrain_id = ?
       ORDER BY a.created_at DESC
       LIMIT 40`,
      [tid],
    ),
    queryOne(
      db,
      `SELECT whatsapp_number, telephone, nom, prenom
       FROM employes WHERE terrain_id = ? AND is_active = 1 LIMIT 1`,
      [tid],
    ),
    listTerrainPhotos(db, tid),
    formatsService.attachFormatsToTerrainPayload(db, terrain),
    featuresService.featuresFlags(db, tid),
    commoditesService.publicCommodites(db, tid),
    bookingAvail.getTerrainBookingAvailability(tid).catch(() => ({
      en_ligne_indisponible: false,
      booking_online_available: true,
      whatsapp_status: null,
      gerant_telephone: null,
      gerant_tel_href: null,
      gerant_nom: null,
      message: null,
    })),
    creneauService.getDisponibilitesPourJoueur(db, tid, dateStr, {
      duree_minutes: Number.isFinite(dureeParam) && dureeParam > 0 ? dureeParam : null,
    }),
  ]);

  const { formats, durees } = formatsPayload;
  const gerantPhone =
    availability.gerant_telephone || employe?.whatsapp_number || employe?.telephone || null;

  let creneaux = [];
  let creneauxMeta = {
    ferme: Boolean(creneauxPayload.ferme),
    motif: creneauxPayload.motif || null,
    horaire: creneauxPayload.horaire || null,
    calendrier: creneauxPayload.calendrier || 'senegal',
    note_minuit: creneauxPayload.note_minuit,
    message: creneauxPayload.message,
    prix_entier_base: creneauxPayload.prix_entier_base,
    prix_moitie_base: creneauxPayload.prix_moitie_base,
    pourcentage_avance: creneauxPayload.pourcentage_avance,
  };

  if (!creneauxPayload.ferme) {
    creneaux = annotateEnLigneIndispo(
      creneauService.exclureCreneauxHorairesPasses(creneauxPayload.creneaux || [], dateStr),
      availability,
    );
  }

  const terrainPublic = serializeTerrain(terrain, photoRows, commodites);

  return {
    ...terrainPublic,
    formats,
    durees,
    features,
    horaires,
    avis,
    employe: employe
      ? {
          ...employe,
          whatsapp_number: gerantPhone || employe.whatsapp_number,
          telephone: gerantPhone || employe.telephone,
        }
      : availability.gerant_telephone
        ? {
            whatsapp_number: availability.gerant_telephone,
            telephone: availability.gerant_telephone,
            nom: availability.gerant_nom,
          }
        : null,
    en_ligne_indisponible: availability.en_ligne_indisponible,
    booking_online_available: availability.booking_online_available,
    whatsapp_gerant_status: availability.whatsapp_status,
    gerant_telephone: gerantPhone,
    gerant_tel_href: availability.gerant_tel_href || bookingAvail.telHref(gerantPhone),
    gerant_nom: availability.gerant_nom,
    booking_message: availability.message,
    /** Bloc créneaux du jour demandé — évite un 2e round-trip */
    planning: {
      date: dateStr,
      terrain_id: tid,
      creneaux,
      ...creneauxMeta,
      heure_serveur: new Date().toISOString(),
      en_ligne_indisponible: availability.en_ligne_indisponible,
      booking_online_available: availability.booking_online_available,
      gerant_tel_href: availability.gerant_tel_href || bookingAvail.telHref(gerantPhone),
      booking_message: availability.message,
    },
  };
}

module.exports = { getTerrainFullDetails, todayLocalYmd };
