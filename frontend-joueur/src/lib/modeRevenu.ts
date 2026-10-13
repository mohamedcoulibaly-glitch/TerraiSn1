export type ModeRevenu = "essai" | "commission" | "abonnement" | "achat";

export function joursEssaiRestants(t: any): number | null {
  const fin = t?.essai_fin_at ? String(t.essai_fin_at).slice(0, 10) : null;
  if (!fin) return null;
  const today = new Date().toISOString().slice(0, 10);
  return Math.round((new Date(`${fin}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000);
}

export function resolveModeRevenu(t: any): ModeRevenu {
  if (t?.mode_revenu) return t.mode_revenu as ModeRevenu;
  const modeEssai = Number(t?.mode_essai) === 1;
  const suspendu = Number(t?.essai_suspendu_auto) === 1;
  const fin = t?.essai_fin_at ? String(t.essai_fin_at).slice(0, 10) : null;
  const today = new Date().toISOString().slice(0, 10);
  if (suspendu || (modeEssai && fin && today > fin) || modeEssai) return "essai";
  const m = String(t?.modele_revenus || "commission");
  if (m === "abonnement") return "abonnement";
  if (m === "achat_definitif") return "achat";
  return "commission";
}
