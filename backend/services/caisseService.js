const { queryOne, queryAll } = require('../database');
const { chargerContrat, auMoinsUnCanalVerifie } = require('./contratService');
const { ventilationDu } = require('./ledgerService');
const { caisseDisponible } = require('./payoutEngine');

function n(value) {
  return Number(value || 0);
}

function kpisCaisse(db) {
  const payin = queryOne(
    db,
    `SELECT COALESCE(SUM(montant), 0) AS total FROM paiements
      WHERE statut = 'paye' AND methode IN ('paytech', 'paydunya')`,
  );
  const rembourse = queryOne(
    db,
    `SELECT COALESCE(SUM(montant), 0) AS total FROM paiements WHERE statut = 'rembourse'`,
  );
  const dus = queryAll(db, 'SELECT * FROM dus');
  const terrainsById = new Map(
    queryAll(db, 'SELECT id FROM terrains').map((t) => [t.id, chargerContrat(db, t.id)]),
  );

  let commissionAcquise = 0;
  let commissionEnFenetre = 0;
  let duEnFenetre = 0;
  let duPayable = 0;
  let fraisGerant = 0;
  let fraisPlateforme = 0;
  let envoyes = 0;
  let bloqueSansNumero = 0;
  let echecs = 0;

  for (const du of dus) {
    const contrat = terrainsById.get(du.terrain_id);
    if (du.statut === 'annule_rembourse') continue;
    if (du.statut === 'en_fenetre') {
      commissionEnFenetre += n(du.commission);
      duEnFenetre += n(du.du_gerant);
    } else {
      commissionAcquise += n(du.commission);
    }
    if (du.statut === 'verse') {
      envoyes += n(du.du_gerant);
      fraisGerant += n(du.frais_gerant);
      fraisPlateforme += n(du.frais_plateforme);
    } else if (['payable', 'demande_retrait', 'echec'].includes(du.statut)) {
      duPayable += n(du.du_gerant);
      if (du.statut === 'echec') echecs += n(du.du_gerant);
      if (!auMoinsUnCanalVerifie(contrat || {})) bloqueSansNumero += n(du.du_gerant);
    }
  }

  const fileRetraits = n(queryOne(db, "SELECT COUNT(*) AS total FROM demandes_retrait WHERE statut = 'en_attente'")?.total);
  const retraitsAnciens = n(queryOne(
    db,
    `SELECT COUNT(*) AS total FROM demandes_retrait
      WHERE statut = 'en_attente' AND created_at <= datetime('now', '-1 hour')`,
  )?.total);
  const terrainsSansNumero = queryAll(
    db,
    `SELECT t.id, t.nom FROM terrains t WHERE t.is_active = 1`,
  ).filter((t) => !auMoinsUnCanalVerifie(chargerContrat(db, t.id)));
  const testsEnAttente = queryAll(
    db,
    `SELECT id, nom, wave_statut, om_statut FROM terrains WHERE is_active = 1`,
  ).filter((t) => t.wave_statut === 'test_envoye' || t.om_statut === 'test_envoye');
  const fenetresExpirees = n(queryOne(
    db,
    `SELECT COUNT(*) AS total FROM dus
      WHERE statut = 'en_fenetre' AND fenetre_expire_at IS NOT NULL AND fenetre_expire_at <= ?`,
    [new Date().toISOString()],
  )?.total);

  return {
    encaisse_paytech: n(payin?.total),
    rembourse: n(rembourse?.total),
    commission_acquise: commissionAcquise,
    commission_en_fenetre: commissionEnFenetre,
    du_en_fenetre: duEnFenetre,
    du_payable: duPayable,
    file_retraits: fileRetraits,
    bloque_sans_numero: bloqueSansNumero,
    auto_payouts_echecs: echecs,
    frais_payout_gerant: fraisGerant,
    frais_payout_plateforme: fraisPlateforme,
    caisse_disponible: caisseDisponible(db),
    alertes: {
      terrains_sans_wave_om: terrainsSansNumero,
      tests_100_en_attente: testsEnAttente,
      retraits_plus_1h: retraitsAnciens,
      fenetres_expirees_a_reverser: fenetresExpirees,
    },
  };
}

function fileFenetre(db) {
  return queryAll(
    db,
    `SELECT d.*, t.nom AS terrain_nom, r.code_reservation, r.joueur_nom, r.confirme_at
     FROM dus d
     JOIN terrains t ON t.id = d.terrain_id
     JOIN reservations r ON r.id = d.reservation_id
     WHERE d.statut = 'en_fenetre'
     ORDER BY d.fenetre_expire_at ASC`,
  );
}

