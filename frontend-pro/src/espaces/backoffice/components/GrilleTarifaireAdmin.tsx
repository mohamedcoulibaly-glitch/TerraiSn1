import { FormEvent, useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi } from "@/services/superAdminApi";
import GrilleTarifaireForm, {
  emptyGrilleValues,
  type GrilleValues,
} from "@/espaces/backoffice/components/GrilleTarifaireForm";

type Proposition = {
  id: number;
  statut: string;
  created_at?: string;
  demandeur_type?: string | null;
  payload?: GrilleValues | null;
};

type Apercu = {
  quand: string;
  nom_tarif: string;
  prix_demi_terrain: number;
  prix_terrain_entier: number;
};

function formatFcfa(n: number) {
  return `${Number(n || 0).toLocaleString("fr-FR")} FCFA`;
}

function asGrille(raw: any, base: { entier: number; demi: number }): GrilleValues {
  if (raw && raw.semaine && raw.weekend) {
    return {
      heure_pivot_semaine: raw.heure_pivot_semaine || "18:00",
      heure_pivot_weekend: raw.heure_pivot_weekend || "18:00",
      semaine: {
        avant: { demi: Number(raw.semaine.avant?.demi || 0), entier: Number(raw.semaine.avant?.entier || 0) },
        apres: { demi: Number(raw.semaine.apres?.demi || 0), entier: Number(raw.semaine.apres?.entier || 0) },
      },
      weekend: {
        avant: { demi: Number(raw.weekend.avant?.demi || 0), entier: Number(raw.weekend.avant?.entier || 0) },
        apres: { demi: Number(raw.weekend.apres?.demi || 0), entier: Number(raw.weekend.apres?.entier || 0) },
      },
    };
  }
  return emptyGrilleValues(base);
}

export default function GrilleTarifaireAdmin({
  terrainId,
  terrainNom,
  onClose,
}: {
  terrainId: number;
  terrainNom: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apercu, setApercu] = useState<Apercu[]>([]);
  const [base, setBase] = useState({ entier: 0, demi: 0 });
  const [form, setForm] = useState<GrilleValues>(emptyGrilleValues());
  const [propositions, setPropositions] = useState<Proposition[]>([]);

  const load = async () => {
    const data = await superAdminApi.reglesTarifs(terrainId);
    const nextBase = {
      entier: Number(data.prix_entier_base || 0),
      demi: Number(data.prix_moitie_base || 0),
    };
    setBase(nextBase);
    setApercu(data.apercu || []);
    setForm(asGrille(data.grille_standard, nextBase));
    setPropositions(data.propositions || []);
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    load()
      .catch((err) => toast.error(err instanceof Error ? err.message : "Chargement impossible"))
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [terrainId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await superAdminApi.saveGrilleTarifs(terrainId, form);
      setApercu(result.apercu || []);
      if (result.grille) setForm(asGrille(result.grille, base));
      toast.success("Grille tarifaire activée");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  };

  const valider = async (id: number) => {
    try {
      await superAdminApi.validerPropositionTarif(id);
      toast.success("Proposition validée — grille active");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Validation impossible");
    }
  };

  const refuser = async (id: number) => {
    try {
      await superAdminApi.refuserPropositionTarif(id);
      toast.success("Proposition refusée");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refus impossible");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-[var(--radius-lg)] bg-white p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              Grille tarifaire
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{terrainNom}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--color-surface-2)]" aria-label="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)] py-8 text-center">Chargement…</p>
        ) : (
          <>
            {propositions.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-4 space-y-2">
                <p className="text-sm font-semibold text-amber-900">En attente de confirmation</p>
                {propositions.map((p) => (
                  <div key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <p className="text-xs text-amber-800 flex-1">
                      Proposition #{p.id} · {p.demandeur_type === "proprietaire" ? "Propriétaire" : "Gérant"}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void valider(p.id)}
                        className="min-h-[44px] px-3 rounded-lg bg-[var(--color-primary)] text-white text-sm font-semibold"
                      >
                        Valider
                      </button>
                      <button
                        type="button"
                        onClick={() => void refuser(p.id)}
                        className="min-h-[44px] px-3 rounded-lg text-sm font-semibold"
                        style={{ color: "var(--g-danger, #DC2626)", background: "#fff" }}
                      >
                        Refuser
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 mb-4 bg-[var(--color-surface-2)]">
              <p className="text-xs font-semibold mb-2">Aperçu</p>
              <ul className="space-y-1.5">
                {apercu.map((a) => (
                  <li key={a.quand} className="text-sm">
                    {a.quand} → <span className="font-medium">{a.nom_tarif}</span> : {formatFcfa(a.prix_terrain_entier)}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] mt-2 text-[var(--color-text-muted)]">
                Tarif de base actuel : demi {formatFcfa(base.demi)} · entier {formatFcfa(base.entier)}
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <GrilleTarifaireForm value={form} onChange={setForm} />
              <button
                type="submit"
                disabled={saving}
                className="w-full min-h-[48px] rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "var(--color-primary)" }}
              >
                {saving ? "Activation…" : "Enregistrer et activer"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
