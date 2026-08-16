import { useEffect, useState } from "react";
import { ArrowDownToLine, Banknote, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { gerantApi } from "@/lib/api";

type Reversement = {
  reservation_id?: number;
  montant?: number;
  date?: string;
  statut?: string;
};

type PortefeuilleData = {
  solde_disponible: number;
  total_encaisse: number;
  total_commission_prelevee: number;
  historique_reversements: Reversement[];
  acomptes_mois?: number;
  matchs_mois?: number;
};

type TarifsLite = {
  prix_entier_base?: number;
  prix_moitie_base?: number;
  pourcentage_avance?: number;
};

function formatFcfa(value?: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} FCFA`;
}

function formatDate(value?: string) {
  if (!value) return "—";
  const raw = String(value).trim();
  const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function FinancesPage() {
  const [data, setData] = useState<PortefeuilleData | null>(null);
  const [tarifs, setTarifs] = useState<TarifsLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([gerantApi.portefeuille(), gerantApi.getTarifs()])
      .then(([portefeuille, grille]) => {
        if (!mounted) return;
        setData(portefeuille as PortefeuilleData);
        setTarifs(grille as TarifsLite);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Impossible de charger les gains");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        <div className="h-36 rounded-2xl" style={{ background: "var(--g-surface-2)" }} />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl" style={{ background: "var(--g-surface-2)" }} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4">
        <p className="text-sm" style={{ color: "var(--g-danger)" }}>
          {error || "Mes gains indisponibles"}
        </p>
      </div>
    );
  }

  const historique = data.historique_reversements || [];
  const acomptes = Number(data.acomptes_mois ?? data.total_encaisse ?? 0);
  const matchsMois = Number(data.matchs_mois ?? historique.length);

  return (
    <div className="p-4 space-y-6">
      <section
        className="rounded-2xl p-5 text-white"
        style={{ background: "var(--g-primary)", boxShadow: "var(--g-shadow-md)" }}
      >
        <p className="text-sm text-white/85">Ton solde disponible</p>
        <p className="mt-2 text-4xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          {formatFcfa(data.solde_disponible)}
        </p>
        <button
          type="button"
          onClick={() => toast.message("Demande de virement : contacte l'administration TerrainSN")}
          className="mt-4 min-h-[44px] px-4 rounded-xl text-sm font-semibold border border-white/70"
        >
          Demander un virement
        </button>
        <p className="mt-3 text-xs text-white/75">
          Total encaissé ce mois : {formatFcfa(data.total_encaisse)}
        </p>
      </section>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl p-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
          <Banknote className="w-4 h-4 mb-2" style={{ color: "var(--g-primary)" }} />
          <p className="text-lg font-bold leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--g-text)" }}>
            {formatFcfa(acomptes)}
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--g-muted)" }}>
            Avances reçues ce mois
          </p>
        </div>
        <div className="rounded-xl p-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
          <CalendarDays className="w-4 h-4 mb-2" style={{ color: "var(--g-info)" }} />
          <p className="text-lg font-bold leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--g-text)" }}>
            {matchsMois}
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--g-muted)" }}>
            Matchs joués ce mois
          </p>
        </div>
        <div className="rounded-xl p-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
          <ArrowDownToLine className="w-4 h-4 mb-2" style={{ color: "var(--g-accent)" }} />
          <p className="text-lg font-bold leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--g-text)" }}>
            {historique.length}
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--g-muted)" }}>
            Reversements
          </p>
        </div>
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--g-text)" }}>
          Historique
        </h2>
        {historique.length === 0 ? (
          <p
            className="text-sm text-center py-8 rounded-xl"
            style={{ color: "var(--g-muted)", background: "var(--g-surface)" }}
          >
            Aucun reversement pour le moment
          </p>
        ) : (
          <ul className="space-y-2">
            {historique.map((item, index) => (
              <li
                key={`${item.reservation_id || "r"}-${item.date || index}`}
                className="rounded-xl p-3 flex items-center justify-between gap-3"
                style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
              >
                <div>
                  <p className="text-xs" style={{ color: "var(--g-muted)" }}>
                    {formatDate(item.date)}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--g-text-2)" }}>
                    Réservation #{item.reservation_id || "—"}
                  </p>
                </div>
                <p className="text-sm font-bold" style={{ color: "var(--g-libre)" }}>
                  {formatFcfa(item.montant)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--g-text)" }}>
          Prix de ton terrain (visibles côté joueur)
        </h2>
        <TarifsEditor initial={tarifs} onSaved={setTarifs} />
      </section>
    </div>
  );
}

function TarifsEditor({
  initial,
  onSaved,
}: {
  initial: TarifsLite | null;
  onSaved: (t: TarifsLite) => void;
}) {
  const [entier, setEntier] = useState(String(initial?.prix_entier_base || ""));
  const [moitie, setMoitie] = useState(String(initial?.prix_moitie_base || ""));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEntier(String(initial?.prix_entier_base || ""));
    setMoitie(String(initial?.prix_moitie_base || ""));
  }, [initial?.prix_entier_base, initial?.prix_moitie_base]);

  const save = async () => {
    const prix_entier_base = Number(entier);
    const prix_moitie_base = Number(moitie);
    if (!(prix_entier_base > 0) || !(prix_moitie_base > 0)) {
      toast.error("Tarifs invalides");
      return;
    }
    setSaving(true);
    try {
      const grille = (await gerantApi.saveTarifs({
        prix_entier_base,
        prix_moitie_base,
        cellules: [],
      })) as TarifsLite;
      onSaved(grille);
      toast.success("Tarifs mis à jour — le joueur voit les nouveaux prix");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sauvegarde impossible");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
      <label className="block text-sm" style={{ color: "var(--g-text)" }}>
        Terrain entier (FCFA / h)
        <input
          type="number"
          value={entier}
          onChange={(e) => setEntier(e.target.value)}
          className="mt-1 w-full h-11 px-3 rounded-lg border text-sm"
          style={{ borderColor: "var(--g-border)", background: "var(--g-surface-2)" }}
        />
      </label>
      <label className="block text-sm" style={{ color: "var(--g-text)" }}>
        Demi-terrain (FCFA / h)
        <input
          type="number"
          value={moitie}
          onChange={(e) => setMoitie(e.target.value)}
          className="mt-1 w-full h-11 px-3 rounded-lg border text-sm"
          style={{ borderColor: "var(--g-border)", background: "var(--g-surface-2)" }}
        />
      </label>
      <p className="text-sm" style={{ color: "var(--g-text)" }}>
        Avance joueur : <strong>{Number(initial?.pourcentage_avance || 0)}%</strong> du prix
      </p>
      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="w-full min-h-[44px] rounded-xl text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--g-primary)" }}
      >
        {saving ? "Enregistrement…" : "Enregistrer les tarifs"}
      </button>
    </div>
  );
}
