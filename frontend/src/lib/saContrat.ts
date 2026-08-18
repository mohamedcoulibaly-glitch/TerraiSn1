export type CanalStatut = "absent" | "saisi" | "test_envoye" | "verifie";
export type PayoutMode = "auto" | "retrait";
export type FraisPolitique = "gerant" | "plateforme" | "partage";
export type CanalReversement = "wave" | "om" | "les_deux";
export type StatutDu = "en_fenetre" | "payable" | "verse" | "echec" | "annule_rembourse";

export type AvenantContrat = {
  at: string;
  par: string;
  bloc: string;
  avant: string;
  apres: string;
};

export type ContratOverlay = {
  wave_numero: string;
  om_numero: string;
  wave_statut: CanalStatut;
  om_statut: CanalStatut;
  wave_verifie_at?: string;
  om_verifie_at?: string;
  numeros_identiques_whatsapp: boolean;
  canal_reversement: CanalReversement;
  remboursement_autorise: boolean;
  payout_mode: PayoutMode;
  payout_frais_politique: FraisPolitique;
  frais_payout_pct_gerant: number;
  frais_payout_pct_plateforme: number;
  production_paiement: boolean;
  avenants: AvenantContrat[];
};

export type DemandeRetrait = {
  id: string;
  terrain_id: number;
  terrain_nom: string;
  terrain_ville: string;
  gerant_nom: string;
  gerant_whatsapp: string;
  montant_net: number;
  wave_numero: string;
  om_numero: string;
  wave_statut: CanalStatut;
  om_statut: CanalStatut;
  demande_at: string;
  statut: "en_attente" | "envoye" | "rejete";
  ref_manuelle?: string;
  motif_rejet?: string;
  traite_par?: string;
  traite_at?: string;
};

export type PayoutAutoIncident = {
  terrain_id: number;
  terrain_nom: string;
  dernier_at?: string;
  statut: "ok" | "echec" | "en_attente";
  message?: string;
};

type OpsStore = {
  contrats: Record<string, ContratOverlay>;
  demandes: DemandeRetrait[];
  incidents_auto: PayoutAutoIncident[];
};

const STORAGE_KEY = "sa_ops_v1";

export const CONTRAT_DEFAUT: ContratOverlay = {
  wave_numero: "",
  om_numero: "",
  wave_statut: "absent",
  om_statut: "absent",
  numeros_identiques_whatsapp: false,
  canal_reversement: "les_deux",
  remboursement_autorise: false,
  payout_mode: "retrait",
  payout_frais_politique: "partage",
  frais_payout_pct_gerant: 1,
  frais_payout_pct_plateforme: 1,
  production_paiement: false,
  avenants: [],
};

function emptyStore(): OpsStore {
  return { contrats: {}, demandes: [], incidents_auto: [] };
}

function readStore(): OpsStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as OpsStore;
    return {
      contrats: parsed.contrats || {},
      demandes: Array.isArray(parsed.demandes) ? parsed.demandes : [],
      incidents_auto: Array.isArray(parsed.incidents_auto) ? parsed.incidents_auto : [],
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: OpsStore) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function getContratOverlay(terrainId: number): ContratOverlay {
  const store = readStore();
  return { ...CONTRAT_DEFAUT, ...(store.contrats[String(terrainId)] || {}) };
}

export function saveContratOverlay(terrainId: number, patch: Partial<ContratOverlay>, avenant?: Omit<AvenantContrat, "at">) {
  const store = readStore();
  const current = { ...CONTRAT_DEFAUT, ...(store.contrats[String(terrainId)] || {}) };
  const next: ContratOverlay = { ...current, ...patch };
  if (avenant) {
    next.avenants = [{ ...avenant, at: new Date().toISOString() }, ...(current.avenants || [])].slice(0, 50);
  }
  store.contrats[String(terrainId)] = next;
  writeStore(store);
  return next;
}

export function getDemandesRetrait(): DemandeRetrait[] {
  return readStore().demandes;
}

export function upsertDemandeRetrait(demande: DemandeRetrait) {
  const store = readStore();
  const idx = store.demandes.findIndex((d) => d.id === demande.id);
  if (idx >= 0) store.demandes[idx] = demande;
  else store.demandes.unshift(demande);
  writeStore(store);
}

export function getIncidentsAuto(): PayoutAutoIncident[] {
  return readStore().incidents_auto;
}

export function upsertIncidentAuto(incident: PayoutAutoIncident) {
  const store = readStore();
  const idx = store.incidents_auto.findIndex((i) => i.terrain_id === incident.terrain_id);
  if (idx >= 0) store.incidents_auto[idx] = incident;
  else store.incidents_auto.push(incident);
  writeStore(store);
}

export function statutCanalDepuisNumero(numero: string, actuel?: CanalStatut): CanalStatut {
  if (!digitsSn(numero)) return "absent";
  if (actuel === "verifie" || actuel === "test_envoye") return actuel;
  return "saisi";
}

