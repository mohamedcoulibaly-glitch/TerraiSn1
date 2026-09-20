const { queryOne, queryAll } = require('../database');
const {
  arrondiFcfa,
  normaliserNumeroSn,
  masquerNumero,
  previewFormules,
  texteAnnulationJoueur,
} = require('./calculsPaiement');

const CANAL_STATUTS = ['absent', 'saisi', 'test_envoye', 'verifie'];
const PAYOUT_MODES = ['auto', 'retrait'];
const FRAIS_POLITIQUES = ['gerant', 'plateforme', 'partage'];
const CANAUX = ['wave', 'om', 'les_deux'];

function bool01(value, fallback = 0) {
  if (value === true || value === 1 || value === '1' || value === 'oui' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'non' || value === 'false') return 0;
  return fallback;
}

function gerantActif(db, terrain) {
  const preferId = Number(terrain?.gerant_id || 0);
  if (preferId) {
    const exact = queryOne(
      db,
      'SELECT * FROM employes WHERE id = ? AND is_active = 1',
      [preferId],
    );
    if (exact) return exact;
  }
  return queryOne(
    db,
    `SELECT * FROM employes
      WHERE terrain_id = ? AND is_active = 1
      ORDER BY id ASC LIMIT 1`,
    [terrain.id],
  );
}

function statutCanal(numero, statut) {
  if (!numero) return 'absent';
  const s = String(statut || 'saisi');
  return CANAL_STATUTS.includes(s) ? s : 'saisi';
}

function canalVerifie(contrat, canal) {
  if (canal === 'wave') return contrat.wave_statut === 'verifie' && Boolean(contrat.wave_numero);
  if (canal === 'om') return contrat.om_statut === 'verifie' && Boolean(contrat.om_numero);
  return false;
}

function auMoinsUnCanalVerifie(contrat) {
  const pref = contrat.canal_reversement || 'wave';
  if (pref === 'wave') return canalVerifie(contrat, 'wave');
  if (pref === 'om') return canalVerifie(contrat, 'om');
  return canalVerifie(contrat, 'wave') || canalVerifie(contrat, 'om');
}

function numeroPayout(contrat) {
  const pref = contrat.canal_reversement || 'wave';
  const ordered = pref === 'om' ? ['om', 'wave'] : ['wave', 'om'];
  if (pref === 'les_deux') {
    ordered.splice(0, ordered.length, 'wave', 'om');
  }
  for (const canal of ordered) {
    if (canalVerifie(contrat, canal)) {
      return {
        canal,
        numero: canal === 'wave' ? contrat.wave_numero : contrat.om_numero,
      };
    }
  }
  return null;
}

function mapperContrat(terrain, gerant) {
  const remboursementAutorise = Number(terrain.remboursement_autorise) === 1;
  const delai = remboursementAutorise
    ? Math.max(0, arrondiFcfa(terrain.delai_remboursement_heures))
    : 0;
  return {
    terrain_id: terrain.id,
    terrain_nom: terrain.nom,
    proprietaire_id: terrain.proprietaire_id,
    gerant_id: gerant?.id || terrain.gerant_id || null,
    gerant_nom: gerant?.nom || null,
    gerant_whatsapp: gerant?.whatsapp_number || gerant?.telephone || null,
    pourcentage_avance: Number(terrain.pourcentage_avance || 0),
    commission_pourcentage: Number(terrain.commission_pourcentage || 0),
    remboursement_autorise: remboursementAutorise ? 1 : 0,
    delai_remboursement_heures: delai,
    payout_mode: terrain.payout_mode === 'auto' ? 'auto' : 'retrait',
    payout_frais_politique: FRAIS_POLITIQUES.includes(terrain.payout_frais_politique)
      ? terrain.payout_frais_politique
      : 'gerant',
    frais_payout_pct_gerant: Number(terrain.frais_payout_pct_gerant ?? 1),
    frais_payout_pct_plateforme: Number(terrain.frais_payout_pct_plateforme ?? 1),
    wave_numero: terrain.wave_numero || null,
    wave_statut: statutCanal(terrain.wave_numero, terrain.wave_statut),
    wave_verifie_at: terrain.wave_verifie_at || null,
    om_numero: terrain.om_numero || null,
    om_statut: statutCanal(terrain.om_numero, terrain.om_statut),
    om_verifie_at: terrain.om_verifie_at || null,
    numeros_identiques_whatsapp: Number(terrain.numeros_identiques_whatsapp) === 1 ? 1 : 0,
    canal_reversement: CANAUX.includes(terrain.canal_reversement) ? terrain.canal_reversement : 'wave',
    contrat_version: Number(terrain.contrat_version || 1),
    contrat_signe_at: terrain.contrat_signe_at || null,
    paiement_production: Number(terrain.paiement_production) === 1 ? 1 : 0,
    texte_annulation_joueur: texteAnnulationJoueur({
      remboursement_autorise: remboursementAutorise ? 1 : 0,
      delai_remboursement_heures: delai,
    }),
  };
}

