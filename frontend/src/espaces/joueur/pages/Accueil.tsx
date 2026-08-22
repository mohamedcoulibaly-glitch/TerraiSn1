import { MapPin } from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { terrainsApi } from "@/lib/api";
import { PitchCard } from "@/espaces/joueur/components/PitchCard";
import BannerVideoHeader from "@/espaces/joueur/components/BannerVideoHeader";
import SkeletonAccueil from "@/components/skeletons/SkeletonAccueil";
import SkeletonTerrainCard from "@/components/skeletons/SkeletonTerrainCard";
import FiltresTerrain, {
  FILTRES_TERRAIN_DEFAUT,
  FiltresTerrainValues,
} from "@/espaces/joueur/components/FiltresTerrain";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

type GeoState = {
  lat: number | null;
  lng: number | null;
  denied: boolean;
  ready: boolean;
};

/** Puces exclusives (une seule active) */
type QuickFiltre =
  | "tous"
  | "pres"
  | "demain"
  | "weekend"
  | "5v5"
  | "7v7"
  | "11v11";

const QUICK_FILTRES: { id: QuickFiltre; label: string }[] = [
  { id: "tous", label: "Tous" },
  { id: "pres", label: "Près de toi" },
  { id: "demain", label: "📅 Demain" },
  { id: "weekend", label: "Ce week-end" },
  { id: "5v5", label: "5v5" },
  { id: "7v7", label: "7v7" },
  { id: "11v11", label: "11v11" },
];

const FORMAT_FILTRES: QuickFiltre[] = ["5v5", "7v7", "11v11"];

function toLocalISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getTomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toLocalISO(d);
}

/** Samedi + dimanche du week-end en cours ou à venir */
function getWeekendISOs(): [string, string] {
  const d = new Date();
  const day = d.getDay(); // 0=dim … 6=sam
  const sat = new Date(d);
  if (day === 0) sat.setDate(d.getDate() - 1);
  else if (day !== 6) sat.setDate(d.getDate() + (6 - day));
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  return [toLocalISO(sat), toLocalISO(sun)];
}

function dateContextLabel(quick: QuickFiltre, advancedDate?: string): string | null {
  if (quick === "demain") return "demain";
  if (quick === "weekend") return "ce week-end";
  if (advancedDate) {
    if (advancedDate === getTomorrowISO()) return "demain";
    const [y, m, day] = advancedDate.split("-");
    if (y && m && day) return `le ${day}/${m}`;
  }
  return null;
}

