const { queryOne, queryAll } = require('../database');
const { calculerDepuisAvance, isoFromMs, parseDateMs } = require('./calculsPaiement');
const { chargerContrat, auMoinsUnCanalVerifie, numeroPayout } = require('./contratService');

const STATUTS_ENCORE_DU = ['en_fenetre', 'payable', 'demande_retrait', 'echec'];

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function fenetreExpireMs(contrat, confirmeAtMs) {
  if (Number(contrat.remboursement_autorise) !== 1) return confirmeAtMs;
  const delai = Number(contrat.delai_remboursement_heures || 0);
  if (delai <= 0) return confirmeAtMs;
  return confirmeAtMs + delai * 60 * 60 * 1000;
}

function statutInitial({ contrat, confirmeAtMs, nowMs }) {
  const expire = fenetreExpireMs(contrat, confirmeAtMs);
  if (Number(contrat.remboursement_autorise) === 1 && nowMs < expire) {
    return { statut: 'en_fenetre', fenetre_expire_at: isoFromMs(expire), payable_at: null };
  }
  return { statut: 'payable', fenetre_expire_at: isoFromMs(expire), payable_at: nowIso(nowMs) };
}

function duExistant(db, reservationId) {
  return queryOne(db, 'SELECT * FROM dus WHERE reservation_id = ?', [Number(reservationId)]);
}

function snapshotNumeros(contrat) {
  const dest = numeroPayout(contrat);
  return {
    gerant_id: contrat.gerant_id || null,
    wave_numero: contrat.wave_numero || null,
    om_numero: contrat.om_numero || null,
    canal_reversement: dest?.canal || contrat.canal_reversement || null,
  };
}

