import { Search, ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { terrainsApi } from "@/lib/api";
import FieldCard from "@/espaces/joueur/components/FieldCard";

const typeFilters = ["Tous", "5 vs 5", "7 vs 7", "11 vs 11"];

const Accueil = () => {
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState("Tous");
  const [searchQuery, setSearchQuery] = useState("");
  const [terrains, setTerrains] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTerrains();
  }, []);

  const loadTerrains = async () => {
    try {
      setError(null);
      const data = await terrainsApi.list();
      setTerrains(data || []);
    } catch (err) {
      console.error(err);
      setError("Une erreur est survenue lors du chargement des terrains.");
      setTerrains([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = terrains.filter((t) => {
    const matchType = selectedType === "Tous" || t.type === selectedType;
    const matchSearch =
      t.nom.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.ville.toLowerCase().includes(searchQuery.toLowerCase());
    return matchType && matchSearch;
  });

  const popular = terrains.filter((t) => t.note >= 4.5).slice(0, 6);

  return (
    <div className="page-container !pt-0 !pb-6">
      {/* Hero vert */}
      <section className="bg-[var(--color-primary)] px-4 pt-8 pb-10 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          <h1
            className="text-white text-[1.65rem] sm:text-3xl font-semibold tracking-tight leading-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Réserve ton terrain
          </h1>
          <p className="text-white/80 text-sm mt-2 max-w-md">
            Trouve un créneau libre à Dakar et réserve en quelques minutes.
          </p>

          <div className="mt-6 flex items-center gap-3 px-4 h-[52px] bg-white rounded-[var(--radius-xl)] shadow-[0_8px_24px_rgba(6,61,36,0.25)]">
            <Search className="w-4 h-4 text-[var(--color-text-muted)] flex-shrink-0" />
            <input
              type="text"
              placeholder="Terrain, quartier, ville…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-text-muted)] text-[var(--color-text-primary)]"
              id="search-terrain"
            />
          </div>
        </div>
      </section>

      <div className="responsive-padding -mt-4 relative z-[1]">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          {typeFilters.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setSelectedType(type)}
              className={`px-4 min-h-[40px] rounded-full text-sm font-medium transition-colors flex-shrink-0 ${
                selectedType === type
                  ? "bg-[var(--color-primary)] text-white shadow-sm"
                  : "bg-white text-[var(--color-text-secondary)] border border-[var(--color-border)]"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="responsive-padding mt-10 text-center text-[var(--color-text-secondary)]">
          <div className="animate-pulse text-sm">Chargement des terrains...</div>
        </div>
      ) : error ? (
        <div className="responsive-padding mt-10 text-center">
          <div className="text-[var(--color-danger)] text-sm mb-4">{error}</div>
          <button type="button" onClick={loadTerrains} className="btn-primary px-6">
            Réessayer
          </button>
        </div>
      ) : terrains.length === 0 ? (
        <div className="responsive-padding mt-10 text-center text-[var(--color-text-secondary)]">
          <p className="text-sm">Aucun terrain disponible pour le moment.</p>
        </div>
      ) : (
        <>
          {popular.length > 0 && (
            <section className="mt-8 responsive-padding">
              <div className="flex items-center justify-between mb-4">
                <h2 className="section-title">Populaires</h2>
                <button
                  type="button"
                  onClick={() => navigate("/explorer")}
                  className="text-sm text-[var(--color-primary)] font-medium flex items-center gap-1 min-h-[44px]"
                >
                  Voir tout <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 snap-x">
                {popular.map((t) => (
                  <div key={t.id} className="w-[78vw] max-w-[300px] flex-shrink-0 snap-start">
                    <FieldCard terrain={t} variant="vertical" />
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-8 responsive-padding">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title">Près de chez vous</h2>
              <button
                type="button"
                onClick={() => navigate("/explorer")}
                className="text-sm text-[var(--color-primary)] font-medium flex items-center gap-1 min-h-[44px]"
              >
                Voir tout <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            {filtered.length === 0 ? (
              <div className="text-center text-[var(--color-text-secondary)] text-sm py-6">
                Aucun terrain ne correspond à votre recherche.
              </div>
            ) : (
              <div className="flex flex-col gap-4 max-w-xl mx-auto sm:max-w-none sm:grid sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((t) => (
                  <FieldCard key={t.id} terrain={t} variant="vertical" />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <footer className="mt-12 responsive-padding pb-6 text-center border-t border-[var(--color-border)] pt-8">
        <p
          className="font-semibold text-[var(--color-primary)] text-sm"
          style={{ fontFamily: "var(--font-display)" }}
        >
          TerrainSN
        </p>
        <p className="text-xs text-[var(--color-text-secondary)] mt-1">
          Réservation de terrains de football au Sénégal.
        </p>
      </footer>
    </div>
  );
};

export default Accueil;