export function digitsSn(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("221")) return d.slice(0, 12);
  if (d.startsWith("0") && d.length >= 10) return ("221" + d.slice(1)).slice(0, 12);
  if (d.length <= 9) return ("221" + d).slice(0, 12);
  return d.slice(0, 12);
}

export function formatTelAffichage(raw: string): string {
  const d = digitsSn(raw);
  if (!d) return "";
  const local = d.startsWith("221") ? d.slice(3) : d;
  const a = local.slice(0, 2);
  const b = local.slice(2, 5);
  const c = local.slice(5, 7);
  const e = local.slice(7, 9);
  return `+221 ${a}${b ? " " + b : ""}${c ? " " + c : ""}${e ? " " + e : ""}`.trim();
}

export function masquerNumero(raw: string): string {
  const d = digitsSn(raw);
  const local = d.startsWith("221") ? d.slice(3) : d;
  if (local.length < 4) return "•• *** ** ••";
  return `${local.slice(0, 2)} *** ** ${local.slice(-2)}`;
}

export function fcfa(n: number): string {
  return `${Math.round(Number(n) || 0).toLocaleString("fr-FR")} FCFA`;
}

export function relativeDepuis(iso: string): { label: string; urgence: "ok" | "warn" | "danger" } {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return { label: "—", urgence: "ok" };
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return { label: "à l'instant", urgence: "ok" };
  if (min < 60) {
    return { label: `il y a ${min} min`, urgence: min > 60 ? "danger" : min > 30 ? "warn" : "ok" };
  }
  const h = Math.floor(min / 60);
  if (h < 24) return { label: `il y a ${h} h`, urgence: "danger" };
  const j = Math.floor(h / 24);
  return { label: `il y a ${j} j`, urgence: "danger" };
}

export function splitNom(nomComplet: string): { prenom: string; nom: string } {
  const parts = String(nomComplet || "").trim().split(/\s+/);
  if (parts.length <= 1) return { prenom: parts[0] || "", nom: "" };
  return { prenom: parts[0], nom: parts.slice(1).join(" ") };
}

export function gerantDuTerrain(users: any[], terrainId: number) {
  return (users || []).find((u: any) => u.role === "gerant" && Number(u.terrain_id) === Number(terrainId)) || null;
}

export function terrainStatutListe(terrain: any, contrat: ContratOverlay): "actif" | "suspendu" | "en_attente" {
  if (!terrain?.is_active) return "suspendu";
  if (!contrat.production_paiement) return "en_attente";
  return "actif";
}

export type PreviewContratInput = {
  prix?: number;
  pctAvance: number;
  pctCommission: number;
  politiqueFrais: FraisPolitique;
  pctFraisGerant?: number;
  pctFraisPlateforme?: number;
};

export function calculerPreviewContrat(input: PreviewContratInput) {
  const prix = Number(input.prix || 40000);
  const pctAvance = Number(input.pctAvance || 0);
  const pctCommission = Number(input.pctCommission || 0);
  const avance = Math.round((prix * pctAvance) / 100);
  const reste = prix - avance;
  const commission = Math.round((avance * pctCommission) / 100);
  const baseGerant = avance - commission;

  let pctG = Number(input.pctFraisGerant ?? 1);
  let pctP = Number(input.pctFraisPlateforme ?? 1);
  if (input.politiqueFrais === "gerant") {
    pctP = 0;
    if (!Number.isFinite(pctG) || pctG < 0) pctG = 1;
  } else if (input.politiqueFrais === "plateforme") {
    pctG = 0;
    if (!Number.isFinite(pctP) || pctP < 0) pctP = 1;
  }

  const fraisGerant = Math.round((baseGerant * pctG) / 100);
  const fraisPlateforme = Math.round((baseGerant * pctP) / 100);

  return {
    prix,
    avance,
    reste,
    commission,
    baseGerant,
    auto: {
      fraisGerant,
      fraisPlateforme,
      net: baseGerant - fraisGerant,
    },
    retrait: {
      fraisGerant: 0,
      fraisPlateforme: 0,
      net: baseGerant,
    },
  };
}

export function texteAnnulationJoueur(autorise: boolean, heures: number): string {
  if (!autorise || heures <= 0) return "Annulation sans remboursement de l'avance.";
  return `Remboursé si tu annules dans les ${heures} h suivant ta réservation. Au-delà, l'avance est conservée.`;
}

export function texteImpactReversement(autorise: boolean, heures: number): string {
  if (!autorise || heures <= 0) return "Dû payable dès confirmation. Reversement selon le mode.";
  return `Dû en attente pendant ${heures} h. Reversé après si pas d'annulation.`;
}

export function fraisLabel(contrat: ContratOverlay): string {
  if (contrat.payout_mode === "retrait") return "0 frais";
  if (contrat.payout_frais_politique === "gerant") return "Gérant";
  if (contrat.payout_frais_politique === "plateforme") return "Plateforme";
  return `${contrat.frais_payout_pct_gerant}+${contrat.frais_payout_pct_plateforme}%`;
}
