import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Receipt } from "lucide-react";
import { gerantApi } from "@/lib/api";

const MOIS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];

function moisLabel(periode: string) {
  const [y, m] = String(periode || "").split("-");
  const idx = Number(m) - 1;
  if (!Number.isFinite(idx) || idx < 0) return periode;
  return `${MOIS[idx]} ${y}`;
}

function moisSuivant(periode: string) {
  const [y, m] = String(periode || "").split("-").map(Number);
  const d = new Date(y, (m || 1) - 1 + 1, 1);
  return MOIS[d.getMonth()];
}

function fcfa(n: number) {
  return `${Number(n || 0).toLocaleString("fr-FR")} FCFA`;
}

export default function CommissionDueCard() {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);

  useEffect(() => {
    gerantApi.dettes().then(setData).catch(() => setData(null));
  }, []);

  const due = Number(data?.resume?.dette_en_cours || 0);
  const nb = Number(data?.resume?.nb_reservations_manuelles || 0);
  const periode = String(data?.periode || "");
  const instructions = String(data?.instructions || "").trim()
    || "Pour régler : envoie le montant dû à l'équipe TerrainSN. Le compteur sera remis à zéro après réception.";

  const nextMonth = useMemo(() => moisSuivant(periode), [periode]);

  return (
    <>
      <section
        className="rounded-xl px-4 py-3.5"
        style={{
          background: due > 0 ? "var(--g-warning-bg)" : "var(--g-surface-2)",
          borderRadius: 12,
          padding: "14px 16px",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Receipt size={18} style={{ color: "var(--g-warning)" }} />
            <p className="text-[13px] font-semibold" style={{ color: "var(--g-text)" }}>Commission due ce mois</p>
          </div>
          <p
            className="text-[16px] font-bold shrink-0"
            style={{
              fontFamily: "var(--font-display)",
              color: due > 0 ? "var(--g-warning)" : "var(--g-primary)",
            }}
          >
            {due > 0 ? fcfa(due) : "0 FCFA ✓"}
          </p>
        </div>
        <p className="mt-1 text-[12px]" style={{ color: "var(--g-muted)" }}>
          {due > 0
            ? `${nb} réservation(s) sans paiement plateforme ce mois. À régler avant le 1er ${nextMonth}.`
            : "Toutes les commissions sont à jour ✓"}
        </p>
        {due > 0 ? (
          <button type="button" onClick={() => setOpen(true)} className="mt-2 text-[12px] font-semibold" style={{ color: "var(--g-warning)" }}>
            Voir le détail
          </button>
        ) : null}
      </section>

      {open ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-center">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Fermer" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-t-2xl md:rounded-2xl bg-white p-4" style={{ background: "var(--g-surface)" }}>
            <h3 className="text-[16px] font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              Commission due — {moisLabel(periode)}
            </h3>
            <p className="mt-1 text-[12px]" style={{ color: "var(--g-muted)" }}>
              Ces réservations ont été confirmées manuellement hors PayTech. La commission est due à TerrainSN.
            </p>
            <ul className="mt-3 space-y-2">
              {(data?.detail || []).map((row: any) => (
                <li key={row.id} className="rounded-xl px-3 py-2.5" style={{ background: "var(--g-surface-2)" }}>
                  <div className="flex justify-between gap-2 text-[13px]">
                    <span>{row.match_date} {String(row.heure_debut || "").slice(0, 5)} · {String(row.joueur_nom || "").split(" ")[0]}</span>
                    <span>Avance {fcfa(row.montant_avance_manuelle)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[12px]">Commission due : {fcfa(row.montant_commission)}</span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "var(--g-warning-bg)", color: "var(--g-warning)" }}>
                      {row.statut === "payee" ? "Payée" : "En attente"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 rounded-xl px-3 py-2.5 font-bold" style={{ background: "var(--g-warning-bg)", color: "var(--g-warning)" }}>
              Total à régler : {fcfa(due)}
            </div>
            <p className="mt-3 text-[11px]" style={{ color: "var(--g-muted)" }}>{instructions}</p>
            {(data?.historique || []).length > 0 ? (
              <div className="mt-3">
                <button type="button" onClick={() => setHistOpen((v) => !v)} className="inline-flex items-center gap-1 text-[12px] font-semibold">
                  Historique <ChevronDown size={14} className={histOpen ? "rotate-180" : ""} />
                </button>
                {histOpen ? (
                  <ul className="mt-2 space-y-1 text-[12px]" style={{ color: "var(--g-muted)" }}>
                    {data.historique.map((h: any) => (
                      <li key={h.periode}>
                        {moisLabel(h.periode)} — {Number(h.nb_attente) > 0 ? fcfa(h.total) : `${fcfa(h.total)} ✓`}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <button type="button" onClick={() => setOpen(false)} className="mt-4 h-10 w-full rounded-xl text-sm font-semibold" style={{ border: "1px solid var(--g-border, #e5e7eb)" }}>
              Fermer
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
