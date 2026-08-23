import { useEffect, useMemo, useState } from "react";
import { CheckCircle, ChevronDown, Receipt } from "lucide-react";
import { toast } from "sonner";
import { gerantApi } from "@/lib/api";
import TimerEcheance from "./TimerEcheance";
import BoutonPayerDette from "./BoutonPayerDette";

const MOIS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];

function moisLabel(periode: string) {
  const [y, m] = String(periode || "").split("-");
  const idx = Number(m) - 1;
  if (!Number.isFinite(idx) || idx < 0) return periode;
  return `${MOIS[idx]} ${y}`;
}

function fcfa(n: number) {
  return `${Number(n || 0).toLocaleString("fr-FR")} FCFA`;
}

function borderUrgence(jours: number | null, due: number) {
  if (due <= 0) return "var(--g-success)";
  if (jours == null) return "var(--g-primary)";
  if (jours < 3) return "var(--g-danger)";
  if (jours <= 7) return "var(--g-warning)";
  return "var(--g-primary)";
}

export default function CommissionDueCard({ enabled = true }: { enabled?: boolean }) {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [displayDue, setDisplayDue] = useState(0);
  const [soldeAnime, setSoldeAnime] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }
    gerantApi
      .dettes()
      .then((d) => {
        setData(d);
        const due = Number(
          d?.resume?.solde_restant ?? d?.resume?.dette_en_cours ?? d?.resume?.total_dette ?? 0,
        );
        setDisplayDue(due);
      })
      .catch(() => setData(null));
  }, [enabled]);

  const resume = data?.resume || {};
  const due = Number(resume.solde_restant ?? resume.dette_en_cours ?? resume.total_dette ?? displayDue ?? 0);
  const nb = Number(resume.nb_reservations_manuelles || 0);
  const periode = String(data?.periode || "");
  const dateEcheance = String(resume.date_echeance || "");
  const delaiTotal = Number(resume.delai_paiement_dette_jours || 30);
  const joursRestants = resume.jours_restants != null ? Number(resume.jours_restants) : null;
  const statut = String(resume.statut_periode || "");
  const instructions =
    String(data?.instructions || "").trim() ||
    "Pour régler : utilise le bouton Payer. Le compteur se met à jour après confirmation.";

  const borderColor = useMemo(
    () => borderUrgence(joursRestants, displayDue),
    [joursRestants, displayDue],
  );

  if (!enabled) return null;

  const handlePaiementReussi = (montantRegle: number, soldeRestant: number) => {
    const from = displayDue;
    const to = Math.max(0, soldeRestant);
    setSoldeAnime(true);
    const start = performance.now();
    const duration = 1000;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplayDue(Math.round(from + (to - from) * t));
      if (t < 1) requestAnimationFrame(tick);
      else {
        setDisplayDue(to);
        setSoldeAnime(false);
      }
    };
    requestAnimationFrame(tick);

    setData((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        resume: {
          ...prev.resume,
          dette_en_cours: to,
          solde_restant: to,
          total_regle: Number(prev.resume?.total_regle || 0) + montantRegle,
          statut_periode: to === 0 ? "solde" : "partiellement_regle",
        },
      };
    });

    if (to === 0) {
      toast.success("Tout est réglé ✓ — Commission du mois soldée !");
    } else {
      toast.success(`Paiement de ${fcfa(montantRegle)} enregistré ✓ — Reste ${fcfa(to)}`);
    }
  };

  const regle = displayDue <= 0;

  return (
    <>
      <section
        className="rounded-2xl px-4 py-3.5 transition-colors duration-500"
        style={{
          background: regle ? "var(--g-success-bg, var(--g-primary-glow))" : "var(--g-surface)",
          borderLeft: `4px solid ${borderColor}`,
          borderRadius: 16,
          padding: "14px 16px",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {regle ? (
                <CheckCircle size={18} style={{ color: "var(--g-success)" }} />
              ) : (
                <Receipt size={18} style={{ color: borderColor }} />
              )}
              <p className="text-[13px] font-semibold" style={{ color: "var(--g-text)" }}>
                Commission due
              </p>
            </div>
            <p
              className={`mt-1 text-[20px] font-bold ${soldeAnime ? "tabular-nums" : ""}`}
              style={{
                fontFamily: "var(--font-display)",
                color: regle
                  ? "var(--g-success)"
                  : borderColor === "var(--g-danger)"
                    ? "var(--g-danger)"
                    : "var(--g-warning)",
              }}
            >
              {regle ? "Tout est réglé ✓" : fcfa(displayDue)}
            </p>
            {statut === "partiellement_regle" && displayDue > 0 ? (
              <span
                className="mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: "var(--g-warning-bg)", color: "var(--g-warning)" }}
              >
                Partiellement réglé
              </span>
            ) : null}
            {!regle && dateEcheance ? (
              <TimerEcheance dateEcheance={dateEcheance} delaiTotal={delaiTotal} dette={displayDue} />
            ) : null}
          </div>
          {!regle ? (
            <BoutonPayerDette
              montantDu={displayDue}
              periodeId={periode}
              onPaiementReussi={handlePaiementReussi}
            />
          ) : null}
        </div>

        <p className="mt-2 text-[12px]" style={{ color: "var(--g-muted)" }}>
          {displayDue > 0
            ? `${nb} réservation(s) confirmées hors paiement en ligne ce mois`
            : "Toutes les commissions sont à jour ✓"}
        </p>
        {due > 0 || displayDue > 0 ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-2 text-[12px] font-semibold"
            style={{ color: "var(--g-primary)" }}
          >
            Voir le détail
          </button>
        ) : null}
      </section>

      {open ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-center">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Fermer" onClick={() => setOpen(false)} />
          <div
            className="relative w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-t-2xl md:rounded-2xl p-4"
            style={{ background: "var(--g-surface)" }}
          >
            <h3 className="text-[16px] font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              Commission due — {moisLabel(periode)}
            </h3>
            <p className="mt-1 text-[12px]" style={{ color: "var(--g-muted)" }}>
              Ces réservations ont été confirmées hors PayTech. La commission est due à TerrainSN.
            </p>
            <ul className="mt-3 space-y-2">
              {(data?.detail || []).map((row: any) => (
                <li key={row.id} className="rounded-xl px-3 py-2.5" style={{ background: "var(--g-surface-2)" }}>
                  <div className="flex justify-between gap-2 text-[13px]">
                    <span>
                      {row.match_date || row.resa_date || ""} {String(row.heure_debut || "").slice(0, 5)} ·{" "}
                      {String(row.joueur_nom || "").split(" ")[0]}
                    </span>
                    <span>Avance {fcfa(row.montant_avance_manuelle)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[12px]">Commission due : {fcfa(row.montant_commission)}</span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{ background: "var(--g-warning-bg)", color: "var(--g-warning)" }}
                    >
                      {row.statut === "payee" || row.statut === "reglee" ? "Payée" : "En attente"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div
              className="mt-3 rounded-xl px-3 py-2.5 font-bold"
              style={{ background: "var(--g-warning-bg)", color: "var(--g-warning)" }}
            >
              Total à régler : {fcfa(displayDue)}
            </div>
            <p className="mt-3 text-[11px]" style={{ color: "var(--g-muted)" }}>
              {instructions}
            </p>
            {(data?.historique || []).length > 0 ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setHistOpen((v) => !v)}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold"
                >
                  Mois précédents <ChevronDown size={14} className={histOpen ? "rotate-180" : ""} />
                </button>
                {histOpen ? (
                  <ul className="mt-2 space-y-1 text-[12px]" style={{ color: "var(--g-muted)" }}>
                    {data.historique.map((h: any) => (
                      <li key={h.periode}>
                        {moisLabel(h.periode)} —{" "}
                        {Number(h.nb_attente) > 0 ? fcfa(h.total) : `${fcfa(h.total)} ✓`}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-4 h-10 w-full rounded-xl text-sm font-semibold"
              style={{ border: "1px solid var(--g-border, #e5e7eb)" }}
            >
              Fermer
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
