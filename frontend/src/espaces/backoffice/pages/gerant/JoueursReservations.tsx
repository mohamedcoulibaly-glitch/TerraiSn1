import { useEffect, useState } from "react";
import { ArrowLeft, MessageCircle, Search } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { gerantApi } from "@/lib/api";
import { formatPhoneDisplay, toLocal9 } from "@/auth/phone";
import { FicheBlocageGroupe } from "@/espaces/backoffice/components/FicheBlocageGroupe";

type Onglet = "reservations" | "joueurs";
type ResaSous = "matchs" | "abonnements" | "tournois";

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
  montant_total?: number;
};

type JoueurRow = {
  id: number;
  display_nom: string;
  telephone?: string | null;
  reservations_total?: number;
  last_reservation_at?: string | null;
};

type FicheData = {
  joueur: { display_nom?: string; nom?: string; telephone?: string | null };
  reservations: Reservation[];
};

type GroupeRow = {
  id: string;
  type_blocage: string;
  libelle?: string | null;
  date_debut?: string;
  date_fin?: string;
  heure_debut?: string;
  heure_fin?: string;
  montant_contrat?: number;
  montant_encaisse?: number;
  reste_a_encaisser?: number;
  nb_creneaux?: number;
};

const RESA_SOUS: ReadonlyArray<{ id: ResaSous; label: string }> = [
  { id: "matchs", label: "Matchs" },
  { id: "abonnements", label: "Abonnements" },
  { id: "tournois", label: "Tournois" },
];

const RESA_FILTERS = [
  { id: "all", label: "Toutes" },
  { id: "confirme", label: "Confirmées" },
  { id: "en_attente", label: "En attente" },
  { id: "joue", label: "Jouées" },
  { id: "annulee", label: "Annulées" },
] as const;

const JOUEUR_FILTERS = [
  { id: "all", label: "Tous" },
  { id: "frequents", label: "Joueurs fréquents" },
  { id: "nouveaux", label: "Nouveaux ce mois" },
] as const;

function statusUi(statut?: string) {
  if (statut === "confirme" || statut === "acceptee") {
    return { label: "Confirmée", color: "var(--g-reserve)", bg: "var(--g-reserve-bg)" };
  }
  if (statut === "en_attente") {
    return { label: "En attente de paiement", color: "var(--g-en-attente)", bg: "var(--g-en-attente-bg)" };
  }
  if (statut === "match_joue" || statut === "joue") {
    return { label: "Jouée", color: "var(--g-termine)", bg: "var(--g-termine-bg)" };
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

function fcfa(n?: number) {
  return `${Number(n || 0).toLocaleString("fr-FR")} FCFA`;
}

function formatDateHeure(date?: string, heure?: string) {
  if (!date) return "—";
  const d = new Date(`${date}T12:00:00`);
  const jour = Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const h = String(heure || "").slice(0, 5);
  return h ? `${h} · ${jour}` : jour;
}

function initials(nom?: string) {
  return String(nom || "J")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "J";
}

function PhoneSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative mt-3">
      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--g-muted)" }} />
      <span className="absolute left-9 top-1/2 -translate-y-1/2 text-xs font-semibold" style={{ color: "var(--g-muted)" }}>
        +221
      </span>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        value={formatPhoneDisplay(value)}
        onChange={(e) => onChange(toLocal9(e.target.value))}
        placeholder={placeholder}
        className="w-full h-12 pl-[4.25rem] pr-3 rounded-xl text-sm outline-none"
        style={{
          background: "var(--g-surface)",
          border: "1px solid var(--g-border)",
          color: "var(--g-text)",
          boxShadow: "var(--g-shadow)",
        }}
      />
    </div>
  );
}

function Pills<T extends string>({
  items,
  value,
  onChange,
}: {
  items: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-none">
      {items.map((f) => {
        const actif = value === f.id;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange(f.id)}
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
  );
}

function ListSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-24 rounded-2xl" style={{ background: "var(--g-surface-2)" }} />
      ))}
    </div>
  );
}

