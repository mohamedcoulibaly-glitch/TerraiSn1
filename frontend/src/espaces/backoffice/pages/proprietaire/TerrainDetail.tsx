import { ArrowLeft, MapPin, User } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { employesApi, proprietaireApi, terrainsApi } from "@/lib/api";
import { gerantNomComplet, proprioTerrainPhoto } from "@/espaces/backoffice/proprietaire/proprioUtils";

const TABS = ["Vue d'ensemble", "Gérant", "Tarifs"] as const;

const OwnerTerrainDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [terrain, setTerrain] = useState<any>(null);
  const [employes, setEmployes] = useState<any[]>([]);
  const [tarifs, setTarifs] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Vue d'ensemble");

  useEffect(() => {
    let mounted = true;
    Promise.all([
      terrainsApi.get(id!),
      employesApi.list().catch(() => []),
      proprietaireApi.getTarifs(id!).catch(() => null),
    ])
      .then(([terrainData, employesData, tarifsData]) => {
        if (!mounted) return;
        setTerrain(terrainData);
        setEmployes((Array.isArray(employesData) ? employesData : []).filter((e: any) => String(e.terrain_id) === String(id)));
        setTarifs(tarifsData);
      })
      .catch(() => {
        if (mounted) navigate("/backoffice/proprietaire/terrains");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="py-16 text-center text-sm" style={{ color: "var(--p-muted)" }}>
        Chargement...
      </div>
    );
  }

  if (!terrain) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm" style={{ color: "var(--p-muted)" }}>Terrain non trouvé</p>
        <button
          type="button"
          onClick={() => navigate("/backoffice/proprietaire/terrains")}
          className="mt-4 min-h-[44px] px-4 rounded-full text-sm font-semibold"
          style={{ background: "var(--p-primary)", color: "#fff" }}
        >
          Retour aux terrains
        </button>
      </div>
    );
  }

  const active = terrain.is_active === 1 || terrain.is_active === true || terrain.is_active === "1";
  const prixEntier = Number(tarifs?.prix_entier_base || terrain.prix_entier || terrain.prix_heure || 0);
  const prixMoitie = Number(tarifs?.prix_moitie_base || terrain.prix_moitie || Math.round(prixEntier * 0.6));

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div
        className="rounded-xl px-3.5 py-3 text-[13px]"
        style={{ background: "var(--p-primary-glow)", color: "var(--p-text-2)" }}
      >
        Cette vue est en lecture seule. Pour modifier le terrain, contacte l'administration.
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/backoffice/proprietaire/terrains")}
          className="w-10 h-10 rounded-full inline-flex items-center justify-center"
          style={{ background: "var(--p-surface-2)" }}
          aria-label="Retour"
        >
          <ArrowLeft className="w-5 h-5" style={{ color: "var(--p-text)" }} />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold truncate" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
            {terrain.nom}
          </h1>
          <p className="text-xs inline-flex items-center gap-1" style={{ color: "var(--p-muted)" }}>
            <MapPin className="w-3 h-3" />
            {terrain.ville || terrain.adresse || "—"}
          </p>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-2xl p-1" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
        {TABS.map((tab) => {
          const on = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="flex-1 min-h-[44px] px-3 rounded-xl text-xs font-medium"
              style={{
                background: on ? "var(--p-primary)" : "transparent",
                color: on ? "#fff" : "var(--p-muted)",
              }}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {activeTab === "Vue d'ensemble" && (
        <div className="space-y-3">
          <img src={proprioTerrainPhoto(terrain)} alt="" className="w-full h-48 object-cover rounded-2xl" />
          <div className="rounded-2xl p-4 grid grid-cols-2 gap-3" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
            <div>
              <p className="text-[11px]" style={{ color: "var(--p-muted)" }}>Type</p>
              <p className="text-sm font-medium" style={{ color: "var(--p-text)" }}>{terrain.type || "—"}</p>
            </div>
            <div>
              <p className="text-[11px]" style={{ color: "var(--p-muted)" }}>Ville</p>
              <p className="text-sm font-medium" style={{ color: "var(--p-text)" }}>{terrain.ville || "—"}</p>
            </div>
            <div>
              <p className="text-[11px]" style={{ color: "var(--p-muted)" }}>Statut</p>
              <p className="text-sm font-medium" style={{ color: active ? "var(--p-optimal)" : "var(--p-muted)" }}>
                {active ? "Ouvert" : "Fermé"}
              </p>
            </div>
            <div>
              <p className="text-[11px]" style={{ color: "var(--p-muted)" }}>Adresse</p>
              <p className="text-sm font-medium" style={{ color: "var(--p-text)" }}>{terrain.adresse || "—"}</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === "Gérant" && (
        <div className="space-y-2">
          {employes.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: "var(--p-muted)" }}>Aucun gérant assigné</p>
          ) : (
            employes.map((e) => (
              <div key={e.id} className="rounded-2xl p-3 flex items-center gap-3" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
                <span className="w-10 h-10 rounded-full inline-flex items-center justify-center" style={{ background: "var(--p-primary-glow)" }}>
                  <User className="w-5 h-5" style={{ color: "var(--p-primary)" }} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold" style={{ color: "var(--p-text)" }}>{gerantNomComplet(e) || e.nom}</p>
                  <p className="text-xs" style={{ color: "var(--p-muted)" }}>{e.telephone || e.email}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "Tarifs" && (
        <div className="rounded-2xl p-4 space-y-2" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
          <p className="text-sm" style={{ color: "var(--p-text-2)" }}>
            Entier : <span className="font-semibold" style={{ color: "var(--p-text)" }}>{prixEntier.toLocaleString("fr-FR")} FCFA / h</span>
          </p>
          <p className="text-sm" style={{ color: "var(--p-text-2)" }}>
            Demi : <span className="font-semibold" style={{ color: "var(--p-text)" }}>{prixMoitie.toLocaleString("fr-FR")} FCFA / h</span>
          </p>
        </div>
      )}
    </div>
  );
};

export default OwnerTerrainDetail;
