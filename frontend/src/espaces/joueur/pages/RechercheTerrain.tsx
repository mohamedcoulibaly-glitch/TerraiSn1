import { Search, SlidersHorizontal, LayoutGrid, List, X } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { terrainsApi } from "@/lib/api";
import FieldCard from "@/espaces/joueur/components/FieldCard";
import SkeletonTerrainCard from "@/components/skeletons/SkeletonTerrainCard";
import FiltresTerrain, {
  FILTRES_TERRAIN_DEFAUT,
  FiltresTerrainValues,
} from "@/espaces/joueur/components/FiltresTerrain";

function FootballEmpty() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden className="mx-auto text-[var(--color-primary)] opacity-80">
      <circle cx="40" cy="40" r="28" stroke="currentColor" strokeWidth="2.5" />
      <path d="M40 12 L52 28 L48 48 H32 L28 28 Z" stroke="currentColor" strokeWidth="2" fill="var(--color-primary-glow)" />
      <path d="M28 28 L12 36 L20 52 M52 28 L68 36 L60 52 M32 48 L28 68 M48 48 L52 68" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

const Explorer = () => {
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [draft, setDraft] = useState<FiltresTerrainValues>(FILTRES_TERRAIN_DEFAUT);
  const [applied, setApplied] = useState<FiltresTerrainValues>(FILTRES_TERRAIN_DEFAUT);
  const [terrains, setTerrains] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [geoOk, setGeoOk] = useState(false);

  useEffect(() => {
    loadTerrains();
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      () => setGeoOk(true),
      () => setGeoOk(false),
      { timeout: 4000, maximumAge: 300000 }
    );
  }, []);

  const loadTerrains = async () => {
    try {
      setError(null);
      setLoading(true);
      const data = await terrainsApi.list();
      setTerrains(data || []);
    } catch (err) {
      console.error(err);
      setError("Erreur lors du chargement des terrains. Veuillez vérifier votre connexion.");
      setTerrains([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    return terrains.filter((t) => {
      const matchSearch =
        !search.trim() ||
        t.nom?.toLowerCase().includes(search.toLowerCase()) ||
        (t.adresse || "").toLowerCase().includes(search.toLowerCase()) ||
        (t.ville || "").toLowerCase().includes(search.toLowerCase());
      const matchType =
        !applied.type ||
        (applied.type === "demi_terrain" && Number(t.prix_moitie) > 0) ||
        (applied.type === "terrain_entier" && Number(t.prix_entier || t.prix_heure) > 0);
      const matchQuartier =
        !applied.quartier.trim() ||
        String(t.adresse || t.ville || t.nom || "")
          .toLowerCase()
          .includes(applied.quartier.trim().toLowerCase());
      const matchPrix = Number(t.prix_heure || 0) <= applied.prix_max;
      return matchSearch && matchType && matchQuartier && matchPrix;
    });
  }, [terrains, search, applied]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (applied.date) n += 1;
    if (applied.heure) n += 1;
    if (applied.type) n += 1;
    if (applied.quartier.trim()) n += 1;
    if (applied.prix_max < 100000) n += 1;
    return n;
  }, [applied]);

  const quartiers = Array.from(
    new Set(terrains.map((t) => String(t.adresse || t.ville || "").split(",")[0].trim()).filter(Boolean))
  ).slice(0, 40);

  return (
    <div className="page-container !pt-0 page-enter">
      <header className="sticky top-14 z-30 bg-[var(--surface)]/95 backdrop-blur-md border-b border-[var(--color-border)] px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="flex-1 flex items-center gap-3 px-4 h-[48px] bg-[var(--color-surface-2)] rounded-[var(--radius-xl)]">
            <Search className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0" />
            <input
              type="text"
              placeholder="Quartier, terrain..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-text-muted)]"
              id="explorer-search"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters(true)}
            className="relative min-w-[48px] h-12 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--surface)] flex items-center justify-center gap-2"
          >
            <SlidersHorizontal className="w-4 h-4 text-[var(--color-text-secondary)]" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--color-primary)] text-white text-[11px] font-semibold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="responsive-padding mt-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <p className="text-sm text-[var(--color-text-muted)]">
            {loading ? "…" : `${filtered.length} terrains disponibles`}
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`w-11 h-11 rounded-[var(--radius-md)] flex items-center justify-center ${
                viewMode === "grid" ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"
              }`}
              aria-label="Grille"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`w-11 h-11 rounded-[var(--radius-md)] flex items-center justify-center ${
                viewMode === "list" ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"
              }`}
              aria-label="Liste"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <SkeletonTerrainCard />
            <SkeletonTerrainCard />
            <SkeletonTerrainCard />
          </div>
        ) : error ? (
          <div className="text-center py-10">
            <p className="text-[var(--color-danger)] text-sm mb-4">{error}</p>
            <button type="button" onClick={loadTerrains} className="btn-primary px-6">
              Réessayer
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-14 space-y-3">
            <FootballEmpty />
            <h3 className="text-base font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              Aucun terrain trouvé
            </h3>
            <p className="text-sm text-[var(--color-text-muted)]">
              Essaie d'autres filtres ou un quartier différent
            </p>
            <button
              type="button"
              onClick={() => {
                setDraft(FILTRES_TERRAIN_DEFAUT);
                setApplied(FILTRES_TERRAIN_DEFAUT);
                setSearch("");
              }}
              className="mt-2 mx-auto inline-flex min-h-11 px-5 rounded-[var(--radius-md)] border-2 border-[var(--color-primary)] text-[var(--color-primary)] text-sm font-medium"
            >
              Réinitialiser les filtres
            </button>
          </div>
        ) : (
          <div
            className={
              viewMode === "grid"
                ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
                : "flex flex-col gap-3"
            }
          >
            {filtered.map((t) => (
              <FieldCard key={t.id} terrain={t} variant={viewMode === "grid" ? "grid" : "list"} />
            ))}
          </div>
        )}
      </div>

      {showFilters && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Fermer"
            onClick={() => setShowFilters(false)}
          />
          <div className="relative bg-[var(--surface)] rounded-t-[var(--radius-xl)] max-h-[85dvh] overflow-y-auto shadow-[var(--shadow-lg)] pb-[env(safe-area-inset-bottom)]">
            <div className="sticky top-0 bg-[var(--surface)] z-10 pt-3 pb-2 px-4 border-b border-[var(--color-border)]">
              <div className="w-8 h-1 rounded-full bg-[var(--color-border-strong)] mx-auto mb-3" />
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                  Filtrer les terrains
                </h2>
                <button type="button" onClick={() => setShowFilters(false)} className="w-11 h-11 flex items-center justify-center" aria-label="Fermer filtres">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-4">
              <FiltresTerrain
                value={draft}
                onChange={setDraft}
                onApply={() => {
                  setApplied(draft);
                  setShowFilters(false);
                }}
                onReset={() => {
                  setDraft(FILTRES_TERRAIN_DEFAUT);
                  setApplied(FILTRES_TERRAIN_DEFAUT);
                }}
                geoAccordee={geoOk}
                quartiers={quartiers}
              />
            </div>
            <div className="sticky bottom-0 bg-[var(--surface)] border-t border-[var(--color-border)] p-4 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setDraft(FILTRES_TERRAIN_DEFAUT);
                  setApplied(FILTRES_TERRAIN_DEFAUT);
                }}
                className="flex-1 h-12 rounded-[var(--radius-md)] border border-[var(--color-border)] text-sm font-medium text-[var(--color-text-secondary)]"
              >
                Réinitialiser
              </button>
              <button
                type="button"
                onClick={() => {
                  setApplied(draft);
                  setShowFilters(false);
                }}
                className="flex-[1.4] h-12 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium"
              >
                Voir {filtered.length} terrains
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Explorer;
