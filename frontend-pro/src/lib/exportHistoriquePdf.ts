import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type HistoriqueMatchPdfRow = {
  date?: string | null;
  heure_debut?: string | null;
  heure_fin?: string | null;
  joueur_nom?: string | null;
  joueur_telephone?: string | null;
  terrain_nom?: string | null;
  format_terrain?: string | null;
  code_reservation?: string | null;
  statut?: string | null;
  type_reservation?: string | null;
  montant_total?: number | null;
  montant_avance?: number | null;
  montant_restant?: number | null;
  mode_paiement?: string | null;
  canal_paiement?: string | null;
  note_gerant?: string | null;
};

export type ExportHistoriquePdfOptions = {
  titre?: string;
  sousTitre?: string;
  terrainLabel?: string;
  periodeLabel?: string;
  roleLabel?: string;
  rows: HistoriqueMatchPdfRow[];
  filename?: string;
};

function fcfa(n?: number | null) {
  return `${Number(n || 0).toLocaleString("fr-FR")} F`;
}

function statutLabel(s?: string | null) {
  const v = String(s || "").toLowerCase();
  if (v === "confirme" || v === "acceptee") return "Confirmée";
  if (v.includes("attente")) return "En attente";
  if (v === "match_joue" || v === "joue") return "Jouée";
  if (v.includes("annul") || v === "refusee" || v === "expiree") return "Annulée";
  return s || "—";
}

function formatTerrain(f?: string | null) {
  const v = String(f || "entier").toLowerCase();
  if (v === "moitie" || v === "moitié") return "Moitié";
  if (v === "quart") return "Quart";
  return "Entier";
}

export function exportHistoriquePdf(opts: ExportHistoriquePdfOptions) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const marginX = 12;
  const pageW = doc.internal.pageSize.getWidth();
  const now = new Date().toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  doc.setFillColor(15, 76, 58);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(opts.titre || "Historique des matchs", marginX, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(opts.sousTitre || "TerrainSN — rapport détaillé", marginX, 19);
  doc.text(now, pageW - marginX, 12, { align: "right" });

  doc.setTextColor(40, 40, 40);
  doc.setFontSize(10);
  let metaY = 36;
  const meta: string[] = [];
  if (opts.roleLabel) meta.push(opts.roleLabel);
  if (opts.terrainLabel) meta.push(`Terrain : ${opts.terrainLabel}`);
  if (opts.periodeLabel) meta.push(`Période : ${opts.periodeLabel}`);
  meta.push(`${opts.rows.length} match(s)`);
  doc.text(meta.join("  ·  "), marginX, metaY);

  const total = opts.rows.reduce((s, r) => s + Number(r.montant_total || 0), 0);
  const avances = opts.rows.reduce((s, r) => s + Number(r.montant_avance || 0), 0);
  const restes = opts.rows.reduce((s, r) => s + Number(r.montant_restant || 0), 0);
  metaY += 6;
  doc.setFont("helvetica", "bold");
  doc.text(
    `Total réservations ${fcfa(total)}   ·   Avances ${fcfa(avances)}   ·   Restes ${fcfa(restes)}`,
    marginX,
    metaY,
  );

  const body = opts.rows.map((r) => [
    r.date || "—",
    `${String(r.heure_debut || "").slice(0, 5)}${r.heure_fin ? `–${String(r.heure_fin).slice(0, 5)}` : ""}`,
    r.terrain_nom || "—",
    r.joueur_nom || "—",
    r.joueur_telephone || "—",
    formatTerrain(r.format_terrain),
    statutLabel(r.statut),
    r.type_reservation === "manuelle" ? "Manuelle" : "En ligne",
    fcfa(r.montant_total),
    fcfa(r.montant_avance),
    fcfa(r.montant_restant),
    r.code_reservation || "—",
    [r.mode_paiement, r.canal_paiement].filter(Boolean).join("/") || "—",
  ]);

  autoTable(doc, {
    startY: metaY + 4,
    head: [[
      "Date",
      "Heure",
      "Terrain",
      "Joueur",
      "Tél.",
      "Format",
      "Statut",
      "Type",
      "Total",
      "Avance",
      "Reste",
      "Code",
      "Paiement",
    ]],
    body,
    styles: {
      fontSize: 7,
      cellPadding: 1.6,
      textColor: [40, 40, 40],
      lineColor: [220, 220, 220],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [15, 76, 58],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7,
    },
    alternateRowStyles: { fillColor: [245, 248, 246] },
    margin: { left: marginX, right: marginX },
    didDrawPage: (data) => {
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(
        `Page ${data.pageNumber}`,
        pageW / 2,
        pageH - 6,
        { align: "center" },
      );
    },
  });

  const filename =
    opts.filename ||
    `historique-matchs-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
