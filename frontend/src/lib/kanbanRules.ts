import { calculerFenetreCheckIn, estDansLaFenetreCheckIn } from "@/lib/checkInFenetre";

export const KANBAN_STAGES = ["reserved", "checkin", "match", "checkout", "closed"] as const;
export type OperationalStage = (typeof KANBAN_STAGES)[number];

export const KANBAN_ALLOWED: Record<OperationalStage, OperationalStage[]> = {
  reserved: ["checkin"],
  checkin: ["match"],
  match: ["checkout"],
  checkout: ["closed"],
  closed: [],
};

export function nextKanbanStage(from: OperationalStage): OperationalStage | null {
  return KANBAN_ALLOWED[from]?.[0] ?? null;
}

export const KANBAN_STAGE_MESSAGES: Record<string, string> = {
  PLAYER_BLOCKED: "Ce joueur est bloqué dans le CRM (banni ou impayé).",
  ILLEGAL_TRANSITION: "Cette transition Kanban n’est pas autorisée.",
  INVALID_STAGE: "Étape Kanban inconnue.",
  NOT_CONFIRMED: "Seule une réservation confirmée peut passer en check-in.",
  OUT_OF_WINDOW: "Check-in hors fenêtre horaire.",
  CHECKIN_REQUIRED: "Le check-in doit être validé avant le match.",
  MATCH_NOT_STARTED: "Le match n’a pas encore commencé.",
  BALANCE_OPEN: "Le reste à payer doit être encaissé (ou un waiver gérant).",
};

export class KanbanGateError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, statusCode = 400) {
    super(KANBAN_STAGE_MESSAGES[code] || code);
    this.name = "KanbanGateError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type PlayerGateInput = {
  is_banned?: boolean;
  solde_ouvert?: number;
  politiqueImpaye?: boolean;
  abonnement?: { statut?: string | null } | null;
};

export function playerGate(player: PlayerGateInput = {}) {
  if (player.is_banned) return { bloqueReservation: true, reason: "Banni" as const };
  if (player.politiqueImpaye && Number(player.solde_ouvert || 0) > 0) {
    return { bloqueReservation: true, reason: "Impayé" as const };
  }
  if (player.abonnement?.statut === "en_retard") {
    return { bloqueReservation: true, reason: "Abonnement en retard" as const };
  }
  return { bloqueReservation: false as const };
}

export function isOperationalStage(value: unknown): value is OperationalStage {
  return KANBAN_STAGES.includes(value as OperationalStage);
}

export function resolveOperationalStage(row: {
  operational_stage?: string | null;
  checkout_at?: string | null;
  checked_in_at?: string | null;
  qr_code_scanne_at?: string | null;
  statut?: string | null;
}): OperationalStage {
  const raw = String(row.operational_stage || "").trim();
  if (isOperationalStage(raw)) return raw;
  if (row.checkout_at) return "closed";
  if (row.statut === "match_joue" || row.statut === "joue") return "match";
  if (row.checked_in_at || row.qr_code_scanne_at) return "checkin";
  return "reserved";
}

export type KanbanCardInput = {
  stage: OperationalStage;
  statut: string;
  date: string;
  heure_debut: string;
  heure_fin: string;
  fenetre_retard?: number | null;
  checked_in_at: string | null;
  montant_restant: number;
  waiverEncaissement?: boolean;
  crm: { bloqueReservation: boolean; reason?: string };
};

export function assertStageTransition(card: KanbanCardInput, to: string, maintenant = Date.now()) {
  if (!isOperationalStage(to)) throw new KanbanGateError("INVALID_STAGE");
  if (card.crm?.bloqueReservation) throw new KanbanGateError("PLAYER_BLOCKED", 409);

  const from = isOperationalStage(card.stage) ? card.stage : "reserved";
  if (!KANBAN_ALLOWED[from].includes(to)) throw new KanbanGateError("ILLEGAL_TRANSITION");

  if (to === "checkin") {
    if (card.statut !== "confirme") throw new KanbanGateError("NOT_CONFIRMED");
    if (
      !estDansLaFenetreCheckIn(
        {
          date: card.date,
          heure_debut: card.heure_debut,
          heure_fin: card.heure_fin,
          fenetre_retard: card.fenetre_retard,
        },
        maintenant,
      )
    ) {
      throw new KanbanGateError("OUT_OF_WINDOW");
    }
  }

  if (to === "match" && !card.checked_in_at) throw new KanbanGateError("CHECKIN_REQUIRED");

  if (to === "checkout") {
    const { heureDebutMs } = calculerFenetreCheckIn({
      date: card.date,
      heure_debut: card.heure_debut,
      heure_fin: card.heure_fin,
      fenetre_retard: card.fenetre_retard,
    });
    if (maintenant < heureDebutMs) throw new KanbanGateError("MATCH_NOT_STARTED");
  }

  if (to === "closed") {
    if (Number(card.montant_restant || 0) > 0 && !card.waiverEncaissement) {
      throw new KanbanGateError("BALANCE_OPEN");
    }
  }

  return true;
}
