import type { OperationalStage } from "@/lib/kanbanRules";

export type CrmGate = {
  bloqueReservation: boolean;
  reason?: string;
};

export type FluxReservation = {
  id: number;
  joueur_id?: number | null;
  joueur_nom?: string | null;
  joueur_telephone?: string | null;
  code_reservation?: string | null;
  date: string;
  heure_debut: string;
  heure_fin: string;
  statut: string;
  operational_stage: OperationalStage;
  checked_in_at?: string | null;
  checkout_at?: string | null;
  montant_restant?: number;
  montant_total?: number;
  qr_code_scanne_at?: string | null;
  fenetre_retard?: number | null;
  dans_fenetre_checkin?: boolean;
  mode_paiement?: string | null;
  crm?: CrmGate;
};

export type FluxTodayPayload = {
  date: string;
  terrain_id: number;
  terrain_nom: string;
  reservations: FluxReservation[];
};

export const FLUX_COLUMNS: {
  id: OperationalStage;
  title: string;
  hint: string;
}[] = [
  { id: "reserved", title: "Réservations", hint: "À venir" },
  { id: "checkin", title: "Check-ins", hint: "Action" },
  { id: "match", title: "Le Match", hint: "En cours" },
  { id: "checkout", title: "Check-outs", hint: "Clôture" },
];

export function columnOf(card: FluxReservation): OperationalStage {
  if (card.operational_stage === "closed") return "checkout";
  return card.operational_stage || "reserved";
}

export function groupFluxCards(cards: FluxReservation[]) {
  const grouped: Record<OperationalStage, FluxReservation[]> = {
    reserved: [],
    checkin: [],
    match: [],
    checkout: [],
    closed: [],
  };
  for (const card of cards) grouped[columnOf(card)].push(card);
  return grouped;
}

export function hotColumn(cards: FluxReservation[]): OperationalStage {
  const now = Date.now();
  if (cards.some((c) => c.dans_fenetre_checkin && columnOf(c) === "reserved")) return "checkin";
  const inMatch = cards.some((c) => {
    const start = new Date(`${c.date}T${String(c.heure_debut).slice(0, 5)}:00`).getTime();
    const end = new Date(`${c.date}T${String(c.heure_fin).slice(0, 5)}:00`).getTime();
    return now >= start && now < end;
  });
  if (inMatch) return "match";
  const after = cards.some((c) => {
    const end = new Date(`${c.date}T${String(c.heure_fin).slice(0, 5)}:00`).getTime();
    return now >= end && columnOf(c) !== "checkout";
  });
  if (after) return "checkout";
  return "reserved";
}

export const FLUX_MOBILE_TABS: { id: OperationalStage; label: string; short: string }[] = [
  { id: "reserved", label: "Réservations", short: "Réservations" },
  { id: "checkin", label: "Arrivées", short: "In" },
  { id: "match", label: "Terrain", short: "Match" },
  { id: "checkout", label: "Sorties", short: "Out" },
];

export function delayTone(card: FluxReservation) {
  const now = Date.now();
  const start = new Date(`${card.date}T${String(card.heure_debut).slice(0, 5)}:00`).getTime();
  const stage = columnOf(card);
  if (stage === "checkout" || card.qr_code_scanne_at) return null;
  if (!Number.isFinite(start)) return null;
  if (now > start && stage === "reserved") return "late" as const;
  if (card.dans_fenetre_checkin === false && now > start) return "expired" as const;
  return null;
}

export function initials(name?: string | null) {
  const parts = String(name || "J").trim().split(/\s+/);
  return `${parts[0]?.[0] || "J"}${parts[1]?.[0] || ""}`.toUpperCase();
}

export function formatFcfa(value?: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}
