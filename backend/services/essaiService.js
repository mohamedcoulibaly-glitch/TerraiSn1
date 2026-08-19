function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return ymd(d);
}

function daysBetween(from, to) {
  const a = new Date(`${String(from).slice(0, 10)}T12:00:00`);
  const b = new Date(`${String(to).slice(0, 10)}T12:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function essaiEtat(terrain, today = ymd(new Date())) {
  const mode = Number(terrain?.mode_essai) === 1;
  const suspendu = Number(terrain?.essai_suspendu_auto) === 1;
  const debut = terrain?.essai_debut_at ? String(terrain.essai_debut_at).slice(0, 10) : null;
  const fin = terrain?.essai_fin_at ? String(terrain.essai_fin_at).slice(0, 10) : null;
  const delai = Number(terrain?.essai_duree_jours || 30);
  const nego = Number(terrain?.delai_negociation_jours || 7);
  const suspensionAt = fin ? addDays(fin, nego) : null;

  if (suspendu) {
    return { etat: 'suspendu', debut, fin, suspensionAt, jours_restants: 0, nego_restants: 0, duree: delai };
  }
  if (!mode) {
    return { etat: 'inactif', debut, fin, suspensionAt, jours_restants: 0, nego_restants: 0, duree: delai };
  }
  if (fin && today > fin) {
    const negoLeft = suspensionAt ? Math.max(0, daysBetween(today, suspensionAt)) : 0;
    return { etat: today > (suspensionAt || fin) ? 'suspendu' : 'expire', debut, fin, suspensionAt, jours_restants: 0, nego_restants: negoLeft, duree: delai };
  }
  const rest = fin ? Math.max(0, daysBetween(today, fin)) : delai;
  return { etat: 'actif', debut, fin, suspensionAt, jours_restants: rest, nego_restants: nego, duree: delai };
}

function publicEssai(terrain) {
  const info = essaiEtat(terrain);
  return {
    mode_essai: Number(terrain?.mode_essai) === 1 ? 1 : 0,
    essai_debut_at: terrain?.essai_debut_at || null,
    essai_duree_jours: Number(terrain?.essai_duree_jours || 30),
    essai_fin_at: terrain?.essai_fin_at || null,
    essai_suspendu_auto: Number(terrain?.essai_suspendu_auto) === 1 ? 1 : 0,
    delai_negociation_jours: Number(terrain?.delai_negociation_jours || 7),
    notif_essai_fin_j7: Number(terrain?.notif_essai_fin_j7 || 0),
    notif_essai_fin_j3: Number(terrain?.notif_essai_fin_j3 || 0),
    notif_essai_fin_j1: Number(terrain?.notif_essai_fin_j1 || 0),
    ...info,
  };
}

module.exports = { essaiEtat, publicEssai, addDays, ymd };
