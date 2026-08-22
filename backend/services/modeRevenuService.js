const { queryAll, queryOne, runSql } = require('../database');
const essaiService = require('./essaiService');

const DEFAULTS = {
  essai_duree_jours: 30,
  delai_negociation_jours: 7,
  essai_suspension_auto: 1,
  essai_notifs: 1,
  essai_j7: 1,
  essai_j3: 1,
  essai_j1: 1,
  commission_pourcentage: 10,
  frais_politique: 'gerant',
  pct_frais_gerant: 100,
  pct_frais_plateforme: 0,
  abonnement_montant: 50000,
  abonnement_grace_jours: 3,
  abo_j7: 1,
  abo_j3: 1,
  abo_j1: 1,
  abo_suspension_auto: 1,
  achat_montant_min: 0,
};

async function getDefaults(database) {
  try {
    const row = await queryOne(database, 'SELECT valeur FROM plateforme_settings WHERE cle = ?', ['mode_revenu_defaults']);
    if (!row?.valeur) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(row.valeur) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function saveDefaults(database, patch) {
  const next = { ...(await getDefaults(database)), ...patch };
  const existing = await queryOne(database, 'SELECT cle FROM plateforme_settings WHERE cle = ?', ['mode_revenu_defaults']);
  const json = JSON.stringify(next);
  if (existing) {
    await runSql(database, 'UPDATE plateforme_settings SET valeur = ?, updated_at = CURRENT_TIMESTAMP WHERE cle = ?', [json, 'mode_revenu_defaults']);
  } else {
    await runSql(database, 'INSERT INTO plateforme_settings (cle, valeur) VALUES (?, ?)', ['mode_revenu_defaults', json]);
  }
  return next;
}

function resolveMode(terrain) {
  const essai = essaiService.essaiEtat(terrain);
  if (essai.etat === 'actif' || essai.etat === 'expire' || essai.etat === 'suspendu') return 'essai';
  const m = String(terrain?.modele_revenus || 'commission');
  if (m === 'abonnement') return 'abonnement';
  if (m === 'achat_definitif') return 'achat';
  return 'commission';
}

async function applyMode(database, terrain, body, actorId) {
  const mode = String(body?.mode || '');
  const today = essaiService.ymd(new Date());
  const defaults = await getDefaults(database);
  const from = resolveMode(terrain);
  const id = Number(terrain.id);

  if (mode === 'essai') {
    const duree = Math.max(1, Number(body.essai_duree_jours || defaults.essai_duree_jours));
    const nego = Math.max(0, Number(body.delai_negociation_jours || defaults.delai_negociation_jours));
    const debut = String(body.essai_debut_at || today).slice(0, 10);
    const fin = essaiService.addDays(debut, duree);
    await runSql(database, `UPDATE terrains SET mode_essai = 1, essai_debut_at = ?, essai_duree_jours = ?, essai_fin_at = ?,
      delai_negociation_jours = ?, essai_suspendu_auto = 0, notif_essai_fin_j7 = 0, notif_essai_fin_j3 = 0, notif_essai_fin_j1 = 0 WHERE id = ?`,
      [debut, duree, fin, nego, id]);
  } else if (mode === 'commission') {
    const pct = Math.max(0, Number(body.commission_pourcentage ?? terrain.commission_pourcentage ?? defaults.commission_pourcentage));
    await runSql(database, 'UPDATE terrains SET mode_essai = 0, modele_revenus = ?, commission_pourcentage = ? WHERE id = ?', ['commission', pct, id]);
  } else if (mode === 'abonnement') {
    const montant = Math.max(0, Number(body.abonnement_montant ?? terrain.abonnement_montant ?? defaults.abonnement_montant));
    await runSql(database, 'UPDATE terrains SET mode_essai = 0, modele_revenus = ?, abonnement_montant = ? WHERE id = ?', ['abonnement', montant, id]);
  } else if (mode === 'achat') {
    const montant = Math.max(0, Number(body.achat_definitif_montant ?? terrain.achat_definitif_montant ?? 0));
    await runSql(database, 'UPDATE terrains SET mode_essai = 0, modele_revenus = ?, achat_definitif_montant = ? WHERE id = ?', ['achat_definitif', montant, id]);
  } else {
    const err = new Error('Mode invalide');
    err.statusCode = 400;
    throw err;
  }

  await runSql(database, `INSERT INTO mode_revenu_history (terrain_id, ancien_mode, nouveau_mode, fait_par, note)
    VALUES (?, ?, ?, ?, ?)`, [id, from, mode, actorId || null, String(body.note || '').slice(0, 500)]);
  return await queryOne(database, 'SELECT * FROM terrains WHERE id = ?', [id]);
}

async function listHistory(database) {
  try {
    return await queryAll(database, `SELECT h.*, t.nom AS terrain_nom, u.nom AS auteur
    FROM mode_revenu_history h
    LEFT JOIN terrains t ON t.id = h.terrain_id
    LEFT JOIN users u ON u.id = h.fait_par
    ORDER BY h.created_at DESC LIMIT 100`);
  } catch (err) {
    console.error('[modeRevenu] history:', err.message);
    return [];
  }
}

function enrichTerrain(terrain) {
  const essai = essaiService.publicEssai(terrain);
  const mode = resolveMode(terrain);
  return { ...terrain, mode_revenu: mode, essai };
}

module.exports = { DEFAULTS, getDefaults, saveDefaults, resolveMode, applyMode, listHistory, enrichTerrain };
