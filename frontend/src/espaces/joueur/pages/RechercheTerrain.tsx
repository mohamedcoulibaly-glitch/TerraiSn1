import { Search, SlidersHorizontal, ArrowLeft } from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { terrainsApi } from "@/lib/api";
import FieldCard from "@/espaces/joueur/components/FieldCard";

const villes = ["Toutes", "Dakar", "Thiès", "Saint-Louis"];
const types = ["Tous", "5 vs 5", "7 vs 7", "11 vs 11"];
const prixRanges = ["Tous les prix", "< 4 000 CFA", "4 000 - 6 000 CFA", "> 6 000 CFA"];

const Explorer = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [ville, setVille] = useState("Toutes");
  const [type, setType] = useState("Tous");
  const [prix, setPrix] = useState("Tous les prix");
  const [showFilters, setShowFilters] = useState(false);
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
      setError("Erreur lors du chargement des terrains. Veuillez vérifier votre connexion.");
      setTerrains([]);
    } finally {
      setLoading(false);
    }
  };

  const filtered = terrains.filter((t) => {
    const matchVille = ville === "Toutes" || t.ville === ville;
    const matchType = type === "Tous" || t.type === type;
    const matchSearch = t.nom.toLowerCase().includes(search.toLowerCase()) || (t.adresse || '').toLowerCase().includes(search.toLowerCase());
    const matchPrix = prix === "Tous les prix" ||
      (prix === "< 4 000 CFA" && t.prix_heure < 4000) ||
      (prix === "4 000 - 6 000 CFA" && t.prix_heure >= 4000 && t.prix_heure <= 6000) ||
      (prix === "> 6 000 CFA" && t.prix_heure > 6000);
    return matchVille && matchType && matchSearch && matchPrix;
  });

  return (
    <div className="page-container">
      <div className="flex items-center gap-3 responsive-padding py-4">
        <button onClick={() => navigate("/")} className="bg-muted rounded-full p-2">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-display font-bold text-lg sm:text-xl">Explorer les terrains</h1>
      </div>

      <div className="responsive-padding">
        <div className="glass-card flex items-center gap-3 px-4 py-3 max-w-2xl">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Rechercher un terrain..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            id="explorer-search"
          />
          <button onClick={() => setShowFilters(!showFilters)}>
            <SlidersHorizontal className={`w-4 h-4 transition-colors ${showFilters ? "text-primary" : "text-muted-foreground"}`} />
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="responsive-padding mt-3 animate-fade-in">
          <div className="glass-card p-4 max-w-2xl space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Ville</p>
              <div className="flex gap-2 flex-wrap">
                {villes.map((v) => (
                  <button key={v} onClick={() => setVille(v)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${ville === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Type de terrain</p>
              <div className="flex gap-2 flex-wrap">
                {types.map((t) => (
                  <button key={t} onClick={() => setType(t)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${type === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Prix par heure</p>
              <div className="flex gap-2 flex-wrap">
                {prixRanges.map((p) => (
                  <button key={p} onClick={() => setPrix(p)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${prix === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="responsive-padding mt-4">
        {loading ? (
          <div className="text-center py-10 text-muted-foreground text-sm animate-pulse">Chargement...</div>
        ) : error ? (
          <div className="text-center py-6">
            <p className="text-destructive text-sm mb-4">{error}</p>
            <button onClick={loadTerrains} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium">
              Réessayer
            </button>
          </div>
        ) : terrains.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">
            Aucun terrain disponible.
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">
            Aucun terrain ne correspond à vos critères de recherche.
          </div>
        ) : (
          <>
            <p className="text-xs sm:text-sm text-muted-foreground mb-3">{filtered.length} terrain(s) trouvé(s)</p>
            <div className="flex flex-col sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filtered.map((t) => (
                <FieldCard key={t.id} terrain={t} variant="horizontal" className="sm:flex-col" />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Explorer;
