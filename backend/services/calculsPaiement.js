/**
 * Calculs CDC Paiements v1.2 — FCFA entiers, zéro constante métier.
 * Toute valeur (% , mode, politique) vient du contrat superadmin.
 */

function arrondiFcfa(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function normaliserNumeroSn(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) digits = digits.slice(1);
  if (digits.length === 9 && digits.startsWith('7')) digits = `221${digits}`;
  if (digits.startsWith('221') && digits.length === 12) return digits;
  return digits || null;
}

function masquerNumero(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 2) return '•••';
  return `…${digits.slice(-2)}`;
}

function fraisSelonPolitique({
  payout_mode,
  payout_frais_politique,
  frais_payout_pct_gerant,
  frais_payout_pct_plateforme,
  base_gerant,
}) {
  if (String(payout_mode || '') !== 'auto') {
    return { frais_gerant: 0, frais_plateforme: 0 };
  }
  const base = arrondiFcfa(base_gerant);
  const politique = String(payout_frais_politique || 'gerant');
  const pctGerant = Number(frais_payout_pct_gerant || 0);
  const pctPlateforme = Number(frais_payout_pct_plateforme || 0);
  let frais_gerant = 0;
  let frais_plateforme = 0;
  if (politique === 'plateforme') {
    frais_plateforme = arrondiFcfa((base * pctPlateforme) / 100);
  } else if (politique === 'partage') {
    frais_gerant = arrondiFcfa((base * pctGerant) / 100);
    frais_plateforme = arrondiFcfa((base * pctPlateforme) / 100);
  } else {
    frais_gerant = arrondiFcfa((base * pctGerant) / 100);
  }
  return { frais_gerant, frais_plateforme };
}

function calculerDepuisAvance(avanceInput, contrat = {}) {
  const avance = arrondiFcfa(avanceInput);
  const commissionPct = Number(contrat.commission_pourcentage || 0);
  const commission = Math.min(avance, arrondiFcfa((avance * commissionPct) / 100));
  const base_gerant = Math.max(0, avance - commission);
  const { frais_gerant, frais_plateforme } = fraisSelonPolitique({
    payout_mode: contrat.payout_mode,
    payout_frais_politique: contrat.payout_frais_politique,
    frais_payout_pct_gerant: contrat.frais_payout_pct_gerant,
    frais_payout_pct_plateforme: contrat.frais_payout_pct_plateforme,
    base_gerant,
  });
  const du_gerant = Math.max(0, base_gerant - frais_gerant);
  return {
    avance,
    commission,
    base_gerant,
    frais_gerant,
    frais_plateforme,
    du_gerant,
    payout_mode: contrat.payout_mode === 'auto' ? 'auto' : 'retrait',
  };
}

function calculerDecomposition(contrat = {}, prixInput = 40000) {
  const prix = arrondiFcfa(prixInput);
  const pourcentageAvance = Number(contrat.pourcentage_avance || 0);
  const avance = Math.min(prix, arrondiFcfa((prix * pourcentageAvance) / 100));
  const reste_sur_place = Math.max(0, prix - avance);
  const suite = calculerDepuisAvance(avance, contrat);
  return {
    prix,
    pourcentage_avance: pourcentageAvance,
    reste_sur_place,
    ...suite,
  };
}

function previewFormules(contrat = {}, prix = 40000) {
  const auto = calculerDecomposition({ ...contrat, payout_mode: 'auto' }, prix);
  const retrait = calculerDecomposition({ ...contrat, payout_mode: 'retrait' }, prix);
  return {
    prix,
    avance: auto.avance,
    reste_sur_place: auto.reste_sur_place,
    commission: auto.commission,
    base_gerant: auto.base_gerant,
    auto: {
      du_gerant: auto.du_gerant,
      frais_gerant: auto.frais_gerant,
      frais_plateforme: auto.frais_plateforme,
    },
    retrait: {
      du_gerant: retrait.du_gerant,
      frais_gerant: 0,
      frais_plateforme: 0,
    },
    mode_actif: contrat.payout_mode === 'auto' ? 'auto' : 'retrait',
  };
}

function texteAnnulationJoueur(contrat = {}) {
  const autorise = Number(contrat.remboursement_autorise) === 1;
  const delai = Math.max(0, arrondiFcfa(contrat.delai_remboursement_heures));
  if (!autorise || delai <= 0) {
    return 'Annulation sans remboursement';
  }
  return `Remboursé si tu annules dans les ${delai} h`;
}

function isoFromMs(ms) {
  if (!ms) return null;
  return new Date(ms).toISOString();
}

function parseDateMs(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value).trim();
  const date = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

module.exports = {
  arrondiFcfa,
  normaliserNumeroSn,
  masquerNumero,
  fraisSelonPolitique,
  calculerDepuisAvance,
  calculerDecomposition,
  previewFormules,
  texteAnnulationJoueur,
  isoFromMs,
  parseDateMs,
};