function filePayableAuto(db) {
  return queryAll(
    db,
    `SELECT d.*, t.nom AS terrain_nom, r.code_reservation, t.wave_numero, t.om_numero, t.wave_statut, t.om_statut
     FROM dus d
     JOIN terrains t ON t.id = d.terrain_id
     JOIN reservations r ON r.id = d.reservation_id
     WHERE d.payout_mode = 'auto' AND d.statut IN ('payable', 'echec')
     ORDER BY d.updated_at ASC`,
  );
}

function filePayable(db) {
  return queryAll(
    db,
    `SELECT d.*, t.nom AS terrain_nom, r.code_reservation, t.wave_numero, t.om_numero,
            t.wave_statut, t.om_statut, t.payout_mode AS contrat_payout_mode,
            e.nom AS gerant_nom
     FROM dus d
     JOIN terrains t ON t.id = d.terrain_id
     JOIN reservations r ON r.id = d.reservation_id
     LEFT JOIN employes e ON e.id = COALESCE(d.gerant_id, t.gerant_id)
     WHERE d.statut IN ('payable', 'echec', 'demande_retrait')
     ORDER BY d.updated_at ASC`,
  );
}

function rapprochement(db) {
  const recu = n(queryOne(db, "SELECT COALESCE(SUM(montant), 0) AS total FROM paiements WHERE statut = 'paye' AND methode IN ('paytech', 'paydunya')")?.total);
  const rembourse = n(queryOne(db, "SELECT COALESCE(SUM(montant), 0) AS total FROM paiements WHERE statut = 'rembourse'")?.total);
  const dus = queryAll(db, 'SELECT * FROM dus');
  let commission = 0;
  let fraisAbsorbes = 0;
  let fraisPlateformeEnAttente = 0;
  let envoye = 0;
  let encore = {
    en_fenetre: 0,
    payable_auto: 0,
    payable_retrait: 0,
    bloque_sans_numero: 0,
    echec: 0,
  };

  for (const du of dus) {
    const contrat = chargerContrat(db, du.terrain_id);
    if (du.statut === 'annule_rembourse') continue;
    if (du.statut !== 'en_fenetre') commission += n(du.commission);
    if (du.statut === 'verse') {
      envoye += n(du.du_gerant);
      fraisAbsorbes += n(du.frais_plateforme);
    } else {
      const vent = ventilationDu(du, contrat);
      if (vent && encore[vent] != null) encore[vent] += n(du.du_gerant);
      fraisPlateformeEnAttente += n(du.frais_plateforme);
    }
  }

  const commissionEnFenetre = dus
    .filter((d) => d.statut === 'en_fenetre')
    .reduce((s, d) => s + n(d.commission), 0);
  const encoreTotal = Object.values(encore).reduce((s, v) => s + v, 0);
  const gauche = recu - rembourse;
  const droite = commission + commissionEnFenetre + fraisAbsorbes + fraisPlateformeEnAttente + envoye + encoreTotal;

  return {
    recu,
    rembourse,
    commission,
    commission_en_fenetre: commissionEnFenetre,
    frais_payout_plateforme_absorbes: fraisAbsorbes,
    frais_payout_plateforme_en_attente: fraisPlateformeEnAttente,
    envoye,
    encore_du: encoreTotal,
    encore_du_ventile: encore,
    equation: 'reçu − remboursé = commission + commission_en_fenêtre + frais_payout_plateforme_absorbés + frais_payout_plateforme_en_attente + envoyé + encore_dû',
    gauche,
    droite,
    equilibre: gauche === droite,
  };
}

function revenusPlateforme(db) {
  const rows = queryAll(
    db,
    `SELECT t.id, t.nom,
      COALESCE(SUM(CASE WHEN d.statut NOT IN ('annule_rembourse', 'en_fenetre') THEN d.commission ELSE 0 END), 0) AS commission_acquise,
      COALESCE(SUM(CASE WHEN d.statut = 'verse' THEN d.frais_plateforme ELSE 0 END), 0) AS frais_absorbes,
      COALESCE(SUM(CASE WHEN d.statut = 'verse' THEN d.frais_gerant ELSE 0 END), 0) AS frais_factures_gerant
     FROM terrains t
     LEFT JOIN dus d ON d.terrain_id = t.id
     GROUP BY t.id, t.nom
     ORDER BY commission_acquise DESC`,
  );
  return {
    total_commission_acquise: rows.reduce((s, r) => s + n(r.commission_acquise), 0),
    total_frais_absorbes: rows.reduce((s, r) => s + n(r.frais_absorbes), 0),
    note: 'Revenus plateforme = commission sur l’avance uniquement. Le reste du match (ex. 35 000) n’entre pas dans ce compte.',
    terrains: rows,
  };
}

module.exports = {
  kpisCaisse,
  fileFenetre,
  filePayableAuto,
  filePayable,
  rapprochement,
  revenusPlateforme,
};