function chargerContrat(db, terrainId) {
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(terrainId)]);
  if (!terrain) return null;
  const gerant = gerantActif(db, terrain);
  const contrat = mapperContrat(terrain, gerant);
  contrat.canal_verifie = auMoinsUnCanalVerifie(contrat);
  contrat.payout_destination = numeroPayout(contrat);
  contrat.preview = previewFormules(contrat, 40000);
  return contrat;
}

function snapshotContrat(contrat) {
  const keys = [
    'pourcentage_avance', 'commission_pourcentage', 'remboursement_autorise',
    'delai_remboursement_heures', 'payout_mode', 'payout_frais_politique',
    'frais_payout_pct_gerant', 'frais_payout_pct_plateforme',
    'wave_numero', 'wave_statut', 'om_numero', 'om_statut',
    'numeros_identiques_whatsapp', 'canal_reversement', 'gerant_id', 'paiement_production',
  ];
  const out = {};
  for (const key of keys) out[key] = contrat[key] ?? null;
  return out;
}

function validerPayloadContrat(body = {}, terrain, gerant) {
  const pourcentageAvance = Number(body.pourcentage_avance ?? terrain.pourcentage_avance ?? 0);
  const commissionPourcentage = Number(body.commission_pourcentage ?? terrain.commission_pourcentage ?? 0);
  if (!Number.isFinite(pourcentageAvance) || pourcentageAvance <= 0 || pourcentageAvance > 100) {
    const err = new Error('% avance invalide');
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(commissionPourcentage) || commissionPourcentage < 0 || commissionPourcentage > 100) {
    const err = new Error('% commission invalide');
    err.statusCode = 400;
    throw err;
  }

  const remboursementAutorise = bool01(body.remboursement_autorise, Number(terrain.remboursement_autorise) === 1 ? 1 : 0);
  let delai = arrondiFcfa(body.delai_remboursement_heures ?? terrain.delai_remboursement_heures ?? 0);
  if (remboursementAutorise !== 1) delai = 0;
  if (delai < 0 || delai > 24 * 30) {
    const err = new Error('Délai de remboursement invalide');
    err.statusCode = 400;
    throw err;
  }

  const payoutMode = body.payout_mode || terrain.payout_mode || 'retrait';
  if (!PAYOUT_MODES.includes(payoutMode)) {
    const err = new Error('Mode de reversement invalide (auto | retrait)');
    err.statusCode = 400;
    throw err;
  }

  const politique = body.payout_frais_politique || terrain.payout_frais_politique || 'gerant';
  if (!FRAIS_POLITIQUES.includes(politique)) {
    const err = new Error('Politique de frais invalide');
    err.statusCode = 400;
    throw err;
  }

  let pctGerant = Number(body.frais_payout_pct_gerant ?? terrain.frais_payout_pct_gerant ?? 1);
  let pctPlateforme = Number(body.frais_payout_pct_plateforme ?? terrain.frais_payout_pct_plateforme ?? 1);
  if (politique === 'partage') {
    if (!Number.isFinite(pctGerant)) pctGerant = 1;
    if (!Number.isFinite(pctPlateforme)) pctPlateforme = 1;
  }
  if (!Number.isFinite(pctGerant) || pctGerant < 0 || pctGerant > 20
    || !Number.isFinite(pctPlateforme) || pctPlateforme < 0 || pctPlateforme > 20) {
    const err = new Error('% frais payout invalide');
    err.statusCode = 400;
    throw err;
  }

  const identiques = bool01(body.numeros_identiques_whatsapp, Number(terrain.numeros_identiques_whatsapp) === 1 ? 1 : 0);
  const whatsapp = normaliserNumeroSn(gerant?.whatsapp_number || gerant?.telephone);
  let wave = normaliserNumeroSn(body.wave_numero !== undefined ? body.wave_numero : terrain.wave_numero);
  let om = normaliserNumeroSn(body.om_numero !== undefined ? body.om_numero : terrain.om_numero);
  if (identiques) {
    const source = whatsapp || wave || om;
    wave = source;
    om = source;
  }

  let waveStatut = statutCanal(wave, body.wave_statut || terrain.wave_statut);
  let omStatut = statutCanal(om, body.om_statut || terrain.om_statut);
  if (wave !== (terrain.wave_numero || null) && body.wave_statut == null) {
    waveStatut = wave ? 'saisi' : 'absent';
  }
  if (om !== (terrain.om_numero || null) && body.om_statut == null) {
    omStatut = om ? 'saisi' : 'absent';
  }

  const canal = body.canal_reversement || terrain.canal_reversement || 'wave';
  if (!CANAUX.includes(canal)) {
    const err = new Error('Canal de reversement invalide');
    err.statusCode = 400;
    throw err;
  }

  const gerantId = body.gerant_id != null ? Number(body.gerant_id) : (gerant?.id || terrain.gerant_id || null);
  const paiementProduction = bool01(body.paiement_production ?? body.production_paiement, Number(terrain.paiement_production) === 1 ? 1 : 0);

  return {
    pourcentage_avance: pourcentageAvance,
    commission_pourcentage: commissionPourcentage,
    remboursement_autorise: remboursementAutorise,
    delai_remboursement_heures: delai,
    payout_mode: payoutMode,
    payout_frais_politique: politique,
    frais_payout_pct_gerant: pctGerant,
    frais_payout_pct_plateforme: pctPlateforme,
    wave_numero: wave,
    wave_statut: waveStatut,
    om_numero: om,
    om_statut: omStatut,
    numeros_identiques_whatsapp: identiques,
    canal_reversement: canal,
    gerant_id: gerantId,
    paiement_production: paiementProduction,
  };
}

