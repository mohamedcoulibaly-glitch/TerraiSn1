import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Search } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { gerantApi } from "@/lib/api";
import JoueurProfil from "@/espaces/backoffice/modules/crm/ui/JoueurProfil";

type Reservation = {
  id: number;
  joueur_nom?: string;
  joueur_telephone?: string;
  date?: string;
  heure_debut?: string;
  heure_fin?: string;
  statut?: string;
  montant_avance?: number;
  montant_restant?: number;
  montant?: number;
};

type JoueurRow = {
  id: number;
  display_nom: string;
  telephone?: string | null;
  assiduite_30j?: number;
};

const FILTERS = [
  { id: "all", label: "Toutes" },
  { id: "confirme", label: "Confirmées" },
  { id: "en_attente", label: "En attente" },
  { id: "termine", label: "Terminées" },
  { id: "annulee", label: "Annulées" },
] as const;

function statusUi(statut?: string) {
  if (statut === "confirme" || statut === "acceptee") {
    return { label: "Réservé ✓", color: "var(--g-reserve)", bg: "var(--g-reserve-bg)" };
  }
  if (statut === "en_attente") {
    return { label: "En attente de paiement", color: "var(--g-warning)", bg: "var(--g-en-cours-bg)" };
  }
  if (statut === "match_joue" || statut === "joue") {
    return { label: "Terminé ✓", color: "var(--g-termine)", bg: "var(--g-termine-bg)" };
  }
  if (statut === "annulee" || statut === "annule" || statut === "refusee") {
    return { label: "Annulée", color: "var(--g-muted)", bg: "var(--g-termine-bg)" };
  }
  return { label: statut || "—", color: "var(--g-muted)", bg: "var(--g-surface-2)" };
}

function waLink(tel?: string | null) {
  const digits = String(tel || "").replace(/\D/g, "");
  if (!digits) return null;
  const full = digits.startsWith("221") ? digits : `221${digits.slice(-9)}`;
  return `https://wa.me/${full}`;
}

export default function JoueursReservationsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const selectedId = id ? Number(id) : null;
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [joueurs, setJoueurs] = useState<JoueurRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([gerantApi.dashboard(), gerantApi.joueurs({ filter: "all" })])
      .then(([dash, joueursPayload]) => {
        if (!mounted) return;
        setReservations(((dash as any)?.reservations || []) as Reservation[]);
        setJoueurs((((joueursPayload as any)?.joueurs || []) as JoueurRow[]).slice(0, 10));
      })
      .catch(() => {
        if (!mounted) return;
        setReservations([]);
        setJoueurs([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return reservations.filter((r) => {
      if (filter === "confirme" && !["confirme", "acceptee"].includes(String(r.statut))) return false;
      if (filter === "en_attente" && r.statut !== "en_attente") return false;
      if (filter === "termine" && !["match_joue", "joue"].includes(String(r.statut))) return false;
      if (filter === "annulee" && !["annulee", "annule", "refusee"].includes(String(r.statut))) return false;
      if (!needle) return true;
      return `${r.joueur_nom || ""} ${r.joueur_telephone || ""}`.toLowerCase().includes(needle);
    });
  }, [reservations, filter, q]);

  if (selectedId) {
    return (
      <div className="p-4">
        <button
          type="button"
          onClick={() => navigate("/backoffice/gerant/joueurs")}
          className="text-sm font-semibold min-h-[44px] mb-2"
          style={{ color: "var(--g-primary)" }}
        >
          ← Joueurs & Réservations
        </button>
        <JoueurProfil embedded />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      <div>
        <h1 className="text-lg font-bold" style={{ color: "var(--g-text)", fontFamily: "var(--font-display)" }}>
          Joueurs & Réservations
        </h1>
        <div className="relative mt-3">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--g-muted)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Chercher par nom ou téléphone"
            className="w-full h-12 pl-9 pr-3 rounded-xl text-sm outline-none"
            style={{
              background: "var(--g-surface)",
              border: "1px solid var(--g-border)",
              color: "var(--g-text)",
              boxShadow: "var(--g-shadow)",
            }}
          />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-none">
        {FILTERS.map((f) => {
          const actif = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className="shrink-0 px-3 min-h-[40px] rounded-full text-xs font-semibold"
              style={{
                background: actif ? "var(--g-primary)" : "var(--g-surface-2)",
                color: actif ? "#fff" : "var(--g-muted)",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <section className="space-y-3">
        {loading ? (
          <div className="animate-pulse space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-2xl" style={{ background: "var(--g-surface-2)" }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-center py-8" style={{ color: "var(--g-muted)" }}>
            Aucune réservation
          </p>
        ) : (
          filtered.slice(0, 40).map((r) => {
            const ui = statusUi(r.statut);
            return (
              <article
                key={r.id}
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
                      {r.joueur_nom || "Joueur"}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--g-muted)" }}>
                      {r.date} · {String(r.heure_debut || "").slice(0, 5)}–{String(r.heure_fin || "").slice(0, 5)}
                    </p>
                  </div>
                  <span
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: ui.bg, color: ui.color }}
                  >
                    {ui.label}
                  </span>
                </div>
                {Number(r.montant_restant || 0) > 0 && (
                  <p className="text-[11px] font-semibold mt-2" style={{ color: "var(--g-warning)" }}>
                    Reste à encaisser sur place : {Number(r.montant_restant).toLocaleString("fr-FR")} FCFA
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => navigate(`/backoffice/gerant/reservations/${r.id}`)}
                  className="mt-3 w-full min-h-[44px] rounded-xl text-sm font-semibold"
                  style={{ color: "var(--g-muted)", border: "1px solid var(--g-border)" }}
                >
                  Voir le détail
                </button>
              </article>
            );
          })
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--g-text)" }}>
          Joueurs récents
        </h2>
        <ul className="space-y-2">
          {joueurs.map((j) => {
            const link = waLink(j.telephone);
            const init = j.display_nom
              .split(" ")
              .map((p) => p[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            return (
              <li
                key={j.id}
                className="rounded-xl px-3 py-2.5 flex items-center gap-3"
                style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
              >
                <button
                  type="button"
                  onClick={() => navigate(`/backoffice/gerant/joueurs/${j.id}`)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left min-h-[44px]"
                >
                  <span
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: "var(--g-primary-glow)", color: "var(--g-primary)" }}
                  >
                    {init || "J"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--g-text)" }}>
                      {j.display_nom}
                    </p>
                    <p className="text-xs" style={{ color: "var(--g-muted)" }}>
                      {j.telephone || "—"} · {j.assiduite_30j || 0} matchs (30j)
                    </p>
                  </div>
                </button>
                {link && (
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl"
                    style={{ background: "var(--g-libre-bg)", color: "var(--g-libre)" }}
                    aria-label="WhatsApp"
                  >
                    <MessageCircle className="w-5 h-5" />
                  </a>
                )}
              </li>
            );
          })}
          {!loading && joueurs.length === 0 && (
            <li className="text-sm text-center py-6" style={{ color: "var(--g-muted)" }}>
              Aucun joueur récent
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
