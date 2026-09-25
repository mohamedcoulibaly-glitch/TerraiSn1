import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi, type TerrainPhoto } from "@/services/superAdminApi";
import { useAuth } from "@/hooks/use-auth";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import GrilleTarifaireAdmin from "@/espaces/backoffice/components/GrilleTarifaireAdmin";
import FormatsTerrainEditor from "@/espaces/backoffice/components/superadmin/FormatsTerrainEditor";
import ContratPaiementTab from "@/espaces/backoffice/components/superadmin/ContratPaiementTab";
import EssaiGratuitSection from "@/espaces/backoffice/components/superadmin/EssaiGratuitSection";
import FeatureFlag, { type TerrainFeature } from "@/espaces/backoffice/components/superadmin/FeatureFlag";
import PhotoUploadTerrain from "@/espaces/backoffice/components/superadmin/PhotoUploadTerrain";
import LocalisationTerrain from "@/espaces/backoffice/components/superadmin/LocalisationTerrain";
import TerrainCommoditesEditor, { type CommoditeToggle } from "@/espaces/backoffice/components/superadmin/TerrainCommoditesEditor";
import AuditTables, { type AuditCommoditeRow, type AuditPhotoRow } from "@/espaces/backoffice/components/superadmin/AuditTables";
import GerantsTerrainTab from "@/espaces/backoffice/components/superadmin/GerantsTerrainTab";
import {
  gerantDuTerrain,
  getContratOverlay,
  terrainStatutListe,
  type ContratOverlay,
} from "@/lib/saContrat";

const TABS = [
  { id: "infos", label: "Informations" },
  { id: "localisation", label: "Localisation" },
  { id: "contrat", label: "Contrat paiement" },
  { id: "features", label: "Fonctionnalités" },
  { id: "formats", label: "Formats & prix" },
  { id: "tarifs", label: "Grille horaires" },
  { id: "gerants", label: "Gérants" },
  { id: "audit", label: "Audit" },
  { id: "historique", label: "Historique" },
] as const;

