import { useEffect, useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi } from "@/services/superAdminApi";
import { ConfirmationModal } from "@/espaces/backoffice/components/superadmin/ConfirmationModal";

type Essai = {
  etat: "inactif" | "actif" | "expire" | "suspendu";
  mode_essai: number;
  essai_debut_at?: string | null;
  essai_fin_at?: string | null;
  essai_duree_jours?: number;
  delai_negociation_jours?: number;
  jours_restants?: number;
  nego_restants?: number;
  suspensionAt?: string | null;
  notif_essai_fin_j7?: number;
  notif_essai_fin_j3?: number;
  notif_essai_fin_j1?: number;
};

const BADGE: Record<Essai["etat"], { label: string; color: string; bg: string }> = {
  inactif: { label: "Inactif", color: "var(--sa-muted)", bg: "var(--sa-surface-2)" },
  actif: { label: "Actif", color: "var(--sa-info)", bg: "var(--sa-info-bg)" },
  expire: { label: "Expiré", color: "var(--sa-warning)", bg: "var(--sa-warning-bg)" },
  suspendu: { label: "Suspendu", color: "var(--sa-danger)", bg: "var(--sa-danger-bg)" },
};

export default function EssaiGratuitSection({ terrainId, nom }: { terrainId: number; nom?: string }) {
  const [essai, setEssai] = useState<Essai | null>(null);
  const [confirm, setConfirm] = useState<null | { action: string; titre: string; texte: string }>(null);
  const [duree, setDuree] = useState(30);
  const [nego, setNego] = useState(7);
  const [busy, setBusy] = useState(false);

  const load = () => superAdminApi.terrainEssai(terrainId).then(setEssai).catch(() => setEssai(null));

  useEffect(() => {
    load().catch(() => {});
  }, [terrainId]);

  async function run(action: string, extra?: Record<string, number>) {
    setBusy(true);
    try {
      const next = await superAdminApi.patchTerrainEssai(terrainId, { action, essai_duree_jours: duree, delai_negociation_jours: nego, ...extra });
      setEssai(next);
      toast.success("Mode essai mis à jour");
      setConfirm(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action impossible");
    } finally {
      setBusy(false);
    }
  }

  if (!essai) return null;
  const badge = BADGE[essai.etat] || BADGE.inactif;
  const total = Number(essai.essai_duree_jours || 30);
  const rest = Number(essai.jours_restants || 0);
  const elapsed = essai.etat === "actif" ? Math.min(100, Math.round(((total - rest) / total) * 100)) : essai.etat === "inactif" ? 0 : 100;
  const barColor = elapsed < 60 ? "var(--sa-success)" : elapsed < 85 ? "var(--sa-warning)" : "var(--sa-danger)";

  return (
    <section className="rounded-xl p-5 space-y-4 mb-4" style={{ background: "var(--sa-info-bg)", border: "1px solid var(--sa-info)" }}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold inline-flex items-center gap-2" style={{ color: "var(--sa-text)", fontFamily: "var(--font-display)" }}>
          <FlaskConical size={18} style={{ color: "var(--sa-info)" }} /> Mode essai gratuit
        </h3>
        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ color: badge.color, background: badge.bg }}>{badge.label}</span>
      </div>

      {essai.etat === "inactif" ? (
        <>
          <p className="text-[13px]" style={{ color: "var(--sa-text-2)" }}>En mode essai, aucune commission n&apos;est prélevée. Idéal pour onboarder un nouveau terrain.</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[12px]" style={{ color: "var(--sa-muted)" }}>Durée (jours)
              <input type="number" className="mt-1 w-full h-10 rounded-lg px-2" value={duree} onChange={(e) => setDuree(Number(e.target.value))} />
            </label>
            <label className="text-[12px]" style={{ color: "var(--sa-muted)" }}>Délai négociation
              <input type="number" className="mt-1 w-full h-10 rounded-lg px-2" value={nego} onChange={(e) => setNego(Number(e.target.value))} />
            </label>
          </div>
          <button type="button" onClick={() => setConfirm({ action: "activer", titre: `Activer l'essai pour ${nom || "ce terrain"} ?`, texte: "Après la durée d'essai + délai de négociation, le terrain sera automatiquement suspendu s'il n'est pas passé en production. (La commission 0 sera branchée par Mohamed.)" })} className="min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white" style={{ background: "var(--sa-info)" }}>
            Activer l&apos;essai gratuit
          </button>
        </>
      ) : null}

      {essai.etat === "actif" ? (
        <>
          <p className="text-[13px]" style={{ color: "var(--sa-text-2)" }}>Essai commencé le {essai.essai_debut_at} · Fin le {essai.essai_fin_at} (dans {essai.jours_restants} j)</p>
          <p className="text-[12px]" style={{ color: Number(essai.nego_restants) < 3 ? "var(--sa-danger)" : "var(--sa-warning)" }}>
            Suspension auto si inactif : {essai.suspensionAt}
          </p>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--sa-surface)" }}>
            <div className="h-full" style={{ width: `${elapsed}%`, background: barColor }} />
          </div>
          <p className="text-[11px]" style={{ color: "var(--sa-muted)" }}>Jour {total - rest} sur {total}</p>
          <ul className="text-[12px] space-y-1" style={{ color: "var(--sa-text-2)" }}>
            <li>J-7 : {essai.notif_essai_fin_j7 ? "envoyé" : "planifié"}</li>
            <li>J-3 : {essai.notif_essai_fin_j3 ? "envoyé" : "planifié"}</li>
            <li>J-1 : {essai.notif_essai_fin_j1 ? "envoyé" : "planifié"}</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setConfirm({ action: "production", titre: "Passer en production ?", texte: "L'essai sera désactivé. Les commissions seront appliquées dès que Mohamed aura branché la règle métier." })} className="min-h-[40px] px-3 rounded-lg text-[12px] font-semibold text-white" style={{ background: "var(--sa-success)" }}>Passer en production</button>
            <button type="button" onClick={() => run("modifier")} className="min-h-[40px] px-3 rounded-lg text-[12px] font-semibold" style={{ border: "1px solid var(--sa-info)", color: "var(--sa-info)" }}>Modifier la durée</button>
            <button type="button" onClick={() => setConfirm({ action: "desactiver", titre: "Désactiver l'essai ?", texte: "Le terrain repassera en mode normal sans commission gratuite." })} className="min-h-[40px] px-3 rounded-lg text-[12px]" style={{ color: "var(--sa-danger)" }}>Désactiver</button>
          </div>
        </>
      ) : null}

      {essai.etat === "expire" ? (
        <>
          <p className="text-[13px]" style={{ color: "var(--sa-text-2)" }}>L&apos;essai de {nom} a expiré le {essai.essai_fin_at}. Suspension dans {essai.nego_restants} jour(s) si non activé.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => run("production")} className="min-h-[40px] px-3 rounded-lg text-[12px] font-semibold text-white" style={{ background: "var(--sa-success)" }}>Activer la production</button>
            <button type="button" onClick={() => run("delai", { jours: 7 })} className="min-h-[40px] px-3 rounded-lg text-[12px]" style={{ border: "1px solid var(--sa-border)" }}>+7 jours de délai</button>
          </div>
        </>
      ) : null}

      {essai.etat === "suspendu" ? (
        <>
          <p className="text-[13px]" style={{ color: "var(--sa-text-2)" }}>Terrain suspendu automatiquement après la fin du délai de négociation.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => run("reactiver-essai")} className="min-h-[40px] px-3 rounded-lg text-[12px] font-semibold" style={{ border: "1px solid var(--sa-info)", color: "var(--sa-info)" }}>Réactiver en essai</button>
            <button type="button" onClick={() => run("reactiver-production")} className="min-h-[40px] px-3 rounded-lg text-[12px] font-semibold text-white" style={{ background: "var(--sa-success)" }}>Réactiver en production</button>
          </div>
        </>
      ) : null}

      <ConfirmationModal
        ouvert={Boolean(confirm)}
        titre={confirm?.titre || ""}
        texte={confirm?.texte || ""}
        onAnnuler={() => setConfirm(null)}
        onConfirmer={() => confirm && run(confirm.action)}
      />
      {busy ? <p className="text-[12px] inline-flex items-center gap-2" style={{ color: "var(--sa-muted)" }}><Loader2 size={14} className="animate-spin" /> Mise à jour…</p> : null}
    </section>
  );
}
