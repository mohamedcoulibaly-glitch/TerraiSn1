import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
import { gerantApi } from "@/lib/api";
import { exportHistoriquePdf } from "@/lib/exportHistoriquePdf";

type Periode = "jour" | "semaine" | "mois" | "annee";
type StatutFilter = "all" | "confirme" | "en_attente" | "joue" | "annulee";

type MatchRow = {
  id: number | string;
  date?: string;
  heure_debut?: string;
  heure_fin?: string;
  joueur_nom?: string | null;
  joueur_telephone?: string | null;
  terrain_nom?: string | null;
  format_terrain?: string | null;
  code_reservation?: string | null;
  statut?: string;
  type_reservation?: string;
  montant_total?: number;
  montant_avance?: number;
  montant_restant?: number;
  mode_paiement?: string | null;
  canal_paiement?: string | null;
  note_gerant?: string | null;
  created_at?: string | null;
  confirme_at?: string | null;
  checked_in_at?: string | null;
  checkout_at?: string | null;
  match_joue_at?: string | null;
  match_methode_solde?: string | null;
  operational_stage?: string | null;
};

const PERIODES: Array<{ id: Periode; label: string }> = [
  { id: "jour", label: "Jour" },
  { id: "semaine", label: "Semaine" },
  { id: "mois", label: "Mois" },
  { id: "annee", label: "Année" },
];

const STATUTS: Array<{ id: StatutFilter; label: string }> = [
  { id: "all", label: "Tous" },
  { id: "confirme", label: "Confirmées" },
  { id: "en_attente", label: "En attente" },
  { id: "joue", label: "Jouées" },
  { id: "annulee", label: "Annulées" },
];

function fcfa(n?: number) {
  return `${Number(n || 0).toLocaleString("fr-FR")} FCFA`;
}

function statutUi(statut?: string) {
  if (statut === "confirme" || statut === "acceptee") {
    return { label: "Confirmée", color: "var(--g-reserve)", bg: "var(--g-reserve-bg)" };
  }
  if (statut === "en_attente" || statut === "en_attente_paiement") {
    return { label: "En attente", color: "var(--g-en-attente)", bg: "var(--g-en-attente-bg)" };
  }
  if (statut === "match_joue" || statut === "joue") {
    return { label: "Jouée", color: "var(--g-termine)", bg: "var(--g-termine-bg)" };
  }
  if (statut === "annulee" || statut === "annule" || statut === "refusee" || statut === "expiree") {
    return { label: "Annulée", color: "var(--g-muted)", bg: "var(--g-termine-bg)" };
  }
  return { label: statut || "—", color: "var(--g-muted)", bg: "var(--g-surface-2)" };
}

function formatTerrain(f?: string | null) {
  const v = String(f || "entier").toLowerCase();
  if (v === "moitie" || v === "moitié") return "Moitié";
  if (v === "quart") return "Quart";
  return "Entier";
}

function periodeLabel(p: Periode) {
  return PERIODES.find((x) => x.id === p)?.label || p;
}

