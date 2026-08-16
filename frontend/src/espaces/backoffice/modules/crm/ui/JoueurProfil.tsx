import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { gerantApi } from "@/lib/api";
import { toast } from "sonner";

type Tab = "historique" | "stats" | "finance";

const TABS: { id: Tab; label: string }[] = [
  { id: "historique", label: "Historique" },
  { id: "stats", label: "Stats" },
  { id: "finance", label: "Finance" },
];

function fcfa(n?: number) {
  return `${Number(n || 0).toLocaleString("fr-FR")} FCFA`;
}

export default function JoueurProfil({ embedded = false }: { embedded?: boolean }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "historique";
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["gerant", "joueur", id],
    enabled: Boolean(id),
    queryFn: () => gerantApi.joueurDetail(id!) as Promise<{
      joueur: {
        display_nom?: string;
        nom: string;
        telephone?: string | null;
        is_banned?: boolean;
        notes_internes?: string | null;
      };
      stats: {
        matches_joues: number;
        no_shows: number;
        assiduite_30j: number;
        creneau_favori?: string | null;
        solde_ouvert: number;
        ca_total: number;
      };
      reservations: Array<{
        id: number;
        date: string;
        heure_debut: string;
        heure_fin: string;
        statut: string;
        montant_total: number;
        code_reservation?: string;
      }>;
      paiements: Array<{ id: number; montant: number; methode?: string; created_at?: string }>;
    }>,
  });

  useEffect(() => {
    if (data?.joueur?.notes_internes != null) setNotes(data.joueur.notes_internes);
  }, [data?.joueur?.notes_internes]);

  const patch = useMutation({
    mutationFn: (body: { is_banned?: boolean; notes_internes?: string; banned_reason?: string }) =>
      gerantApi.patchJoueur(id!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gerant", "joueur", id] });
      queryClient.invalidateQueries({ queryKey: ["gerant", "joueurs"] });
      queryClient.invalidateQueries({ queryKey: ["gerant", "flux"] });
    },
  });

  if (!id) return null;
  if (isLoading) {
    return <div className="h-full min-h-[320px] rounded-[var(--radius-md)] bg-[var(--color-surface-2)] animate-pulse" />;
  }
  if (!data?.joueur) {
    return <p className="text-sm text-[var(--color-text-muted)] p-6">Joueur introuvable sur ce terrain.</p>;
  }

  const j = data.joueur;
  const stats = data.stats;

  return (
    <div className="bg-white border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--color-border)]">
        {!embedded && (
          <button type="button" onClick={() => navigate("/backoffice/gerant/joueurs")} className="md:hidden inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] mb-3">
            <ArrowLeft className="w-4 h-4" /> Joueurs
          </button>
        )}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)" }}>{j.display_nom || j.nom}</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{j.telephone || "Pas de téléphone"}</p>
            <div className="flex gap-1.5 mt-2">
              {j.is_banned && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--color-danger)_12%,white)] text-[var(--color-danger)]">Banni</span>}
              {stats.solde_ouvert > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--color-warning)_14%,white)] text-[var(--color-warning)]">Dette {fcfa(stats.solde_ouvert)}</span>}
              {!j.is_banned && stats.solde_ouvert <= 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--color-success)_12%,white)] text-[var(--color-success)]">À jour</span>}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {j.telephone && (
              <a href={`tel:${j.telephone}`} className="h-9 w-9 inline-flex items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)]">
                <Phone className="w-4 h-4" />
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                void patch.mutateAsync({ is_banned: !j.is_banned, banned_reason: j.is_banned ? undefined : "Banni par le gérant" })
                  .then(() => toast.success(j.is_banned ? "Joueur réactivé" : "Joueur banni"))
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Action impossible"));
              }}
              className="h-9 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm"
            >
              <Ban className="w-3.5 h-3.5" />
              {j.is_banned ? "Lever" : "Bannir"}
            </button>
          </div>
        </div>
      </div>

      <div className="flex border-b border-[var(--color-border)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setParams({ tab: t.id }, { replace: true })}
            className={`flex-1 py-2.5 text-sm font-medium ${tab === t.id ? "text-[var(--color-primary)] border-b-2 border-[var(--color-primary)]" : "text-[var(--color-text-muted)]"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {tab === "historique" && (
          <ul className="divide-y divide-[var(--color-border)]">
            {(data.reservations || []).length === 0 && <li className="text-sm text-[var(--color-text-muted)] py-6">Aucun match sur ce terrain.</li>}
            {(data.reservations || []).map((r: { id: number; date: string; heure_debut: string; heure_fin: string; statut: string; montant_total: number; code_reservation?: string }) => (
              <li key={r.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{r.date} · {String(r.heure_debut).slice(0, 5)}–{String(r.heure_fin).slice(0, 5)}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{r.code_reservation || `#${r.id}`} · {r.statut}</p>
                </div>
                <p className="text-sm tabular-nums">{fcfa(r.montant_total)}</p>
              </li>
            ))}
          </ul>
        )}

        {tab === "stats" && (
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Matchs joués", stats.matches_joues],
              ["No-shows", stats.no_shows],
              ["Assiduité 30 j", `${stats.assiduite_30j} %`],
              ["Créneau favori", stats.creneau_favori || "—"],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] p-3">
                <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
                <p className="text-lg font-semibold mt-1" style={{ fontFamily: "var(--font-display)" }}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {tab === "finance" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] p-3">
                <p className="text-xs text-[var(--color-text-muted)]">Solde ouvert</p>
                <p className="text-lg font-semibold mt-1">{fcfa(stats.solde_ouvert)}</p>
              </div>
              <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] p-3">
                <p className="text-xs text-[var(--color-text-muted)]">CA terrain</p>
                <p className="text-lg font-semibold mt-1">{fcfa(stats.ca_total)}</p>
              </div>
            </div>
            <ul className="divide-y divide-[var(--color-border)]">
              {(data.paiements || []).map((p: { id: number; montant: number; methode?: string; created_at?: string }) => (
                <li key={p.id} className="py-2.5 flex justify-between text-sm">
                  <span>{p.methode || "paiement"} · {p.created_at ? String(p.created_at).slice(0, 10) : ""}</span>
                  <span className="tabular-nums">{fcfa(p.montant)}</span>
                </li>
              ))}
              {(data.paiements || []).length === 0 && <li className="text-sm text-[var(--color-text-muted)] py-4">Aucun paiement enregistré.</li>}
            </ul>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-[var(--color-border)]">
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide mb-2">Note interne</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full text-sm p-3 rounded-[var(--radius-sm)] border border-[var(--color-border)]"
            placeholder="Visible uniquement par le gérant"
          />
          <button
            type="button"
            className="mt-2 h-9 px-3 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-white text-sm font-medium"
            onClick={() => {
              void patch.mutateAsync({ notes_internes: notes })
                .then(() => toast.success("Note enregistrée"))
                .catch((e) => toast.error(e instanceof Error ? e.message : "Enregistrement impossible"));
            }}
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
