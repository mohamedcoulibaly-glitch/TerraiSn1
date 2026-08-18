import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi } from "@/services/superAdminApi";
import { useAuth } from "@/hooks/use-auth";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import GrilleTarifaireAdmin from "@/espaces/backoffice/components/GrilleTarifaireAdmin";
import ContratPaiementTab from "@/espaces/backoffice/components/superadmin/ContratPaiementTab";
import {
  gerantDuTerrain,
  getContratOverlay,
  terrainStatutListe,
  type ContratOverlay,
} from "@/lib/saContrat";

const TABS = [
  { id: "infos", label: "Informations" },
  { id: "contrat", label: "Contrat paiement" },
  { id: "tarifs", label: "Tarifs" },
  { id: "users", label: "Utilisateurs" },
  { id: "historique", label: "Historique" },
] as const;

export default function TerrainFiche() {
  const { id } = useParams();
  const terrainId = Number(id);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") as (typeof TABS)[number]["id"]) || "contrat";
  const navigate = useNavigate();
  const { user } = useAuth();
  const [terrain, setTerrain] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [contrat, setContrat] = useState<ContratOverlay>(getContratOverlay(terrainId));
  const [toggling, setToggling] = useState(false);
  const [uploading, setUploading] = useState(false);

  useSaCrumbs([
    { label: "Terrains", to: "/backoffice/superadmin/terrains" },
    { label: terrain?.nom || "Terrain" },
  ]);

  const load = () =>
    Promise.all([superAdminApi.terrains(), superAdminApi.users()]).then(([t, u]) => {
      setTerrain(t.find((x: any) => Number(x.id) === terrainId) || null);
      setUsers(u);
      setContrat(getContratOverlay(terrainId));
    });

  useEffect(() => {
    load().catch(console.error);
  }, [terrainId]);

  if (!terrain) {
    return <p className="text-sm" style={{ color: "var(--sa-muted)" }}>Chargement…</p>;
  }

  const gerant = gerantDuTerrain(users, terrainId);
  const proprio = users.find((u: any) => u.role === "proprietaire" && Number(u.id) === Number(terrain.proprietaire_id));
  const statut = terrainStatutListe(terrain, contrat);
  const st =
    statut === "actif"
      ? { label: "Actif", color: "var(--sa-success)", bg: "var(--sa-success-bg)" }
      : statut === "suspendu"
        ? { label: "Suspendu", color: "var(--sa-danger)", bg: "var(--sa-danger-bg)" }
        : { label: "En attente", color: "var(--sa-warning)", bg: "var(--sa-warning-bg)" };

  async function toggleStatut() {
    setToggling(true);
    try {
      await superAdminApi.terrainStatus(terrain.id, terrain.is_active ? "suspendu" : "actif");
      await load();
    } finally {
      setToggling(false);
    }
  }

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  return (
    <div className="space-y-5 max-w-[960px]">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--sa-text)" }}>
            {terrain.nom}
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--sa-muted)" }}>
            {terrain.adresse || terrain.quartier || "—"} {terrain.ville ? `· ${terrain.ville}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: st.bg, color: st.color }}>
            {st.label}
          </span>
          {terrain.is_active ? (
            <button type="button" disabled={toggling} onClick={toggleStatut} className="h-10 px-3 rounded-lg text-[12px] font-semibold" style={{ color: "var(--sa-danger)", border: "1px solid var(--sa-danger)" }}>
              Suspendre
            </button>
          ) : (
            <button type="button" disabled={toggling} onClick={toggleStatut} className="h-10 px-3 rounded-lg text-[12px] font-semibold text-white" style={{ background: "var(--sa-success)" }}>
              Activer
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto scrollbar-hide" style={{ borderBottom: "1px solid var(--sa-border)" }}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSearchParams({ tab: t.id })}
              className="px-3 py-2.5 text-[13px] font-medium shrink-0"
              style={{
                color: active ? "var(--sa-primary)" : "var(--sa-muted)",
                borderBottom: active ? "2px solid var(--sa-primary)" : "2px solid transparent",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "contrat" ? (
        <ContratPaiementTab
          terrain={terrain}
          contrat={contrat}
          gerant={gerant}
          auteur={user?.nom || "Super Admin"}
          onChange={(next) => {
            setContrat(next);
            load().catch(() => {});
          }}
        />
      ) : null}

      {tab === "infos" ? (
        <section className="rounded-xl p-5 space-y-3" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
            <div>
              <dt style={{ color: "var(--sa-muted)" }}>Propriétaire</dt>
              <dd className="font-medium">{terrain.proprietaire_nom || proprio?.nom || "—"}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--sa-muted)" }}>Gérant</dt>
              <dd className="font-medium">{gerant?.nom || "Non assigné"}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--sa-muted)" }}>Taille</dt>
              <dd>{terrain.type || terrain.taille || "—"}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--sa-muted)" }}>Prix / h</dt>
              <dd>{Number(terrain.prix_heure || 0).toLocaleString("fr-FR")} FCFA</dd>
            </div>
          </dl>
          <label className="inline-flex items-center gap-2 h-10 px-3 rounded-lg text-[12px] font-semibold cursor-pointer" style={{ border: "1px solid var(--sa-border)", color: "var(--sa-primary)" }}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload size={14} />}
            Ajouter une photo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={uploading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploading(true);
                try {
                  const dataUrl = await readFileAsDataUrl(file);
                  await superAdminApi.uploadTerrainPhoto(terrain.id, { dataUrl, est_principale: true, ordre: 0 });
                  toast.success("Photo ajoutée");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Upload impossible");
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
        </section>
      ) : null}

      {tab === "tarifs" ? (
        <GrilleTarifaireAdmin terrainId={terrain.id} terrainNom={terrain.nom} onClose={() => navigate(`/backoffice/superadmin/terrains/${terrain.id}?tab=contrat`)} />
      ) : null}

      {tab === "users" ? (
        <section className="rounded-xl overflow-hidden" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
          <table className="sa-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Rôle</th>
                <th>Téléphone</th>
              </tr>
            </thead>
            <tbody>
              {users
                .filter((u) => (u.role === "gerant" && Number(u.terrain_id) === terrainId) || (u.role === "proprietaire" && Number(u.id) === Number(terrain.proprietaire_id)))
                .map((u) => (
                  <tr key={`${u.role}-${u.id}`}>
                    <td>{u.nom}</td>
                    <td>{u.role}</td>
                    <td>{u.telephone || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {tab === "historique" ? (
        <section className="rounded-xl p-5 space-y-2" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
          {(contrat.avenants || []).length === 0 ? (
            <p className="text-[13px]" style={{ color: "var(--sa-muted)" }}>Aucun avenant.</p>
          ) : (
            contrat.avenants.map((a, i) => (
              <div key={`${a.at}-${i}`} className="rounded-lg p-3 text-[12px]" style={{ background: "var(--sa-surface-2)" }}>
                <p className="font-medium">{new Date(a.at).toLocaleString("fr-FR")} · {a.par} · {a.bloc}</p>
                <p style={{ color: "var(--sa-muted)" }}>{a.avant} → {a.apres}</p>
              </div>
            ))
          )}
        </section>
      ) : null}
    </div>
  );
}
