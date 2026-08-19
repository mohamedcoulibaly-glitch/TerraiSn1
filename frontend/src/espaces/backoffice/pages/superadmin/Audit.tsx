import { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import AuditTables, {
  downloadAuditCsv,
  unifyAuditRows,
  type AuditCommoditeRow,
  type AuditPhotoRow,
} from "@/espaces/backoffice/components/superadmin/AuditTables";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";
import SaButton from "@/espaces/backoffice/components/superadmin/ui/SaButton";
import Select2 from "@/components/Select2";

export default function AuditPage() {
  useSaCrumbs([{ label: "Audit photos & commodités", to: "/backoffice/superadmin/audit" }]);
  const [photos, setPhotos] = useState<AuditPhotoRow[]>([]);
  const [commodites, setCommodites] = useState<AuditCommoditeRow[]>([]);
  const [terrains, setTerrains] = useState<{ id: number; nom: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState("tout");
  const [terrainId, setTerrainId] = useState("");
  const [role, setRole] = useState("");
  const [depuis, setDepuis] = useState("");
  const [jusqua, setJusqua] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await superAdminApi.auditGlobal({
        type,
        terrain_id: terrainId || undefined,
        role: role || undefined,
        depuis: depuis || undefined,
        jusqua: jusqua || undefined,
        limit: 200,
      });
      setPhotos(Array.isArray(data?.photos) ? data.photos : []);
      setCommodites(Array.isArray(data?.commodites) ? data.commodites : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible de charger l'audit");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    superAdminApi.terrains().then((list) => setTerrains(list || [])).catch(() => {});
  }, []);

  useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, terrainId, role, depuis, jusqua]);

  const rows = useMemo(() => unifyAuditRows(photos, commodites), [photos, commodites]);

  const inputStyle = { border: "1px solid var(--sa-border)", background: "var(--sa-surface)", color: "var(--sa-text)" };

  return (
    <div className="space-y-5 max-w-[1200px]">
      <SaPageHeader
        titre="Audit photos & commodités"
        sousTitre="Historique des uploads, suppressions et changements d'équipements."
        actions={
          <SaButton variant="secondary" icon={<Download size={14} />} onClick={() => downloadAuditCsv(`audit-photos-commodites.csv`, rows)}>
            Exporter CSV
          </SaButton>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Select2
          value={type}
          onChange={setType}
          options={[
            { value: "tout", label: "Tout" },
            { value: "photos", label: "Photos" },
            { value: "commodites", label: "Commodités" },
          ]}
        />
        <Select2
          value={terrainId}
          onChange={setTerrainId}
          options={[
            { value: "", label: "Tous les terrains" },
            ...terrains.map((t) => ({ value: String(t.id), label: t.nom })),
          ]}
        />
        <Select2
          value={role}
          onChange={setRole}
          options={[
            { value: "", label: "Tous les rôles" },
            { value: "super_admin", label: "Super Admin" },
            { value: "gerant", label: "Gérant" },
          ]}
        />
        <input type="date" className="h-11 rounded-lg px-3 text-sm" style={inputStyle} value={depuis} onChange={(e) => setDepuis(e.target.value)} />
        <input type="date" className="h-11 rounded-lg px-3 text-sm" style={inputStyle} value={jusqua} onChange={(e) => setJusqua(e.target.value)} />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--sa-muted)" }}>
          <Loader2 size={16} className="animate-spin" /> Chargement…
        </div>
      ) : (
        <AuditTables photos={photos} commodites={commodites} showTerrain />
      )}
    </div>
  );
}
