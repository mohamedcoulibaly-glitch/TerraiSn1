import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type FinancesPdfLigne = {
  date?: string;
  heure_debut?: string;
  joueur_nom?: string;
  joueur_telephone?: string | null;
  montant_avance?: number;
  montant_total?: number;
  terrain_nom?: string | null;
  statut?: string;
  code_reservation?: string | null;
};

export type FinancesPdfParTerrain = {
  id?: number;
  nom: string;
  total_encaisse?: number;
  avances_recues?: number;
  matchs_joues?: number;
  a_venir?: number;
  nb_reservations?: number;
};

export type ExportFinancesPdfOptions = {
  titre?: string;
  roleLabel?: string;
  terrainLabel?: string;
  periodeLabel?: string;
  from?: string;
  to?: string;
  total_encaisse: number;
  avances_recues: number;
  matchs_joues: number;
  a_venir: number;
  historique: FinancesPdfLigne[];
  par_terrain?: FinancesPdfParTerrain[];
  filename?: string;
};

function fcfa(n?: number | null) {
  return `${Number(n || 0).toLocaleString("fr-FR")} FCFA`;
}

export function exportFinancesPdf(opts: ExportFinancesPdfOptions) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const marginX = 14;
  const pageW = doc.internal.pageSize.getWidth();
  const now = new Date().toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageW, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(opts.titre || "Bilan financier", marginX, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(opts.roleLabel || "TerrainSN", marginX, 21);
  doc.text(now, pageW - marginX, 13, { align: "right" });

  doc.setTextColor(35, 35, 35);
  let y = 40;
  doc.setFontSize(10);
  const metaParts = [
    opts.terrainLabel ? `Périmètre : ${opts.terrainLabel}` : null,
    opts.periodeLabel ? `Période : ${opts.periodeLabel}` : null,
    opts.from && opts.to ? `${opts.from} → ${opts.to}` : null,
  ].filter(Boolean);
  doc.text(metaParts.join("  ·  "), marginX, y);
  y += 10;

  const kpis = [
    { label: "Total encaissé", value: fcfa(opts.total_encaisse) },
    { label: "Avances reçues", value: fcfa(opts.avances_recues) },
    { label: "Matchs joués", value: String(opts.matchs_joues || 0) },
    { label: "À venir", value: String(opts.a_venir || 0) },
  ];
  const boxW = (pageW - marginX * 2 - 9) / 2;
  kpis.forEach((kpi, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = marginX + col * (boxW + 3);
    const by = y + row * 22;
    doc.setFillColor(245, 247, 252);
    doc.setDrawColor(220, 226, 240);
    doc.roundedRect(x, by, boxW, 18, 2, 2, "FD");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 110);
    doc.text(kpi.label, x + 4, by + 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(30, 64, 175);
    doc.text(kpi.value, x + 4, by + 13);
    doc.setFont("helvetica", "normal");
  });
  y += 50;

  if (opts.par_terrain && opts.par_terrain.length > 0) {
    doc.setTextColor(35, 35, 35);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Répartition par terrain", marginX, y);
    y += 3;
    autoTable(doc, {
      startY: y,
      head: [["Terrain", "Encaissé", "Avances", "Matchs joués", "À venir", "Résas"]],
      body: opts.par_terrain.map((t) => [
        t.nom,
        fcfa(t.total_encaisse),
        fcfa(t.avances_recues),
        String(t.matchs_joues || 0),
        String(t.a_venir || 0),
        String(t.nb_reservations || 0),
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 247, 252] },
      margin: { left: marginX, right: marginX },
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y) + 10;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(35, 35, 35);
  doc.text("Détail des encaissements", marginX, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [["Date", "Heure", "Terrain", "Joueur", "Avance", "Statut", "Code"]],
    body: opts.historique.map((r) => [
      r.date || "—",
      String(r.heure_debut || "").slice(0, 5) || "—",
      r.terrain_nom || "—",
      r.joueur_nom || "—",
      fcfa(r.montant_avance),
      r.statut || "—",
      r.code_reservation || "—",
    ]),
    styles: { fontSize: 7.5, cellPadding: 1.8 },
    headStyles: { fillColor: [15, 76, 58], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 248, 246] },
    margin: { left: marginX, right: marginX },
    didDrawPage: (data) => {
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(`Page ${data.pageNumber}`, pageW / 2, pageH - 8, { align: "center" });
    },
  });

  const filename =
    opts.filename ||
    `bilan-financier-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
