import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { gerantApi } from "@/lib/api";
import JoueurProfil from "./JoueurProfil";

const FILTERS = [
  { id: "all", label: "Tous" },
  { id: "actifs", label: "Actifs" },
  { id: "dette", label: "Dette" },
  { id: "bannis", label: "Bannis" },
] as const;

type JoueurRow = {
  id: number;
  display_nom: string;
  telephone?: string | null;
  last_match_at?: string | null;
  assiduite_30j?: number;
  solde_ouvert?: number;
  statut?: string;
  is_banned?: boolean;
};

export default function JoueursPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const selectedId = id ? Number(id) : null;

  const { data, isLoading } = useQuery({
    queryKey: ["gerant", "joueurs", filter],
    queryFn: () => gerantApi.joueurs({ filter }),
  });

  const joueurs = useMemo(() => {
    const rows = ((data as { joueurs?: JoueurRow[] })?.joueurs || []) as JoueurRow[];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((j) => `${j.display_nom} ${j.telephone || ""}`.toLowerCase().includes(needle));
  }, [data, q]);

  return (
    <div className="max-w-[1200px] mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>Joueurs</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">Base CRM du terrain — séparée du flux du jour.</p>
      </div>

      <div className="grid md:grid-cols-[minmax(0,38%)_minmax(0,62%)] gap-4 items-start">
        <div className={`${selectedId ? "hidden md:block" : "block"} bg-white border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden`}>
          <div className="p-3 border-b border-[var(--color-border)] space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Nom, téléphone"
                className="w-full h-10 pl-9 pr-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm bg-[var(--color-bg)]"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`h-7 px-2.5 rounded-full text-[12px] font-medium ${
                    filter === f.id ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-2 animate-pulse">
              {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded bg-[var(--color-surface-2)]" />)}
            </div>
          ) : (
            <ul className="max-h-[calc(100vh-220px)] overflow-auto divide-y divide-[var(--color-border)]">
              {joueurs.length === 0 && (
                <li className="px-4 py-8 text-sm text-[var(--color-text-muted)] text-center">Aucun joueur</li>
              )}
              {joueurs.map((j) => (
                <li key={j.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/backoffice/gerant/joueurs/${j.id}`)}
                    className={`w-full text-left px-4 py-3 hover:bg-[var(--color-bg)] ${selectedId === j.id ? "bg-[var(--color-bg)]" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate">{j.display_nom}</p>
                      <span className={`text-[10px] font-semibold uppercase ${j.is_banned ? "text-[var(--color-danger)]" : j.solde_ouvert ? "text-[var(--color-warning)]" : "text-[var(--color-text-muted)]"}`}>
                        {j.is_banned ? "Banni" : j.solde_ouvert ? "Dette" : "OK"}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                      {j.telephone || "—"} · {j.assiduite_30j || 0}% · {j.last_match_at || "jamais"}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={!selectedId ? "hidden md:block" : "block"}>
          {selectedId ? (
            <JoueurProfil embedded />
          ) : (
            <div className="hidden md:flex min-h-[360px] items-center justify-center border border-dashed border-[var(--color-border)] rounded-[var(--radius-md)] text-sm text-[var(--color-text-muted)]">
              Sélectionnez un joueur
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
