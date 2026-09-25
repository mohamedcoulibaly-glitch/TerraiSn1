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

type PushLogRow = {
  id: number;
  created_at?: string;
  prenom?: string | null;
  nom?: string | null;
  role?: string | null;
  account_type?: string | null;
  type_notif?: string;
  corps?: string;
  statut?: string;
};

export default function AuditPage() {
  useSaCrumbs([{ label: "Audit photos & commodités", to: "/backoffice/superadmin/audit" }]);
  const [onglet, setOnglet] = useState<"photos" | "push">("photos");
  const [photos, setPhotos] = useState<AuditPhotoRow[]>([]);
  const [commodites, setCommodites] = useState<AuditCommoditeRow[]>([]);
  const [pushLogs, setPushLogs] = useState<PushLogRow[]>([]);
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
      if (onglet === "push") {
        const logs = await superAdminApi.pushLogs({
          type: type !== "tout" ? type : undefined,
          statut: role || undefined,
          depuis: depuis || undefined,
          jusqua: jusqua || undefined,
          limit: 200,
        });
        setPushLogs(Array.isArray(logs) ? logs : []);
      } else {
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
      }
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
  }, [onglet, type, terrainId, role, depuis, jusqua]);

  const rows = useMemo(() => unifyAuditRows(photos, commodites), [photos, commodites]);

  const inputStyle = { border: "1px solid var(--sa-border)", background: "var(--sa-surface)", color: "var(--sa-text)" };
  const tabStyle = (active: boolean) => ({
    background: active ? "var(--sa-primary)" : "var(--sa-surface)",
    color: active ? "#fff" : "var(--sa-text)",
    border: "1px solid var(--sa-border)",
  });

  return (
    <div className="space-y-5 max-w-[1200px]">
      <SaPageHeader
        titre="Audit"
        sousTitre="Photos, commodités et historique des notifications push."
        actions={
          onglet === "photos" ? (
            <SaButton variant="secondary" icon={<Download size={14} />} onClick={() => downloadAuditCsv(`audit-photos-commodites.csv`, rows)}>
              Exporter CSV
            </SaButton>
          ) : null
        }
      />

      <div className="flex gap-2">
        <button type="button" className="h-11 px-4 rounded-lg text-sm font-semibold" style={tabStyle(onglet === "photos")} onClick={() => setOnglet("photos")}>
          Photos & commodités
        </button>
        <button type="button" className="h-11 px-4 rounded-lg text-sm font-semibold" style={tabStyle(onglet === "push")} onClick={() => setOnglet("push")}>
          Notifications push
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {onglet === "photos" ? (
          <>
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
          </>
        ) : (
          <>
            <Select2
              value={type}
              onChange={setType}
              options={[
                { value: "tout", label: "Tous les types" },
                { value: "RESA_CONFIRMEE", label: "Résa confirmée" },
                { value: "NOUVELLE_RESA", label: "Nouvelle résa" },
                { value: "MATCH_IMMINENT", label: "Match imminent" },
                { value: "DETTE_RETARD", label: "Dette en retard" },
                { value: "SANTE_ROUGE", label: "Santé rouge" },
              ]}
            />
            <Select2
              value={role}
              onChange={setRole}
              options={[
                { value: "", label: "Tous les statuts" },
                { value: "envoye", label: "Envoyé" },
                { value: "echoue", label: "Échoué" },
                { value: "clique", label: "Cliqué" },
                { value: "ferme", label: "Fermé" },
              ]}
            />
          </>
        )}
        <input type="date" className="h-11 rounded-lg px-3 text-sm" style={inputStyle} value={depuis} onChange={(e) => setDepuis(e.target.value)} />
        <input type="date" className="h-11 rounded-lg px-3 text-sm" style={inputStyle} value={jusqua} onChange={(e) => setJusqua(e.target.value)} />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--sa-muted)" }}>
          <Loader2 size={16} className="animate-spin" /> Chargement…
        </div>
      ) : onglet === "push" ? (
        <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--sa-border)" }}>
          <table className="w-full text-sm">
            <thead style={{ background: "var(--sa-surface)", color: "var(--sa-muted)" }}>
              <tr>
                {["Date", "Utilisateur", "Rôle", "Type", "Corps", "Statut"].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pushLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center" style={{ color: "var(--sa-muted)" }}>
                    Aucune notification push enregistrée.
                  </td>
                </tr>
              ) : pushLogs.map((log) => (
                <tr key={log.id} style={{ borderTop: "1px solid var(--sa-border)", color: "var(--sa-text)" }}>
                  <td className="px-3 py-2 whitespace-nowrap">{log.created_at ? new Date(log.created_at).toLocaleString("fr-SN") : "—"}</td>
                  <td className="px-3 py-2">{[log.prenom, log.nom].filter(Boolean).join(" ") || `#${log.id}`}</td>
                  <td className="px-3 py-2">{log.role || log.account_type || "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{log.type_notif || "—"}</td>
                  <td className="px-3 py-2 max-w-[280px] truncate">{log.corps || "—"}</td>
                  <td className="px-3 py-2">{log.statut || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <AuditTables photos={photos} commodites={commodites} showTerrain />
      )}
    </div>
  );
}
