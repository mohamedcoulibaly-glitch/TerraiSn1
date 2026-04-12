import { Search, MapPin, SlidersHorizontal, ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import heroField from "@/assets/hero-field.jpg";
import { terrainsApi } from "@/lib/api";
import FieldCard from "@/components/FieldCard";
import AdminButton from "@/components/AdminButton";

const typeFilters = ["Tous", "5 vs 5", "7 vs 7", "11 vs 11"];

const Index = () => {
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
      setError("Une erreur est survenue lors du chargement des terrains. Veuillez rafraîchir la page.");
      setTerrains([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = terrains.filter((t) => {
    const matchType = selectedType === "Tous" || t.type === selectedType;
    const matchSearch = t.nom.toLowerCase().includes(searchQuery.toLowerCase()) || t.ville.toLowerCase().includes(searchQuery.toLowerCase());
    return matchType && matchSearch;
  });

  const popular = terrains.filter((t) => t.note >= 4.5).slice(0, 6);

  return (
    <div className="page-container">
      <AdminButton />

      {/* Hero */}
      <div className="relative h-56 sm:h-72 lg:h-80 overflow-hidden">
        <img src={heroField} alt="Terrain de sport au Sénégal" className="w-full h-full object-cover" width={800} height={512} />
        <div className="absolute inset-0 bg-gradient-to-b from-foreground/60 to-foreground/20" />
        <div className="absolute inset-0 flex flex-col justify-end p-5 sm:p-8 lg:p-12">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-4 h-4 text-primary-foreground/80" />
            <span className="text-primary-foreground/80 text-xs sm:text-sm font-medium">Dakar, SN</span>
            <span className="ml-auto text-primary-foreground/60 text-xs sm:text-sm font-display font-bold">TerrainSN</span>
          </div>
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl lg:text-4xl text-primary-foreground leading-tight">
            Réserve ton terrain<br />
            <span className="text-secondary">en un clic.</span>
          </h1>
        </div>
      </div>

      {/* Search */}
      <div className="responsive-padding -mt-5 relative z-10">
        <div className="glass-card flex items-center gap-3 px-4 py-3 max-w-2xl">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            type="text"
            placeholder="Rechercher un terrain, une ville..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            id="search-terrain"
          />
          <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>

      {/* Type filters */}
      <div className="flex gap-2 responsive-padding mt-4 overflow-x-auto scrollbar-hide">
        {typeFilters.map((type) => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            className={`px-4 py-2 rounded-full text-xs sm:text-sm font-medium transition-colors flex-shrink-0 ${
              selectedType === type ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="responsive-padding mt-10 text-center text-muted-foreground">
          <div className="animate-pulse">Chargement des terrains...</div>
        </div>
      ) : error ? (
        <div className="responsive-padding mt-10 text-center">
          <div className="text-destructive text-sm mb-4">{error}</div>
          <button onClick={loadTerrains} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium">
            Réessayer
          </button>
        </div>
      ) : terrains.length === 0 ? (
        <div className="responsive-padding mt-10 text-center text-muted-foreground">
          <p className="text-sm">Aucun terrain disponible pour le moment.</p>
        </div>
      ) : (
        <>
          {/* Popular terrains */}
          {popular.length > 0 && (
            <section className="mt-6 responsive-padding">
              <div className="flex items-center justify-between mb-3">
                <h2 className="section-title">⚡ Terrains populaires</h2>
                <button onClick={() => navigate("/explorer")} className="text-xs sm:text-sm text-primary font-medium flex items-center gap-1">
                  Voir tout <ChevronRight className="w-3 h-3" />
                </button>
              </div>
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 lg:grid lg:grid-cols-3 xl:grid-cols-4 lg:overflow-visible">
                {popular.map((t) => (
                  <FieldCard key={t.id} terrain={t} variant="vertical" />
                ))}
              </div>
            </section>
          )}

          {/* Nearby */}
          <section className="mt-6 responsive-padding">
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-title">📍 Près de chez vous</h2>
              <button onClick={() => navigate("/explorer")} className="text-xs sm:text-sm text-primary font-medium flex items-center gap-1">
                Voir tout <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            {filtered.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-6">Aucun terrain ne correspond à votre recherche.</div>
            ) : (
              <div className="flex flex-col sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filtered.map((t) => (
                  <FieldCard key={t.id} terrain={t} variant="horizontal" />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Footer */}
      <footer className="mt-10 responsive-padding pb-6 text-center">
        <p className="font-display font-bold text-primary text-sm sm:text-base">⚽ TerrainSN</p>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          La plateforme de réservation de terrains de sport au Sénégal.
        </p>
        <div className="flex justify-center gap-6 mt-3 text-xs sm:text-sm text-muted-foreground">
          <span className="cursor-pointer hover:text-foreground transition-colors">Aide</span>
          <span className="cursor-pointer hover:text-foreground transition-colors">Conditions</span>
          <span className="cursor-pointer hover:text-foreground transition-colors">Contact</span>
        </div>
      </footer>
    </div>
  );
};

export default Index;