const Accueil = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [terrains, setTerrains] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFiltres, setShowFiltres] = useState(false);
  const [quickFiltre, setQuickFiltre] = useState<QuickFiltre>("tous");
  const [favTick, setFavTick] = useState(0);
  const [draftFiltres, setDraftFiltres] = useState<FiltresTerrainValues>(FILTRES_TERRAIN_DEFAUT);
  const [appliedFiltres, setAppliedFiltres] = useState<FiltresTerrainValues>(FILTRES_TERRAIN_DEFAUT);  const [geo, setGeo] = useState<GeoState>({ lat: null, lng: null, denied: false, ready: false });

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeo({ lat: null, lng: null, denied: true, ready: true });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          denied: false,
          ready: true,
        });
      },
      () => {
        setGeo({ lat: null, lng: null, denied: true, ready: true });
      },
      { timeout: 5000, maximumAge: 300000 }
    );
  }, []);

  useEffect(() => {
    const refresh = () => setFavTick((n) => n + 1);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const loadTerrains = useCallback(async () => {
    if (!geo.ready) return;
    try {
      setLoading(true);
      setError(null);
      const filters: Record<string, string | number> = {};

      const useGeo =
        (!geo.denied && geo.lat != null && geo.lng != null) || quickFiltre === "pres";
      if (useGeo && geo.lat != null && geo.lng != null) {
        filters.lat = geo.lat;
        filters.lng = geo.lng;
        filters.distance_max =
          quickFiltre === "pres" ? 3 : appliedFiltres.distance_max || 10;
      }

      if (appliedFiltres.quartier.trim()) filters.quartier = appliedFiltres.quartier.trim();
      if (searchQuery.trim()) filters.search = searchQuery.trim();

      // Format terrain (5v5 / 7v7 / 11v11) ou filtre avancé demi/entier
      if (FORMAT_FILTRES.includes(quickFiltre)) filters.type = quickFiltre;
      else if (appliedFiltres.type) filters.type = appliedFiltres.type;

      // Dates selon puce rapide
      if (quickFiltre === "demain") {
        filters.date = getTomorrowISO();
      } else if (quickFiltre === "weekend") {
        filters.dates = getWeekendISOs().join(",");
      } else if (appliedFiltres.date) {
        filters.date = appliedFiltres.date;
      }

      if (appliedFiltres.heure) filters.heure = appliedFiltres.heure;
      if (appliedFiltres.prix_max < 100000) filters.prix_max = appliedFiltres.prix_max;

      const data = await terrainsApi.list(filters);
      setTerrains(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setError("Une erreur est survenue lors du chargement des terrains.");
      setTerrains([]);
    } finally {
      setLoading(false);
    }
  }, [geo, searchQuery, appliedFiltres, quickFiltre]);

  useEffect(() => {
    loadTerrains();
  }, [loadTerrains]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (appliedFiltres.date && quickFiltre !== "demain") n += 1;
    if (appliedFiltres.heure) n += 1;
    if (appliedFiltres.type) n += 1;
    if (appliedFiltres.quartier.trim()) n += 1;
    if (appliedFiltres.prix_max < 100000) n += 1;
    if (!geo.denied && appliedFiltres.distance_max !== 10) n += 1;
    return n;
  }, [appliedFiltres, geo.denied, quickFiltre]);

  const dateLabel = useMemo(
    () => dateContextLabel(quickFiltre, appliedFiltres.date),
    [quickFiltre, appliedFiltres.date]
  );

  const terrainsFiltres = useMemo(() => {
    void favTick;
    if (quickFiltre !== "pres") return terrains;
    return [...terrains]
      .filter((t) => t.distance_km != null && Number(t.distance_km) <= 3)
      .sort((a, b) => Number(a.distance_km) - Number(b.distance_km));
  }, [terrains, quickFiltre, favTick]);

  const quartiers = Array.from(
    new Set(
      terrains
        .map((t) => String(t.adresse || t.ville || "").split(",")[0].trim())
        .filter(Boolean)
    )
  ).slice(0, 40);

  const applyFiltres = () => {
    setAppliedFiltres(draftFiltres);
    if (draftFiltres.date === getTomorrowISO()) {
      setQuickFiltre("demain");
    } else if (draftFiltres.date) {
      setQuickFiltre("tous");
    }
    setShowFiltres(false);
  };

  const resetFiltres = () => {
    setDraftFiltres(FILTRES_TERRAIN_DEFAUT);
    setAppliedFiltres(FILTRES_TERRAIN_DEFAUT);
    setQuickFiltre("tous");
  };

  const onQuickSelect = (id: QuickFiltre) => {
    setQuickFiltre(id);
    if (id === "demain") {
      const demain = getTomorrowISO();
      setDraftFiltres((f) => ({ ...f, date: demain, type: "" }));
      setAppliedFiltres((f) => ({ ...f, date: demain, type: "" }));
    } else {
      setDraftFiltres((f) => ({ ...f, date: "", type: "" }));
      setAppliedFiltres((f) => ({ ...f, date: "", type: "" }));
    }
  };

  const emptyMessage = (() => {
    if (quickFiltre === "pres") {
      return geo.denied
        ? "Active la localisation pour voir les terrains près de toi."
        : "Aucun terrain à moins de 3 km pour le moment.";
    }
    if (quickFiltre === "demain") return "Aucun créneau libre demain. Essaie ce week-end ou tous les terrains.";
    if (quickFiltre === "weekend") return "Aucun créneau libre ce week-end.";
    if (FORMAT_FILTRES.includes(quickFiltre)) return `Aucun terrain ${quickFiltre} trouvé.`;
    return "Essaie d'autres filtres ou un quartier différent.";
  })();

  if (!geo.ready || (loading && terrains.length === 0 && !error)) {
    return <SkeletonAccueil />;
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] pb-8 page-enter">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <BannerVideoHeader
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onFilterClick={() => {
            setDraftFiltres(appliedFiltres);
            setShowFiltres(true);
          }}
          activeFilterCount={activeFilterCount}
        />

        {geo.denied && (
          <div className="mt-2">
            <div className="flex items-center gap-2 px-3 h-9 bg-[var(--surface)] border border-[var(--border)] rounded-2xl max-w-md">
              <MapPin className="w-3.5 h-3.5 text-[var(--primary)] flex-shrink-0" />
              <input
                type="text"
                placeholder="Filtrer par quartier..."
                value={draftFiltres.quartier}
                onChange={(e) => {
                  const quartier = e.target.value;
                  setDraftFiltres((f) => ({ ...f, quartier }));
                  setAppliedFiltres((f) => ({ ...f, quartier }));
                }}
                className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                id="filter-quartier"
              />
            </div>
          </div>
        )}

        {/* Drawer filtres avancés */}
        <Sheet open={showFiltres} onOpenChange={setShowFiltres}>
          <SheetContent
            side="bottom"
            className="max-h-[85vh] overflow-y-auto rounded-t-2xl bg-[var(--bg)] border-[var(--border)] sm:max-w-lg sm:mx-auto"
          >
            <SheetHeader className="text-left mb-2">
              <SheetTitle className="text-[var(--text-primary)]">Filtres</SheetTitle>
              <SheetDescription className="text-[var(--text-muted)]">
                Affiner par date, heure, prix et distance
              </SheetDescription>
            </SheetHeader>
            <FiltresTerrain
              value={draftFiltres}
              onChange={setDraftFiltres}
              onApply={applyFiltres}
              onReset={resetFiltres}
              geoAccordee={!geo.denied && geo.lat != null}
              quartiers={quartiers}
            />
          </SheetContent>
        </Sheet>

        {/* Raccourcis date / features */}
        <div
          className="mt-4 -mx-4 flex gap-2 overflow-x-auto scrollbar-none pl-4 pr-8 sm:-mx-6 sm:pl-6 sm:pr-10 lg:mx-0 lg:px-0"
          role="tablist"
          aria-label="Filtres rapides"
        >
          {QUICK_FILTRES.map((f) => {
            const active = quickFiltre === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onQuickSelect(f.id)}
                className={`min-h-[32px] flex-shrink-0 rounded-full px-3.5 text-[13px] font-semibold transition-colors ${
                  active
                    ? "bg-[var(--primary)] text-white"
                    : "bg-[var(--surface-2)]/80 text-[var(--text-primary)] border border-[var(--border)]"
                }`}
              >
                {f.label}
              </button>
            );
          })}
          <span className="w-2 shrink-0 lg:hidden" aria-hidden />
        </div>

        {error ? (
          <div className="mt-8 text-center">
            <div className="text-red-400 text-sm mb-4">{error}</div>
            <button
              type="button"
              onClick={loadTerrains}
              className="px-6 py-2.5 rounded-xl bg-[var(--primary)] text-white font-bold text-sm active:scale-95 transition-transform"
            >
              Réessayer
            </button>
          </div>
        ) : (
          <section className="mt-3">
            {loading ? (
              <div className="flex flex-col gap-3 w-[94%] mx-auto max-w-2xl">
                {[1, 2, 3].map((i) => (
                  <SkeletonTerrainCard key={i} />
                ))}
              </div>
            ) : terrainsFiltres.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 rounded-full bg-[var(--surface-2)] flex items-center justify-center mb-3">
                  <span className="text-3xl">⚽</span>
                </div>
                <h3 className="text-[var(--text-primary)] font-bold text-base">Aucun terrain trouvé</h3>
                <p className="text-[var(--text-muted)] text-sm mt-1.5 max-w-xs">{emptyMessage}</p>
                <button
                  type="button"
                  onClick={resetFiltres}
                  className="mt-5 px-5 py-2 rounded-xl border border-[var(--primary)] text-[var(--primary)] text-sm font-semibold active:scale-95 transition-transform min-h-[40px]"
                >
                  Réinitialiser
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 w-[94%] mx-auto max-w-2xl lg:max-w-3xl">
                {terrainsFiltres.map((t) => (
                  <PitchCard
                    key={t.id}
                    pitch={t}
                    dateLabel={dateLabel}
                    onFavoriteChange={() => setFavTick((n) => n + 1)}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
};

export default Accueil;
