import { useMemo } from "react";
import { LucideByName } from "@/lib/lucideByName";

export type AuditPhotoRow = {
  id: number;
  created_at?: string;
  action?: string;
  detail?: string | null;
  role_fait_par?: string | null;
  fait_par_nom?: string | null;
  terrain_nom?: string | null;
  photo_url?: string | null;
  photo_nom?: string | null;
};

export type AuditCommoditeRow = {
  id: number;
  created_at?: string;
  action?: string;
  detail?: string | null;
  role_fait_par?: string | null;
  fait_par_nom?: string | null;
  terrain_nom?: string | null;
  commodite_label?: string | null;
  commodite_icone?: string | null;
};

type UnifiedRow = {
  key: string;
  kind: "photo" | "commodite";
  at: string;
  action: string;
  detail: string;
  role: string;
  auteur: string;
  terrain: string;
  extra?: string | null;
  photoUrl?: string | null;
  icone?: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  upload: "Upload",
  suppression: "Suppression",
  principale_definie: "Photo principale",
  ajout: "Ajout",
  retrait: "Retrait",
  creation_commodite: "Création",
  modification_commodite: "Modification",
  desactivation_commodite: "Désactivation",
};

function roleLabel(role?: string | null) {
  if (role === "gerant") return "Gérant";
  if (role === "super_admin") return "Super Admin";
  return role || "—";
}

function formatAt(value?: string) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("fr-FR");
}

export function unifyAuditRows(
  photos: AuditPhotoRow[],
  commodites: AuditCommoditeRow[],
): UnifiedRow[] {
  const photoRows: UnifiedRow[] = photos.map((row) => ({
    key: `p-${row.id}`,
    kind: "photo",
    at: row.created_at || "",
    action: row.action || "",
    detail: row.detail || "",
    role: row.role_fait_par || "",
    auteur: row.fait_par_nom || "—",
    terrain: row.terrain_nom || "—",
    extra: row.photo_nom || null,
    photoUrl: row.photo_url || null,
  }));
  const commoditeRows: UnifiedRow[] = commodites.map((row) => ({
    key: `c-${row.id}`,
    kind: "commodite",
    at: row.created_at || "",
    action: row.action || "",
    detail: row.detail || "",
    role: row.role_fait_par || "",
    auteur: row.fait_par_nom || "—",
    terrain: row.terrain_nom || "—",
    extra: row.commodite_label || null,
    icone: row.commodite_icone || null,
  }));
  return [...photoRows, ...commoditeRows].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function auditRowsToCsv(rows: UnifiedRow[]) {
  const headers = ["Date", "Type", "Terrain", "Action", "Fait par", "Rôle", "Détail"];
  const lines = rows.map((r) =>
    [formatAt(r.at), r.kind === "photo" ? "Photo" : "Commodité", r.terrain, ACTION_LABEL[r.action] || r.action, r.auteur, roleLabel(r.role), r.detail]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(";"),
  );
  return [headers.join(";"), ...lines].join("\n");
}

export function downloadAuditCsv(filename: string, rows: UnifiedRow[]) {
  const blob = new Blob(["\uFEFF" + auditRowsToCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditTables({
  photos,
  commodites,
  showTerrain = false,
}: {
  photos: AuditPhotoRow[];
  commodites: AuditCommoditeRow[];
  showTerrain?: boolean;
}) {
  const rows = useMemo(() => unifyAuditRows(photos, commodites), [photos, commodites]);

  if (!rows.length) {
    return (
      <p className="text-[13px] py-6 text-center" style={{ color: "var(--sa-muted)" }}>
        Aucun événement d&apos;audit.
      </p>
    );
  }

  return (
    <div className="rounded-xl overflow-x-auto" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
      <table className="sa-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            {showTerrain ? <th>Terrain</th> : null}
            <th>Action</th>
            <th>Fait par</th>
            <th>Détail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="whitespace-nowrap text-[12px]">{formatAt(row.at)}</td>
              <td>
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{
                    background: row.kind === "photo" ? "var(--sa-info-bg, var(--sa-primary-glow))" : "var(--sa-success-bg)",
                    color: row.kind === "photo" ? "var(--sa-primary)" : "var(--sa-success)",
                  }}
                >
                  {row.kind === "photo" ? "Photo" : "Commodité"}
                </span>
              </td>
              {showTerrain ? <td className="text-[13px]">{row.terrain}</td> : null}
              <td className="text-[13px] font-medium">{ACTION_LABEL[row.action] || row.action}</td>
              <td>
                <div className="text-[13px]">{row.auteur}</div>
                <div className="text-[11px]" style={{ color: "var(--sa-muted)" }}>{roleLabel(row.role)}</div>
              </td>
              <td>
                <div className="flex items-center gap-2 min-w-[180px]">
                  {row.photoUrl ? (
                    <img src={row.photoUrl} alt="" className="w-10 h-6 object-cover rounded" style={{ aspectRatio: "16/9" }} />
                  ) : null}
                  {row.icone ? <LucideByName name={row.icone} size={14} style={{ color: "var(--sa-primary)" }} /> : null}
                  <span className="text-[12px]" style={{ color: "var(--sa-text-2)" }}>
                    {row.detail || row.extra || "—"}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