function FicheJoueur({ id }: { id: number }) {
  const navigate = useNavigate();
  const [data, setData] = useState<FicheData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    gerantApi
      .joueurDetail(id)
      .then((payload) => {
        if (!mounted) return;
        setData(payload as FicheData);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Impossible de charger ce joueur");
        setData(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [id]);

  const nom = data?.joueur.display_nom || data?.joueur.nom || "Joueur";
  const link = waLink(data?.joueur.telephone);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate("/backoffice/gerant/joueurs")}
        className="inline-flex items-center gap-1 text-sm font-semibold min-h-[44px]"
        style={{ color: "var(--g-primary)" }}
      >
        <ArrowLeft className="w-4 h-4" />
        Joueurs
      </button>

      {loading ? (
        <ListSkeleton />
      ) : error ? (
        <p className="text-sm text-center py-8" style={{ color: "var(--g-danger)" }}>
          {error}
        </p>
      ) : !data ? (
        <p className="text-sm text-center py-8" style={{ color: "var(--g-muted)" }}>
          Joueur introuvable sur ce terrain
        </p>
      ) : (
        <>
          <section
            className="rounded-2xl p-4 flex items-center gap-3"
            style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
          >
            <span
              className="w-12 h-12 rounded-full inline-flex items-center justify-center text-sm font-bold shrink-0"
              style={{ background: "var(--g-primary-glow)", color: "var(--g-primary)" }}
            >
              {initials(nom)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold truncate" style={{ color: "var(--g-text)" }}>
                {nom}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--g-muted)" }}>
                {data.joueur.telephone || "Pas de téléphone"}
              </p>
            </div>
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
          </section>

          <section>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--g-text)" }}>
              Historique sur ce terrain
            </h2>
            {data.reservations.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: "var(--g-muted)" }}>
                Aucune réservation sur ce terrain
              </p>
            ) : (
              <ul className="space-y-2">
                {data.reservations.map((r) => {
                  const ui = statusUi(r.statut);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/backoffice/gerant/reservations/${r.id}`)}
                        className="w-full text-left rounded-xl p-3.5"
                        style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
                            {formatDateHeure(r.date, r.heure_debut)}
                          </p>
                          <span
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                            style={{ background: ui.bg, color: ui.color }}
                          >
                            {ui.label}
                          </span>
                        </div>
                        <p className="text-xs mt-1" style={{ color: "var(--g-muted)" }}>
                          Avance {fcfa(r.montant_avance)} · Reste {fcfa(r.montant_restant)}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default function JoueursReservationsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const selectedId = id ? Number(id) : null;

  const [onglet, setOnglet] = useState<Onglet>(() => {
    try {
      return sessionStorage.getItem("gerant-jv-onglet") === "joueurs" ? "joueurs" : "reservations";
    } catch {
      return "reservations";
    }
  });

  const [resaSous, setResaSous] = useState<ResaSous>(() => {
    try {
      const stored = sessionStorage.getItem("gerant-jv-sous");
      if (stored === "abonnements" || stored === "tournois" || stored === "matchs") return stored;
    } catch {
      /* ignore */
    }
    return "matchs";
  });
  const [selectedGroupeId, setSelectedGroupeId] = useState<string | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem("gerant-jv-onglet", onglet);
    } catch {
      /* ignore */
    }
  }, [onglet]);

  useEffect(() => {
    try {
      sessionStorage.setItem("gerant-jv-sous", resaSous);
    } catch {
      /* ignore */
    }
  }, [resaSous]);

  const [resaFilter, setResaFilter] = useState<(typeof RESA_FILTERS)[number]["id"]>("all");
  const [resaQ, setResaQ] = useState("");
  const [resaDebounced, setResaDebounced] = useState("");
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [resaLoading, setResaLoading] = useState(false);
  const [resaError, setResaError] = useState("");
  const [groupes, setGroupes] = useState<GroupeRow[]>([]);
  const [groupesLoading, setGroupesLoading] = useState(false);
  const [groupesError, setGroupesError] = useState("");

  const [joueurFilter, setJoueurFilter] = useState<(typeof JOUEUR_FILTERS)[number]["id"]>("all");
  const [joueurQ, setJoueurQ] = useState("");
  const [joueurDebounced, setJoueurDebounced] = useState("");
  const [joueurs, setJoueurs] = useState<JoueurRow[]>([]);
  const [joueursLoading, setJoueursLoading] = useState(false);
  const [joueursError, setJoueursError] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setResaDebounced(resaQ), 300);
    return () => window.clearTimeout(t);
  }, [resaQ]);

  useEffect(() => {
    const t = window.setTimeout(() => setJoueurDebounced(joueurQ), 300);
    return () => window.clearTimeout(t);
  }, [joueurQ]);

  useEffect(() => {
    if (selectedId || selectedGroupeId || onglet !== "reservations" || resaSous !== "matchs") return;
    let mounted = true;
    setResaLoading(true);
    setResaError("");
    gerantApi
      .reservationsList({ statut: resaFilter, q: resaDebounced || undefined })
      .then((payload) => {
        if (!mounted) return;
        setReservations(((payload as { reservations?: Reservation[] }).reservations || []) as Reservation[]);
      })
      .catch((err) => {
        if (!mounted) return;
        setReservations([]);
        setResaError(err instanceof Error ? err.message : "Impossible de charger les réservations");
      })
      .finally(() => {
        if (mounted) setResaLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [selectedId, selectedGroupeId, onglet, resaSous, resaFilter, resaDebounced]);

  useEffect(() => {
    if (selectedId || selectedGroupeId || onglet !== "reservations") return;
    if (resaSous !== "abonnements" && resaSous !== "tournois") return;
    let mounted = true;
    setGroupesLoading(true);
    setGroupesError("");
    gerantApi
      .listBlocageGroupes(resaSous === "tournois" ? "TOURNOI" : "ABONNEMENT")
      .then((payload) => {
        if (!mounted) return;
        setGroupes(((payload as { groupes?: GroupeRow[] }).groupes || []) as GroupeRow[]);
      })
      .catch((err) => {
        if (!mounted) return;
        setGroupes([]);
        setGroupesError(err instanceof Error ? err.message : "Impossible de charger la liste");
      })
      .finally(() => {
        if (mounted) setGroupesLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [selectedId, selectedGroupeId, onglet, resaSous]);

  useEffect(() => {
    if (selectedId || onglet !== "joueurs") return;
    let mounted = true;
    setJoueursLoading(true);
    setJoueursError("");
    gerantApi
      .joueurs({ filter: joueurFilter, q: joueurDebounced || undefined })
      .then((payload) => {
        if (!mounted) return;
        setJoueurs(((payload as { joueurs?: JoueurRow[] }).joueurs || []) as JoueurRow[]);
      })
      .catch((err) => {
        if (!mounted) return;
        setJoueurs([]);
        setJoueursError(err instanceof Error ? err.message : "Impossible de charger les joueurs");
      })
      .finally(() => {
        if (mounted) setJoueursLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [selectedId, onglet, joueurFilter, joueurDebounced]);

  if (selectedId) {
    return <FicheJoueur id={selectedId} />;
  }

  if (selectedGroupeId) {
    return (
      <FicheBlocageGroupe
        id={selectedGroupeId}
        onBack={() => setSelectedGroupeId(null)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold leading-tight" style={{ color: "var(--g-text)", fontFamily: "var(--font-display)" }}>
          Joueurs & Ventes
        </h1>
        <div className="mt-3 flex gap-6 border-b" style={{ borderColor: "var(--g-border)" }}>
          {([
            { id: "reservations" as const, label: "Réservations" },
            { id: "joueurs" as const, label: "Joueurs" },
          ]).map((tab) => {
            const actif = onglet === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setOnglet(tab.id)}
                className="pb-2 text-sm font-semibold min-h-[44px]"
                style={{
                  color: actif ? "var(--g-primary)" : "var(--g-muted)",
                  borderBottom: actif ? "2px solid var(--g-primary)" : "2px solid transparent",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {onglet === "reservations" ? (
        <>
          <Pills items={RESA_SOUS} value={resaSous} onChange={setResaSous} />
          {resaSous === "matchs" ? (
            <>
              <PhoneSearch value={resaQ} onChange={setResaQ} placeholder="7X XXX XX XX" />
              <Pills items={RESA_FILTERS} value={resaFilter} onChange={setResaFilter} />
              {resaLoading ? (
                <ListSkeleton />
              ) : resaError ? (
                <p className="text-sm text-center py-8" style={{ color: "var(--g-danger)" }}>
                  {resaError}
                </p>
              ) : reservations.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: "var(--g-muted)" }}>
                  Aucun match
                </p>
              ) : (
                <section className="space-y-3">
                  {reservations.map((r) => {
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
                              {formatDateHeure(r.date, r.heure_debut)}
                            </p>
                            <p className="text-xs mt-0.5" style={{ color: "var(--g-muted)" }}>
                              {r.joueur_nom || "Joueur"}
                            </p>
                          </div>
                          <span
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                            style={{ background: ui.bg, color: ui.color }}
                          >
                            {ui.label}
                          </span>
                        </div>
                        <p className="text-xs mt-2" style={{ color: "var(--g-text-2)" }}>
                          Avance {fcfa(r.montant_avance)} · Reste {fcfa(r.montant_restant)}
                        </p>
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
                  })}
                </section>
              )}
            </>
          ) : groupesLoading ? (
            <ListSkeleton />
          ) : groupesError ? (
            <p className="text-sm text-center py-8" style={{ color: "var(--g-danger)" }}>
              {groupesError}
            </p>
          ) : groupes.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: "var(--g-muted)" }}>
              {resaSous === "tournois" ? "Aucun tournoi" : "Aucun abonnement"}
            </p>
          ) : (
            <section className="space-y-3">
              {groupes.map((g) => {
                const encaisse = Number(g.montant_encaisse || 0);
                const contrat = Number(g.montant_contrat || 0);
                return (
                  <article
                    key={g.id}
                    className="rounded-2xl p-3.5"
                    style={{
                      background: "var(--g-surface)",
                      boxShadow: "var(--g-shadow)",
                      borderLeft: "4px solid var(--g-bloque)",
                    }}
                  >
                    <p className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
                      {g.libelle || (resaSous === "tournois" ? "Tournoi" : "Abonnement")}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--g-muted)" }}>
                      {String(g.date_debut || "").slice(0, 10)} → {String(g.date_fin || "").slice(0, 10)}
                      {g.heure_debut ? ` · ${String(g.heure_debut).slice(0, 5)} → ${String(g.heure_fin || "").slice(0, 5)}` : ""}
                    </p>
                    <p className="text-xs mt-2" style={{ color: encaisse > 0 ? "var(--g-text-2)" : "var(--g-muted)" }}>
                      {encaisse > 0
                        ? `Encaissé ${fcfa(encaisse)}${contrat > 0 ? ` · Prévu ${fcfa(contrat)}` : ""}`
                        : resaSous === "tournois"
                          ? "Aucun montant encaissé pour ce tournoi"
                          : "Aucun montant encaissé pour cet abonnement"}
                    </p>
                    <button
                      type="button"
                      onClick={() => setSelectedGroupeId(g.id)}
                      className="mt-3 w-full min-h-[44px] rounded-xl text-sm font-semibold"
                      style={{ color: "var(--g-muted)", border: "1px solid var(--g-border)" }}
                    >
                      Ouvrir la fiche
                    </button>
                  </article>
                );
              })}
            </section>
          )}
        </>
      ) : (
        <>
          <PhoneSearch value={joueurQ} onChange={setJoueurQ} placeholder="7X XXX XX XX" />
          <Pills items={JOUEUR_FILTERS} value={joueurFilter} onChange={setJoueurFilter} />
          {joueursLoading ? (
            <ListSkeleton />
          ) : joueursError ? (
            <p className="text-sm text-center py-8" style={{ color: "var(--g-danger)" }}>
              {joueursError}
            </p>
          ) : joueurs.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: "var(--g-muted)" }}>
              Aucun joueur
            </p>
          ) : (
            <ul className="space-y-2">
              {joueurs.map((j) => {
                const link = waLink(j.telephone);
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
                        {initials(j.display_nom)}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: "var(--g-text)" }}>
                          {j.display_nom}
                        </p>
                        <p className="text-xs" style={{ color: "var(--g-muted)" }}>
                          {j.telephone || "—"} · {j.reservations_total || 0} réservation{(j.reservations_total || 0) > 1 ? "s" : ""}
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: "var(--g-muted)" }}>
                          Dernière : {j.last_reservation_at ? formatDateHeure(String(j.last_reservation_at).slice(0, 10), String(j.last_reservation_at).slice(11, 16)) : "—"}
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
            </ul>
          )}
        </>
      )}
    </div>
  );
}