function enregistrerContrat(db, terrainId, body, { auteurId = null } = {}) {
  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [Number(terrainId)]);
  if (!terrain) {
    const err = new Error('Terrain introuvable');
    err.statusCode = 404;
    throw err;
  }
  const gerant = gerantActif(db, { ...terrain, gerant_id: body.gerant_id ?? terrain.gerant_id });
  const avant = snapshotContrat(mapperContrat(terrain, gerant));
  const next = validerPayloadContrat(body, terrain, gerant);
  const gerantChange = Number(next.gerant_id || 0) !== Number(terrain.gerant_id || gerant?.id || 0);
  if (gerantChange) {
    next.wave_statut = next.wave_numero ? 'saisi' : 'absent';
    next.om_statut = next.om_numero ? 'saisi' : 'absent';
  }

  const version = Number(terrain.contrat_version || 1) + 1;
  const avanceReference = Math.round((Number(terrain.prix_entier || terrain.prix_heure || 0) * next.pourcentage_avance) / 100);
  const commissionReference = Math.round((avanceReference * next.commission_pourcentage) / 100);
  const nowIso = new Date().toISOString();
  const waveVerifieAt = next.wave_statut === 'verifie' ? (terrain.wave_verifie_at || nowIso) : null;
  const omVerifieAt = next.om_statut === 'verifie' ? (terrain.om_verifie_at || nowIso) : null;

  db.run(
    `UPDATE terrains SET
      pourcentage_avance = ?, commission_pourcentage = ?, commission = ?,
      acompte = ?, montant_acompte = ?,
      remboursement_autorise = ?, delai_remboursement_heures = ?,
      payout_mode = ?, payout_frais_politique = ?,
      frais_payout_pct_gerant = ?, frais_payout_pct_plateforme = ?,
      wave_numero = ?, wave_statut = ?, wave_verifie_at = ?,
      om_numero = ?, om_statut = ?, om_verifie_at = ?,
      numeros_identiques_whatsapp = ?, canal_reversement = ?,
      gerant_id = ?, paiement_production = ?, contrat_version = ?, contrat_signe_at = COALESCE(contrat_signe_at, ?)
     WHERE id = ?`,
    [
      next.pourcentage_avance, next.commission_pourcentage, commissionReference,
      avanceReference, avanceReference,
      next.remboursement_autorise, next.delai_remboursement_heures,
      next.payout_mode, next.payout_frais_politique,
      next.frais_payout_pct_gerant, next.frais_payout_pct_plateforme,
      next.wave_numero, next.wave_statut, waveVerifieAt,
      next.om_numero, next.om_statut, omVerifieAt,
      next.numeros_identiques_whatsapp, next.canal_reversement,
      next.gerant_id, next.paiement_production, version, nowIso,
      Number(terrainId),
    ],
  );

  db.run(
    `INSERT INTO contrat_avenants (terrain_id, contrat_version, avant, apres, auteur_id)
     VALUES (?, ?, ?, ?, ?)`,
    [Number(terrainId), version, JSON.stringify(avant), JSON.stringify(next), auteurId],
  );

  return chargerContrat(db, terrainId);
}