function creerDuApresPayin(db, {
  reservation,
  contrat,
  now = Date.now(),
}) {
  const existing = duExistant(db, reservation.id);
  if (existing) return existing;

  const avance = Number(reservation.montant_avance || reservation.acompte || 0);
  const calc = calculerDepuisAvance(avance, contrat);
  const confirmeAtMs = parseDateMs(reservation.confirme_at) || now;
  const init = statutInitial({ contrat, confirmeAtMs, nowMs: now });
  const nums = init.statut === 'payable' ? snapshotNumeros(contrat) : {
    gerant_id: contrat.gerant_id || null,
    wave_numero: null,
    om_numero: null,
    canal_reversement: contrat.canal_reversement || null,
  };

  db.run(
    `INSERT INTO dus (
      reservation_id, terrain_id, gerant_id, avance, commission, base_gerant,
      frais_gerant, frais_plateforme, du_gerant, payout_mode, payout_frais_politique,
      wave_numero, om_numero, canal_reversement, contrat_version, statut,
      fenetre_expire_at, payable_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      reservation.id, reservation.terrain_id, nums.gerant_id,
      calc.avance, calc.commission, calc.base_gerant,
      calc.frais_gerant, calc.frais_plateforme, calc.du_gerant,
      calc.payout_mode, contrat.payout_frais_politique || 'gerant',
      nums.wave_numero, nums.om_numero, nums.canal_reversement,
      contrat.contrat_version || 1, init.statut,
      init.fenetre_expire_at, init.payable_at, nowIso(now), nowIso(now),
    ],
  );

  return duExistant(db, reservation.id);
}

function marquerPayable(db, du, contrat, now = Date.now()) {
  if (!du || !['en_fenetre', 'echec'].includes(du.statut)) return du;
  const nums = snapshotNumeros(contrat);
  db.run(
    `UPDATE dus SET statut = 'payable', gerant_id = ?, wave_numero = ?, om_numero = ?,
      canal_reversement = ?, payable_at = COALESCE(payable_at, ?), updated_at = ?
     WHERE id = ? AND statut IN ('en_fenetre', 'echec')`,
    [nums.gerant_id, nums.wave_numero, nums.om_numero, nums.canal_reversement, nowIso(now), nowIso(now), du.id],
  );
  return queryOne(db, 'SELECT * FROM dus WHERE id = ?', [du.id]);
}

function marquerAnnuleRembourse(db, reservationId, now = Date.now()) {
  const du = duExistant(db, reservationId);
  if (!du) return null;
  if (du.statut === 'verse') return du;
  db.run(
    `UPDATE dus SET statut = 'annule_rembourse', du_gerant = 0, frais_gerant = 0,
      frais_plateforme = 0, updated_at = ?
     WHERE reservation_id = ? AND statut IN ('en_fenetre', 'payable', 'echec', 'demande_retrait')`,
    [nowIso(now), Number(reservationId)],
  );
  return duExistant(db, reservationId);
}

function marquerDemandeRetrait(db, duIds, demandeId, now = Date.now()) {
  if (!duIds.length) return;
  const placeholders = duIds.map(() => '?').join(',');
  db.run(
    `UPDATE dus SET statut = 'demande_retrait', demande_retrait_id = ?, updated_at = ?
     WHERE id IN (${placeholders}) AND statut IN ('payable', 'echec')`,
    [demandeId, nowIso(now), ...duIds],
  );
}

function restaurerPayables(db, demandeId, now = Date.now()) {
  db.run(
    `UPDATE dus SET statut = 'payable', demande_retrait_id = NULL, updated_at = ?
     WHERE demande_retrait_id = ? AND statut = 'demande_retrait'`,
    [nowIso(now), Number(demandeId)],
  );
}

function marquerVerses(db, duIds, now = Date.now()) {
  if (!duIds.length) return;
  const placeholders = duIds.map(() => '?').join(',');
  db.run(
    `UPDATE dus SET statut = 'verse', updated_at = ?
     WHERE id IN (${placeholders}) AND statut IN ('payable', 'demande_retrait', 'echec')`,
    [nowIso(now), ...duIds],
  );
}

function marquerEchec(db, duId, message, now = Date.now()) {
  db.run(
    `UPDATE dus SET statut = 'echec', tentatives = tentatives + 1, last_error = ?, updated_at = ?
     WHERE id = ? AND statut IN ('payable', 'echec')`,
    [String(message || 'echec').slice(0, 500), nowIso(now), Number(duId)],
  );
  return queryOne(db, 'SELECT * FROM dus WHERE id = ?', [duId]);
}

function payoutReussiExiste(db, reservationId) {
  return queryOne(
    db,
    "SELECT id FROM payouts WHERE reservation_id = ? AND statut = 'envoye' LIMIT 1",
    [Number(reservationId)],
  );
}

function labelStatutDu(du, contrat) {
  if (!du) return null;
  if (du.statut === 'en_fenetre') return 'en fenêtre';
  if (du.statut === 'verse') return 'versé';
  if (du.statut === 'demande_retrait') return 'demande envoyée aux dév';
  if (du.statut === 'annule_rembourse') return 'annulé / remboursé';
  if (du.statut === 'echec') return 'échec reversement';
  if (du.statut === 'payable') {
    if (!auMoinsUnCanalVerifie(contrat || {})) return 'bloqué sans numéro';
    return 'payable';
  }
  return du.statut;
}

function ventilationDu(du, contrat) {
  if (!du || du.statut === 'annule_rembourse' || du.statut === 'verse') return null;
  if (du.statut === 'en_fenetre') return 'en_fenetre';
  if (du.statut === 'echec') return 'echec';
  if (du.statut === 'demande_retrait') return 'payable_retrait';
  if (!auMoinsUnCanalVerifie(contrat || { wave_statut: du.wave_numero ? 'verifie' : 'absent', om_statut: du.om_numero ? 'verifie' : 'absent', wave_numero: du.wave_numero, om_numero: du.om_numero, canal_reversement: du.canal_reversement })) {
    return 'bloque_sans_numero';
  }
  return du.payout_mode === 'auto' ? 'payable_auto' : 'payable_retrait';
}

function lignesPortefeuille(db, { terrainId, gerantId = null }) {
  const params = [Number(terrainId)];
  let where = 'd.terrain_id = ?';
  if (gerantId) {
    where += ' AND (d.gerant_id = ? OR d.gerant_id IS NULL)';
    params.push(Number(gerantId));
  }
  return queryAll(
    db,
    `SELECT d.*, r.date, r.heure_debut, r.code_reservation, r.joueur_nom, r.statut AS reservation_statut
     FROM dus d
     JOIN reservations r ON r.id = d.reservation_id
     WHERE ${where}
     ORDER BY d.created_at DESC`,
    params,
  );
}

function agregatsPortefeuille(lignes, contrat) {
  const mode = contrat?.payout_mode === 'auto' ? 'auto' : 'retrait';
  const visible = lignes.filter((d) => d.statut !== 'annule_rembourse');
  const encore = visible.filter((d) => STATUTS_ENCORE_DU.includes(d.statut));
  const disponible = visible.filter((d) => d.statut === 'payable' || d.statut === 'echec');
  const verse = visible.filter((d) => d.statut === 'verse');
  const enFenetre = visible.filter((d) => d.statut === 'en_fenetre');
  const demande = visible.filter((d) => d.statut === 'demande_retrait');
  const sum = (rows, field) => rows.reduce((acc, row) => acc + Number(row[field] || 0), 0);

  return {
    payout_mode: mode,
    formule: mode === 'auto'
      ? 'avance − commission − frais'
      : 'avance − commission',
    label: mode === 'auto'
      ? 'Versé / sera versé auto sur ton Wave-OM'
      : 'Disponible au retrait (0 frais)',
    solde_disponible: sum(disponible, 'du_gerant'),
    solde_en_fenetre: sum(enFenetre, 'du_gerant'),
    solde_demande_retrait: sum(demande, 'du_gerant'),
    total_verse: sum(verse, 'du_gerant'),
    total_encore_du: sum(encore, 'du_gerant'),
    total_avances: sum(visible, 'avance'),
    total_commission: sum(visible, 'commission'),
    total_frais_gerant: sum(visible, 'frais_gerant'),
    bouton_retirer: mode === 'retrait' && sum(disponible, 'du_gerant') > 0 && auMoinsUnCanalVerifie(contrat || {}),
    total_encaisse: sum(visible, 'avance'),
    total_commission_prelevee: sum(visible, 'commission'),
    historique_reversements: visible.map((du) => ({
      reservation_id: du.reservation_id,
      montant: Number(du.du_gerant),
      date: du.created_at || du.date,
      statut: du.statut,
    })),
  };
}

function portefeuilleTerrain(db, terrainId, gerantId = null) {
  const contrat = chargerContrat(db, terrainId);
  const lignes = lignesPortefeuille(db, { terrainId, gerantId: null });
  const agregats = agregatsPortefeuille(lignes, contrat);
  return {
    contrat: {
      payout_mode: contrat?.payout_mode,
      canal_verifie: auMoinsUnCanalVerifie(contrat || {}),
      wave_numero: contrat?.wave_numero,
      om_numero: contrat?.om_numero,
      texte_auto: contrat?.payout_mode === 'auto'
        ? 'Reversé automatiquement après le délai de remboursement de ton terrain (souvent tout de suite s’il n’y a pas de remboursement). Frais selon le contrat.'
        : null,
    },
    ...agregats,
    lignes: lignes.map((du) => ({
      id: du.id,
      reservation_id: du.reservation_id,
      code_reservation: du.code_reservation,
      date: du.date,
      heure_debut: du.heure_debut,
      joueur_nom: du.joueur_nom,
      avance: Number(du.avance),
      commission: Number(du.commission),
      frais: Number(du.frais_gerant || 0),
      net: Number(du.du_gerant),
      statut: du.statut,
      statut_label: labelStatutDu(du, contrat),
      payout_mode: du.payout_mode,
    })),
  };
}

function dusPayablesTerrain(db, terrainId) {
  return queryAll(
    db,
    `SELECT * FROM dus
      WHERE terrain_id = ? AND statut IN ('payable', 'echec')
      ORDER BY created_at ASC`,
    [Number(terrainId)],
  );
}

function dusEnFenetreExpires(db, now = Date.now()) {
  return queryAll(
    db,
    `SELECT * FROM dus
      WHERE statut = 'en_fenetre'
        AND fenetre_expire_at IS NOT NULL
        AND fenetre_expire_at <= ?`,
    [nowIso(now)],
  );
}

module.exports = {
  STATUTS_ENCORE_DU,
  creerDuApresPayin,
  duExistant,
  marquerPayable,
  marquerAnnuleRembourse,
  marquerDemandeRetrait,
  restaurerPayables,
  marquerVerses,
  marquerEchec,
  payoutReussiExiste,
  portefeuilleTerrain,
  agregatsPortefeuille,
  ventilationDu,
  dusPayablesTerrain,
  dusEnFenetreExpires,
  snapshotNumeros,
  fenetreExpireMs,
  statutInitial,
};
