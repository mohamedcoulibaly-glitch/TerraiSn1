import {
  Calendar,
  CalendarPlus,
  CheckCircle2,
  PlusCircle,
  ShieldCheck,
  Trash2,
  XCircle,
  type LucideIcon,
} from "lucide-react";

export function gerantPrenom(e?: { prenom?: string; nom?: string } | null) {
  const p = (e?.prenom || "").trim();
  if (p) return p;
  return (e?.nom || "").trim().split(/\s+/)[0] || "";
}

export function gerantNomComplet(e?: { prenom?: string; nom?: string } | null) {
  const p = (e?.prenom || "").trim();
  const n = (e?.nom || "").trim();
  if (p && n && !n.toLowerCase().startsWith(p.toLowerCase())) return `${p} ${n}`;
  return n || p || "";
}

export function formatFcfa(value?: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} FCFA`;
}

export function relativeTime(value?: string) {
  if (!value) return "";
  const raw = String(value).trim();
  const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const min = Math.max(0, Math.round(diff / 60000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `il y a ${d} j`;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

export function activityMeta(action: string): { label: string; Icon: LucideIcon; color: string } {
  if (action === "reservation_creee" || action === "reservation_bloquee") {
    return { label: "Nouvelle réservation créée", Icon: CalendarPlus, color: "var(--p-primary)" };
  }
  if (action === "reservation_annulee") {
    return { label: "Réservation annulée", Icon: XCircle, color: "var(--p-attention)" };
  }
  if (action === "qr_scanne") {
    return { label: "Match validé ✅", Icon: CheckCircle2, color: "var(--p-optimal)" };
  }
  if (action === "kanban_stage") {
    return { label: "Étape Kanban mise à jour", Icon: ShieldCheck, color: "var(--p-primary-light)" };
  }
  if (action === "encaissement_sur_place") {
    return { label: "Encaissement sur place", Icon: CheckCircle2, color: "var(--p-gold)" };
  }
  if (action === "creneau_cree") {
    return { label: "Nouveau créneau ajouté", Icon: PlusCircle, color: "var(--p-primary-light)" };
  }
  if (action === "creneau_supprime") {
    return { label: "Créneau supprimé", Icon: Trash2, color: "var(--p-attention)" };
  }
  return { label: "Activité mise à jour", Icon: Calendar, color: "var(--p-primary)" };
}

export function activityFilterGroup(action: string): "scans" | "reservations" | "creneaux" | "autre" {
  if (action === "qr_scanne") return "scans";
  if (action === "reservation_creee" || action === "reservation_annulee" || action === "reservation_bloquee") {
    return "reservations";
  }
  if (action === "creneau_cree" || action === "creneau_supprime") return "creneaux";
  return "autre";
}

export function proprioTerrainPhoto(terrain: { id?: number | string; photos?: unknown }) {
  const fallback = `/fields/field-${((Number(terrain.id) || 1) - 1) % 4 + 1}.jpg`;
  const raw = terrain.photos;
  let list: string[] = [];
  if (Array.isArray(raw)) list = raw.map(String).filter(Boolean);
  else if (typeof raw === "string" && raw.trim()) {
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) list = parsed.map(String).filter(Boolean);
      } catch {
        /* ignore */
      }
    } else if (raw.startsWith("http") || raw.startsWith("/")) {
      list = [raw];
    }
  }
  return list[0] || fallback;
}

export function scoreTone(score: number): "vert" | "orange" | "rouge" {
  if (score > 75) return "vert";
  if (score >= 50) return "orange";
  return "rouge";
}

export function scorePhrase(score: number) {
  if (score > 75) return "Tout va bien 👍";
  if (score >= 50) return "Pense à en parler avec ton gérant 😊";
  return "On te conseille de contacter ton gérant";
}

export function occupancyColor(rate: number) {
  if (rate > 70) return "var(--p-optimal)";
  if (rate >= 40) return "var(--p-attention)";
  return "var(--p-verifier)";
}

export type VariationFinances = {
  label?: string;
  total_encaisse_precedent?: number;
  delta_pct?: number | null;
};

export function variationHint(variation?: VariationFinances | null) {
  if (!variation || variation.delta_pct == null) return null;
  const prev = Number(variation.total_encaisse_precedent || 0);
  const pct = Number(variation.delta_pct);
  const nouveau = prev === 0 && pct === 100;
  const label = variation.label || "vs période précédente";
  return {
    text: nouveau ? `${label} : Nouveau` : `${label} : ${pct > 0 ? "+" : ""}${pct}%`,
    positive: nouveau || pct >= 0,
  };
}