function contratLectureGerant(contrat) {
  if (!contrat) return null;
  return {
    ...contrat,
    preview: contrat.preview,
    lecture_seule: true,
  };
}

function contratLectureProprio(contrat) {
  if (!contrat) return null;
  return {
    terrain_id: contrat.terrain_id,
    terrain_nom: contrat.terrain_nom,
    pourcentage_avance: contrat.pourcentage_avance,
    commission_pourcentage: contrat.commission_pourcentage,
    remboursement_autorise: contrat.remboursement_autorise,
    delai_remboursement_heures: contrat.delai_remboursement_heures,
    texte_annulation_joueur: contrat.texte_annulation_joueur,
    payout_mode: contrat.payout_mode,
    payout_frais_politique: contrat.payout_frais_politique,
    frais_payout_pct_gerant: contrat.frais_payout_pct_gerant,
    frais_payout_pct_plateforme: contrat.frais_payout_pct_plateforme,
    canal_reversement: contrat.canal_reversement,
    canal_verifie: contrat.canal_verifie,
    wave_numero_masque: masquerNumero(contrat.wave_numero),
    om_numero_masque: masquerNumero(contrat.om_numero),
    wave_statut: contrat.wave_statut,
    om_statut: contrat.om_statut,
    gerant_nom: contrat.gerant_nom,
    preview: contrat.preview,
    lecture_seule: true,
    beneficiaire: 'gerant',
  };
}

function resumeListeTerrain(db, terrain) {
  const contrat = chargerContrat(db, terrain.id);
  const dus = queryOne(
    db,
    `SELECT
      COALESCE(SUM(CASE WHEN statut NOT IN ('annule_rembourse') THEN du_gerant ELSE 0 END), 0) AS du_total,
      COALESCE(SUM(CASE WHEN statut IN ('en_fenetre','payable','demande_retrait','echec') THEN du_gerant ELSE 0 END), 0) AS encore_du
     FROM dus WHERE terrain_id = ?`,
    [terrain.id],
  ) || {};
  return {
    ...terrain,
    contrat_resume: {
      commission_pourcentage: contrat.commission_pourcentage,
      pourcentage_avance: contrat.pourcentage_avance,
      remboursement: contrat.remboursement_autorise ? `${contrat.delai_remboursement_heures} h` : 'non',
      payout_mode: contrat.payout_mode,
      frais_label: contrat.payout_mode === 'retrait'
        ? 'Retrait 0 frais'
        : `Auto ${contrat.payout_frais_politique === 'partage'
          ? `${contrat.frais_payout_pct_gerant}+${contrat.frais_payout_pct_plateforme}`
          : contrat.payout_frais_politique}`,
      wave_om_verifies: contrat.canal_verifie,
      wave_statut: contrat.wave_statut,
      om_statut: contrat.om_statut,
      encore_du: Number(dus.encore_du || 0),
    },
  };
}

function avenantsTerrain(db, terrainId) {
  return queryAll(
    db,
    `SELECT id, contrat_version, avant, apres, auteur_id, created_at
     FROM contrat_avenants WHERE terrain_id = ? ORDER BY contrat_version DESC`,
    [Number(terrainId)],
  ).map((row) => ({
    ...row,
    avant: row.avant ? JSON.parse(row.avant) : null,
    apres: row.apres ? JSON.parse(row.apres) : null,
  }));
}

module.exports = {
  chargerContrat,
  enregistrerContrat,
  gerantActif,
  auMoinsUnCanalVerifie,
  numeroPayout,
  canalVerifie,
  contratLectureGerant,
  contratLectureProprio,
  resumeListeTerrain,
  previewFormules,
  avenantsTerrain,
  snapshotContrat,
};