export default function HistoriqueGerantPage() {
  const navigate = useNavigate();
  const [periode, setPeriode] = useState<Periode>("mois");
  const [statut, setStatut] = useState<StatutFilter>("all");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await gerantApi.reservationsList({
        statut,
        q: debouncedQ || undefined,
        periode,
      });
      const data = payload as { reservations?: MatchRow[]; from?: string; to?: string };
      setRows(data.reservations || []);
      setFrom(data.from || null);
      setTo(data.to || null);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Impossible de charger l'historique");
    } finally {
      setLoading(false);
    }
  }, [periode, statut, debouncedQ]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const total = rows.reduce((s, r) => s + Number(r.montant_total || 0), 0);
    const avances = rows.reduce((s, r) => s + Number(r.montant_avance || 0), 0);
    const restes = rows.reduce((s, r) => s + Number(r.montant_restant || 0), 0);
    return { total, avances, restes };
  }, [rows]);

  const onExport = () => {
    if (!rows.length) {
      toast.message("Aucun match à exporter");
      return;
    }
    try {
      exportHistoriquePdf({
        titre: "Historique des matchs",
        roleLabel: "Espace gérant",
        terrainLabel: rows[0]?.terrain_nom || "Terrain actif",
        periodeLabel: `${periodeLabel(periode)}${from && to ? ` (${from} → ${to})` : ""}`,
        rows,
        filename: `historique-gerant-${periode}-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
      toast.success("PDF téléchargé");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export PDF impossible");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--g-text)" }}>
            Historique des matchs
          </h1>
          <p className="text-xs mt-1" style={{ color: "var(--g-muted)" }}>
            Tous les détails · filtrable · export PDF
          </p>
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={!rows.length}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--g-primary)" }}
        >
          <Download className="w-4 h-4" />
          PDF
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {PERIODES.map((p) => {
          const actif = periode === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriode(p.id)}
              className="shrink-0 min-h-[44px] px-4 rounded-full text-sm font-semibold"
              style={{
                background: actif ? "var(--g-primary)" : "var(--g-surface-2)",
                color: actif ? "#fff" : "var(--g-muted)",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {STATUTS.map((s) => {
          const actif = statut === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setStatut(s.id)}
              className="shrink-0 min-h-[40px] px-3 rounded-full text-xs font-semibold"
              style={{
                background: actif ? "var(--g-primary-glow)" : "var(--g-surface)",
                color: actif ? "var(--g-primary)" : "var(--g-muted)",
                border: `1px solid ${actif ? "var(--g-primary)" : "var(--g-border)"}`,
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--g-muted)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Joueur, téléphone, code…"
          className="w-full h-12 pl-10 pr-3 rounded-xl text-sm outline-none"
          style={{
            background: "var(--g-surface)",
            border: "1px solid var(--g-border)",
            color: "var(--g-text)",
            boxShadow: "var(--g-shadow)",
          }}
        />
      </div>

      <div
        className="grid grid-cols-3 gap-2 rounded-2xl p-3"
        style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
      >
        <div>
          <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--g-muted)" }}>Total</p>
          <p className="text-sm font-bold" style={{ color: "var(--g-text)" }}>{fcfa(totals.total)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--g-muted)" }}>Avances</p>
          <p className="text-sm font-bold" style={{ color: "var(--g-primary)" }}>{fcfa(totals.avances)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--g-muted)" }}>Restes</p>
          <p className="text-sm font-bold" style={{ color: "var(--g-text)" }}>{fcfa(totals.restes)}</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-2xl" style={{ background: "var(--g-surface-2)" }} />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-center py-8" style={{ color: "var(--g-danger)" }}>{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-center py-8" style={{ color: "var(--g-muted)" }}>Aucun match sur cette période</p>
      ) : (
        <section className="space-y-3">
          {rows.map((r) => {
            const ui = statutUi(r.statut);
            const key = String(r.id);
            const open = Boolean(expanded[key]);
            return (
              <article
                key={key}
                className="rounded-2xl p-3.5"
                style={{
                  background: "var(--g-surface)",
                  boxShadow: "var(--g-shadow)",
                  borderLeft: `4px solid ${ui.color}`,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
                      {r.date} · {String(r.heure_debut || "").slice(0, 5)}
                      {r.heure_fin ? `–${String(r.heure_fin).slice(0, 5)}` : ""}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--g-muted)" }}>
                      {r.joueur_nom || "Joueur"}
                      {r.joueur_telephone ? ` · ${r.joueur_telephone}` : ""}
                    </p>
                  </div>
                  <span
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0"
                    style={{ background: ui.bg, color: ui.color }}
                  >
                    {ui.label}
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs" style={{ color: "var(--g-text-2)" }}>
                  <span>Format · {formatTerrain(r.format_terrain)}</span>
                  <span>{r.type_reservation === "manuelle" ? "Manuelle" : "En ligne"}</span>
                  <span>Total · {fcfa(r.montant_total)}</span>
                  <span>Avance · {fcfa(r.montant_avance)}</span>
                  <span>Reste · {fcfa(r.montant_restant)}</span>
                  <span>Code · {r.code_reservation || "—"}</span>
                </div>

                {open ? (
                  <div className="mt-3 pt-3 space-y-1 text-xs" style={{ borderTop: "1px solid var(--g-border)", color: "var(--g-muted)" }}>
                    <p>Paiement · {[r.mode_paiement, r.canal_paiement].filter(Boolean).join(" / ") || "—"}</p>
                    <p>Créée · {r.created_at || "—"}</p>
                    <p>Confirmée · {r.confirme_at || "—"}</p>
                    <p>Check-in · {r.checked_in_at || "—"}</p>
                    <p>Checkout · {r.checkout_at || "—"}</p>
                    <p>Match joué · {r.match_joue_at || "—"}{r.match_methode_solde ? ` (${r.match_methode_solde})` : ""}</p>
                    <p>Stage · {r.operational_stage || "—"}</p>
                    {r.note_gerant ? <p>Note · {r.note_gerant}</p> : null}
                  </div>
                ) : null}

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, [key]: !open }))}
                    className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold"
                    style={{ color: "var(--g-muted)", border: "1px solid var(--g-border)" }}
                  >
                    {open ? "Réduire" : "Plus de détails"}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/backoffice/gerant/reservations/${r.id}`)}
                    className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold"
                    style={{ background: "var(--g-primary-glow)", color: "var(--g-primary)" }}
                  >
                    Ouvrir
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
