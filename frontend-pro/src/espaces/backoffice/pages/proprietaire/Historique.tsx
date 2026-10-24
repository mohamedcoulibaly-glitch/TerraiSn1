import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
import { proprietaireApi } from "@/lib/api";
import { exportHistoriquePdf } from "@/lib/exportHistoriquePdf";

type Periode = "jour" | "semaine" | "mois" | "annee";
type StatutFilter = "all" | "confirme" | "en_attente" | "joue" | "annulee";
type Terrain = { id: number; nom: string };

type MatchRow = {
  id: number | string;
  date?: string;
  heure_debut?: string;
  heure_fin?: string;
  joueur_nom?: string | null;
  joueur_telephone?: string | null;
  terrain_id?: number;
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
  gerant_nom?: string | null;
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
  const s = String(statut || "").toLowerCase();
  if (s === "confirme" || s === "acceptee") {
    return { label: "Confirmée", color: "var(--p-primary)", bg: "var(--p-primary-glow)" };
  }
  if (s.includes("attente")) {
    return { label: "En attente", color: "var(--p-attention)", bg: "var(--p-attention-bg)" };
  }
  if (s === "match_joue" || s === "joue") {
    return { label: "Jouée", color: "var(--p-optimal)", bg: "var(--p-optimal-bg)" };
  }
  if (s.includes("annul") || s === "refusee" || s === "expiree") {
    return { label: "Annulée", color: "var(--p-muted)", bg: "var(--p-surface-2)" };
  }
  return { label: statut || "—", color: "var(--p-muted)", bg: "var(--p-surface-2)" };
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

export default function HistoriqueProprietairePage() {
  const [periode, setPeriode] = useState<Periode>("mois");
  const [statut, setStatut] = useState<StatutFilter>("all");
  const [terrainId, setTerrainId] = useState<"all" | number>("all");
  const [terrains, setTerrains] = useState<Terrain[]>([]);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);

  useEffect(() => {
    proprietaireApi
      .terrains()
      .then((list) => setTerrains(Array.isArray(list) ? list : []))
      .catch(() => setTerrains([]));
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await proprietaireApi.reservationsHistorique({
        statut,
        q: debouncedQ || undefined,
        periode,
        terrainId: terrainId === "all" ? undefined : terrainId,
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
  }, [periode, statut, debouncedQ, terrainId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const total = rows.reduce((s, r) => s + Number(r.montant_total || 0), 0);
    const avances = rows.reduce((s, r) => s + Number(r.montant_avance || 0), 0);
    const restes = rows.reduce((s, r) => s + Number(r.montant_restant || 0), 0);
    return { total, avances, restes };
  }, [rows]);

  const terrainLabel =
    terrainId === "all"
      ? "Tous les terrains"
      : terrains.find((t) => Number(t.id) === Number(terrainId))?.nom || `Terrain #${terrainId}`;

  const onExport = () => {
    if (!rows.length) {
      toast.message("Aucun match à exporter");
      return;
    }
    try {
      exportHistoriquePdf({
        titre: "Historique des matchs",
        roleLabel: "Espace propriétaire — pilotage",
        terrainLabel,
        periodeLabel: `${periodeLabel(periode)}${from && to ? ` (${from} → ${to})` : ""}`,
        rows,
        filename: `historique-proprietaire-${periode}-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
      toast.success("PDF téléchargé");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export PDF impossible");
    }
  };

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
            Historique des matchs
          </h1>
          <p className="text-xs mt-1" style={{ color: "var(--p-muted)" }}>
            Vue détaillée multi-terrains · export PDF
          </p>
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={!rows.length}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--p-primary)" }}
        >
          <Download className="w-4 h-4" />
          PDF
        </button>
      </div>

      {terrains.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          <button
            type="button"
            onClick={() => setTerrainId("all")}
            className="shrink-0 min-h-[44px] px-3.5 rounded-full text-xs font-semibold"
            style={{
              background: terrainId === "all" ? "var(--p-primary)" : "var(--p-surface-2)",
              color: terrainId === "all" ? "#fff" : "var(--p-muted)",
            }}
          >
            Tous
          </button>
          {terrains.map((t) => {
            const active = Number(terrainId) === Number(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTerrainId(Number(t.id))}
                className="shrink-0 min-h-[44px] px-3.5 rounded-full text-xs font-semibold max-w-[160px] truncate"
                style={{
                  background: active ? "var(--p-primary)" : "var(--p-surface-2)",
                  color: active ? "#fff" : "var(--p-muted)",
                }}
              >
                {t.nom}
              </button>
            );
          })}
        </div>
      )}

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
                background: actif ? "var(--p-primary)" : "var(--p-surface-2)",
                color: actif ? "#fff" : "var(--p-muted)",
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
                background: actif ? "var(--p-primary-glow)" : "var(--p-surface)",
                color: actif ? "var(--p-primary)" : "var(--p-muted)",
                border: `1px solid ${actif ? "var(--p-primary)" : "var(--p-border, var(--p-surface-2))"}`,
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--p-muted)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Joueur, téléphone, code, terrain…"
          className="w-full h-12 pl-10 pr-3 rounded-xl text-sm outline-none"
          style={{
            background: "var(--p-surface)",
            border: "1px solid var(--p-border, var(--p-surface-2))",
            color: "var(--p-text)",
          }}
        />
      </div>

      <div
        className="grid grid-cols-3 gap-2 rounded-2xl p-3"
        style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow, none)" }}
      >
        <div>
          <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--p-muted)" }}>Total</p>
          <p className="text-sm font-bold" style={{ color: "var(--p-text)" }}>{fcfa(totals.total)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--p-muted)" }}>Avances</p>
          <p className="text-sm font-bold" style={{ color: "var(--p-primary)" }}>{fcfa(totals.avances)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--p-muted)" }}>Restes</p>
          <p className="text-sm font-bold" style={{ color: "var(--p-text)" }}>{fcfa(totals.restes)}</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-2xl" style={{ background: "var(--p-surface-2)" }} />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-center py-8" style={{ color: "var(--p-danger, #b91c1c)" }}>{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-center py-8" style={{ color: "var(--p-muted)" }}>Aucun match sur cette période</p>
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
                  background: "var(--p-surface)",
                  borderLeft: `4px solid ${ui.color}`,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--p-text)" }}>
                      {r.date} · {String(r.heure_debut || "").slice(0, 5)}
                      {r.heure_fin ? `–${String(r.heure_fin).slice(0, 5)}` : ""}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--p-muted)" }}>
                      {r.terrain_nom || "Terrain"} · {r.joueur_nom || "Joueur"}
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

                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs" style={{ color: "var(--p-text)" }}>
                  <span>Format · {formatTerrain(r.format_terrain)}</span>
                  <span>{r.type_reservation === "manuelle" ? "Manuelle" : "En ligne"}</span>
                  <span>Total · {fcfa(r.montant_total)}</span>
                  <span>Avance · {fcfa(r.montant_avance)}</span>
                  <span>Reste · {fcfa(r.montant_restant)}</span>
                  <span>Code · {r.code_reservation || "—"}</span>
                  {r.gerant_nom ? <span className="col-span-2">Gérant · {r.gerant_nom}</span> : null}
                </div>

                {open ? (
                  <div className="mt-3 pt-3 space-y-1 text-xs" style={{ borderTop: "1px solid var(--p-surface-2)", color: "var(--p-muted)" }}>
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

                <button
                  type="button"
                  onClick={() => setExpanded((prev) => ({ ...prev, [key]: !open }))}
                  className="mt-3 w-full min-h-[44px] rounded-xl text-sm font-semibold"
                  style={{ color: "var(--p-muted)", border: "1px solid var(--p-surface-2)" }}
                >
                  {open ? "Réduire" : "Plus de détails"}
                </button>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