function toCoord(value: unknown): number | null {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default function TerrainFiche() {
  const { id } = useParams();
  const terrainId = Number(id);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = (
    tabParam === "users" ? "gerants" : (tabParam as (typeof TABS)[number]["id"]) || "contrat"
  );
  const navigate = useNavigate();
  const { user } = useAuth();
  const [terrain, setTerrain] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [contrat, setContrat] = useState<ContratOverlay>(getContratOverlay(terrainId));
  const [toggling, setToggling] = useState(false);
  const [photos, setPhotos] = useState<TerrainPhoto[]>([]);
  const [adresseTheorique, setAdresseTheorique] = useState("");
  const [adresseNominatim, setAdresseNominatim] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [erreurLoc, setErreurLoc] = useState<string | undefined>();
  const [savingLoc, setSavingLoc] = useState(false);
  const [catalogCommodites, setCatalogCommodites] = useState<CommoditeToggle[]>([]);
  const [selectedCommodites, setSelectedCommodites] = useState<number[]>([]);
  const [savingCommodites, setSavingCommodites] = useState(false);
  const [auditPhotos, setAuditPhotos] = useState<AuditPhotoRow[]>([]);
  const [auditCommodites, setAuditCommodites] = useState<AuditCommoditeRow[]>([]);
  const [features, setFeatures] = useState<TerrainFeature[]>([]);

  useSaCrumbs([
    { label: "Terrains", to: "/backoffice/superadmin/terrains" },
    { label: terrain?.nom || "Terrain" },
  ]);

  const load = () =>
    Promise.all([
      superAdminApi.terrains(),
      superAdminApi.users(),
      superAdminApi.terrainPhotos(terrainId).catch(() => []),
      superAdminApi.terrainCommodites(terrainId).catch(() => []),
    ]).then(([t, u, p, commodites]) => {
      const list = Array.isArray(t) ? t : [];
      const found = list.find((x: any) => Number(x.id) === terrainId) || null;
      setTerrain(found);
      setUsers(Array.isArray(u) ? u : []);
      setContrat(getContratOverlay(terrainId));
      setPhotos(Array.isArray(p) ? p : []);
      const commoditesList = Array.isArray(commodites) ? commodites : [];
      setCatalogCommodites(commoditesList);
      setSelectedCommodites(
        commoditesList.filter((c: CommoditeToggle) => c.associee).map((c: CommoditeToggle) => Number(c.id)),
      );
      if (found) {
        setAdresseTheorique(found.adresse_theorique || "");
        setAdresseNominatim(found.adresse_nominatim || "");
        setLatitude(toCoord(found.latitude));
        setLongitude(toCoord(found.longitude));
      }
    });

  useEffect(() => {
    load().catch(console.error);
  }, [terrainId]);

  useEffect(() => {
    if (tab !== "features") return;
    superAdminApi
      .terrainFeatures(terrainId)
      .then((rows) => setFeatures(Array.isArray(rows) ? rows : []))
      .catch(() => toast.error("Impossible de charger les fonctionnalités"));
  }, [tab, terrainId]);

  useEffect(() => {
    if (tab !== "audit") return;
    superAdminApi
      .terrainAudit(terrainId)
      .then((data) => {
        setAuditPhotos(Array.isArray(data?.photos) ? data.photos : []);
        setAuditCommodites(Array.isArray(data?.commodites) ? data.commodites : []);
      })
      .catch(() => toast.error("Impossible de charger l'audit"));
  }, [tab, terrainId]);

  const locComplete = Boolean(adresseTheorique.trim() && latitude != null && longitude != null);

  const locDirty = useMemo(() => {
    if (!terrain) return false;
    return (
      (adresseTheorique || "") !== (terrain.adresse_theorique || "") ||
      (adresseNominatim || "") !== (terrain.adresse_nominatim || "") ||
      toCoord(latitude) !== toCoord(terrain.latitude) ||
      toCoord(longitude) !== toCoord(terrain.longitude)
    );
  }, [terrain, adresseTheorique, adresseNominatim, latitude, longitude]);

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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible de changer le statut");
    } finally {
      setToggling(false);
    }
  }

  async function saveCommodites() {
    setSavingCommodites(true);
    try {
      await superAdminApi.saveTerrainCommodites(terrainId, selectedCommodites);
      toast.success("Commodités enregistrées");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible d'enregistrer les commodités");
    } finally {
      setSavingCommodites(false);
    }
  }

  async function saveLocalisation() {
    if (!adresseTheorique.trim() || latitude == null || longitude == null) {
      setErreurLoc(
        !adresseTheorique.trim()
          ? "L'adresse pour les joueurs est obligatoire"
          : "Veuillez définir la position exacte du terrain sur la carte",
      );
      document.getElementById("sa-localisation-terrain")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setErreurLoc(undefined);
    setSavingLoc(true);
    try {
      const updated = await superAdminApi.updateLocalisation(terrain.id, {
        adresse_theorique: adresseTheorique.trim(),
        adresse_nominatim: adresseNominatim,
        latitude,
        longitude,
      });
      setTerrain((prev: any) => ({ ...prev, ...updated }));
      toast.success("Localisation enregistrée");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSavingLoc(false);
    }
  }

  return (
    <div className="space-y-5 max-w-[960px]">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--sa-text)" }}>
            {terrain.nom}
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--sa-muted)" }}>
            {terrain.adresse_theorique || terrain.adresse || terrain.quartier || "—"} {terrain.ville ? `· ${terrain.ville}` : ""}
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
        <>
          <EssaiGratuitSection terrainId={terrainId} nom={terrain.nom} />
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
        </>
      ) : null}

      {tab === "features" ? (
        <FeatureFlag terrainId={terrainId} features={features} onSaved={setFeatures} />
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
              <dd className="font-medium flex flex-wrap items-center gap-2">
                <span>{gerant?.nom || "Non assigné"}</span>
                <button
                  type="button"
                  className="text-[12px] font-semibold underline"
                  style={{ color: "var(--sa-primary)" }}
                  onClick={() => setSearchParams({ tab: "gerants" })}
                >
                  Gérer les gérants →
                </button>
              </dd>
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
          <PhotoUploadTerrain terrainId={terrain.id} photos={photos} onPhotosChange={setPhotos} />
          <div className="pt-4">
            <TerrainCommoditesEditor
              embedded
              items={catalogCommodites}
              selectedIds={selectedCommodites}
              onChange={setSelectedCommodites}
              onSave={() => void saveCommodites()}
              saving={savingCommodites}
            />
          </div>
        </section>
      ) : null}

      {tab === "localisation" ? (
        <div className="space-y-3">
          <LocalisationTerrain
            adresseTheorique={adresseTheorique}
            adresseNominatim={adresseNominatim}
            latitude={latitude}
            longitude={longitude}
            onChangeAdresseTheorique={(v) => {
              setAdresseTheorique(v);
              if (erreurLoc) setErreurLoc(undefined);
            }}
            onChangeCoordonnees={(lat, lng, nominatim) => {
              setLatitude(lat);
              setLongitude(lng);
              setAdresseNominatim(nominatim);
              if (erreurLoc) setErreurLoc(undefined);
            }}
            erreur={erreurLoc}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={savingLoc || !locDirty}
              onClick={() => void saveLocalisation()}
              className="min-h-[44px] px-5 rounded-lg text-[13px] font-semibold text-white inline-flex items-center gap-2"
              style={{ background: "var(--sa-primary)", opacity: savingLoc || !locDirty ? 0.6 : 1 }}
            >
              {savingLoc ? <Loader2 size={14} className="animate-spin" /> : null}
              Enregistrer la localisation
            </button>
            <p className="text-[12px]" style={{ color: locComplete ? "var(--sa-success)" : "var(--sa-danger)" }}>
              {locComplete ? "Adresse + coordonnées ✓" : "Adresse + coordonnées ✗"}
            </p>
          </div>
        </div>
      ) : null}

      {tab === "formats" ? <FormatsTerrainEditor terrainId={terrain.id} /> : null}

      {tab === "tarifs" ? (
        <GrilleTarifaireAdmin terrainId={terrain.id} terrainNom={terrain.nom} onClose={() => navigate(`/backoffice/superadmin/terrains/${terrain.id}?tab=contrat`)} />
      ) : null}

      {tab === "gerants" ? (
        <GerantsTerrainTab terrainId={terrainId} terrainNom={terrain.nom || "Terrain"} />
      ) : null}

      {tab === "audit" ? (
        <AuditTables photos={auditPhotos} commodites={auditCommodites} />
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
