import { useEffect, useMemo, useState } from "react";
import { Camera, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { gerantApi, profilApi } from "@/lib/api";
import WhatsAppGerantCard from "@/espaces/backoffice/components/WhatsAppGerantCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PasswordBlock } from "@/espaces/profil/ProfileBlocks";
import { cn } from "@/lib/utils";

type Horaire = {
  jour: string;
  est_ouvert: number | boolean;
  heure_debut: string;
  heure_fin: string;
};

const JOURS_ORDRE = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
] as const;

const JOUR_LABELS: Record<string, string> = {
  lundi: "Lundi",
  mardi: "Mardi",
  mercredi: "Mercredi",
  jeudi: "Jeudi",
  vendredi: "Vendredi",
  samedi: "Samedi",
  dimanche: "Dimanche",
};

const RETARD_OPTIONS = [
  { value: 0, label: "0 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 45, label: "45 min" },
  { value: 60, label: "1h" },
];

function normalizeHoraires(raw: Horaire[]): Horaire[] {
  const byJour = new Map(raw.map((h) => [h.jour, h]));
  return JOURS_ORDRE.map((jour) => {
    const existing = byJour.get(jour);
    return {
      jour,
      est_ouvert: existing ? (existing.est_ouvert ? 1 : 0) : jour === "dimanche" ? 0 : 1,
      heure_debut: String(existing?.heure_debut || "08:00").slice(0, 5),
      heure_fin: String(existing?.heure_fin || "23:00").slice(0, 5),
    };
  });
}

function isOpen(h: Horaire) {
  return Boolean(h.est_ouvert);
}

export default function ParametresGerant() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [horaires, setHoraires] = useState<Horaire[]>([]);
  const [selectedJour, setSelectedJour] = useState<string>("lundi");
  const [terrain, setTerrain] = useState<{ nom?: string; adresse?: string; ville?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retard, setRetard] = useState(30);
  const [account, setAccount] = useState<{ prenom?: string; nom?: string; telephone?: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    const key = `gerant-fenetre-retard-${user?.id || "x"}`;
    const stored = Number(localStorage.getItem(key));
    if ([0, 15, 30, 45, 60].includes(stored)) setRetard(stored);

    Promise.all([gerantApi.dashboard(), profilApi.getGerant(), gerantApi.getFenetreRetard().catch(() => null)])
      .then(([dash, profil, fenetre]) => {
        if (!mounted) return;
        const list = normalizeHoraires(((dash as any)?.horaires || []) as Horaire[]);
        setHoraires(list);
        const todayKey = JOURS_ORDRE[(new Date().getDay() + 6) % 7];
        setSelectedJour(list.find((h) => h.jour === todayKey)?.jour || "lundi");
        setTerrain((dash as any)?.terrain || null);
        setAccount((profil as any)?.account || null);
        const apiRetard = Number((fenetre as any)?.fenetre_retard);
        if ([0, 15, 30, 45, 60].includes(apiRetard)) setRetard(apiRetard);
      })
      .catch(() => {
        toast.error("Impossible de charger les paramètres");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const selectedHoraire = useMemo(
    () => horaires.find((h) => h.jour === selectedJour) || horaires[0],
    [horaires, selectedJour],
  );

  const updateHoraire = (jour: string, patch: Partial<Horaire>) => {
    setHoraires((prev) => prev.map((h) => (h.jour === jour ? { ...h, ...patch } : h)));
  };

  /** Copie ouverture/fermeture du jour sélectionné → tous les jours actifs uniquement. */
  const applySelectedToActiveWeek = () => {
    const source = selectedHoraire;
    if (!source || !isOpen(source)) {
      toast.error("Sélectionne un jour ouvert comme modèle");
      return;
    }
    setHoraires((prev) =>
      prev.map((h) => {
        if (!isOpen(h)) return h;
        return {
          ...h,
          heure_debut: source.heure_debut,
          heure_fin: source.heure_fin,
        };
      }),
    );
    toast.success("Horaires appliqués à toute la semaine ✓");
  };

  const saveHoraires = async () => {
    for (const h of horaires) {
      if (isOpen(h) && h.heure_debut >= h.heure_fin) {
        toast.error(`${JOUR_LABELS[h.jour] || h.jour} : l'ouverture doit précéder la fermeture`);
        return;
      }
    }
    setSaving(true);
    try {
      await gerantApi.updateHoraires(horaires);
      toast.success("Horaires enregistrés");
    } catch (err: any) {
      toast.error(err?.message || "Sauvegarde impossible");
    } finally {
      setSaving(false);
    }
  };

  const saveRetard = async (value: number) => {
    setRetard(value);
    try {
      await gerantApi.saveFenetreRetard(value);
      localStorage.setItem(`gerant-fenetre-retard-${user?.id || "x"}`, String(value));
      toast.success("Fenêtre de retard enregistrée (appliquee aux créneaux)");
    } catch (err: any) {
      toast.error(err?.message || "Impossible d'enregistrer la fenêtre");
    }
  };

  if (loading) {
    return (
      <div className="p-4 space-y-3 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-xl" style={{ background: "var(--g-surface-2)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-8">
      <h1 className="text-lg font-bold" style={{ color: "var(--g-text)", fontFamily: "var(--font-display)" }}>
        Paramètres
      </h1>

      <section
        className="rounded-xl p-3 opacity-90"
        style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
      >
        <p className="text-xs font-semibold mb-2" style={{ color: "var(--g-muted)" }}>
          Connexion WhatsApp
        </p>
        <WhatsAppGerantCard />
      </section>

      <section className="rounded-xl p-4" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
        <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--g-text)" }}>
          Horaires d&apos;ouverture
        </h2>
        <p className="text-[11px] mb-3" style={{ color: "var(--g-muted)" }}>
          Plages où les créneaux peuvent être proposés. Touche un jour pour le prendre comme modèle.
        </p>

        <div className="space-y-2">
          {horaires.map((h) => {
            const ouvert = isOpen(h);
            const selected = selectedJour === h.jour;
            return (
              <div
                key={h.jour}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedJour(h.jour)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedJour(h.jour);
                  }
                }}
                className={cn(
                  "rounded-xl px-3 py-2.5 transition-colors",
                  selected && "ring-2 ring-[var(--g-primary)]",
                )}
                style={{
                  background: ouvert ? "var(--g-surface-2)" : "color-mix(in srgb, var(--g-surface-2) 70%, transparent)",
                  opacity: ouvert ? 1 : 0.72,
                }}
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={ouvert}
                    aria-label={`${JOUR_LABELS[h.jour]} ${ouvert ? "ouvert" : "fermé"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateHoraire(h.jour, { est_ouvert: ouvert ? 0 : 1 });
                      setSelectedJour(h.jour);
                    }}
                    className={cn(
                      "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                      ouvert ? "bg-[var(--g-primary)]" : "bg-[var(--g-border)]",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
                        ouvert ? "translate-x-5" : "translate-x-0.5",
                      )}
                    />
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
                      {JOUR_LABELS[h.jour] || h.jour}
                      {selected ? (
                        <span className="ml-2 text-[10px] font-medium" style={{ color: "var(--g-primary)" }}>
                          modèle
                        </span>
                      ) : null}
                    </p>
                    {!ouvert ? (
                      <p className="text-xs mt-0.5" style={{ color: "var(--g-muted)" }}>
                        Fermé ce jour
                      </p>
                    ) : (
                      <div
                        className="mt-2 flex items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="time"
                          value={h.heure_debut}
                          onChange={(e) => updateHoraire(h.jour, { heure_debut: e.target.value })}
                          className="h-10 flex-1 px-2 rounded-lg text-sm outline-none"
                          style={{
                            background: "var(--g-surface)",
                            color: "var(--g-text)",
                            border: "1px solid var(--g-border)",
                          }}
                        />
                        <span className="text-xs" style={{ color: "var(--g-muted)" }}>
                          →
                        </span>
                        <input
                          type="time"
                          value={h.heure_fin}
                          onChange={(e) => updateHoraire(h.jour, { heure_fin: e.target.value })}
                          className="h-10 flex-1 px-2 rounded-lg text-sm outline-none"
                          style={{
                            background: "var(--g-surface)",
                            color: "var(--g-text)",
                            border: "1px solid var(--g-border)",
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={applySelectedToActiveWeek}
          className="mt-3 w-full min-h-[44px] rounded-xl text-sm font-semibold"
          style={{ background: "var(--g-surface-2)", color: "var(--g-text-2)" }}
        >
          Appliquer à toute la semaine
          {selectedHoraire ? (
            <span className="font-normal opacity-70"> ({JOUR_LABELS[selectedHoraire.jour]})</span>
          ) : null}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={saveHoraires}
          className="mt-2 w-full min-h-[48px] rounded-xl text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--g-primary)" }}
        >
          {saving ? "Enregistrement…" : "Enregistrer les horaires"}
        </button>
      </section>

      <section className="rounded-xl p-4" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
        <label className="text-sm font-semibold block" style={{ color: "var(--g-text)" }}>
          Fenêtre de retard habituelle
        </label>
        <p className="text-[11px] mt-1 mb-3" style={{ color: "var(--g-muted)" }}>
          Temps accordé après l&apos;heure prévue avant le match suivant
        </p>
        <select
          value={retard}
          onChange={(e) => saveRetard(Number(e.target.value))}
          className="w-full h-12 rounded-xl px-3 text-sm outline-none"
          style={{
            background: "var(--g-surface-2)",
            color: "var(--g-text)",
            border: "1px solid var(--g-border)",
          }}
        >
          {RETARD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </section>

      <section className="rounded-xl p-4 space-y-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
          Profil terrain
        </h2>
        <div>
          <p className="text-xs" style={{ color: "var(--g-muted)" }}>
            Nom du terrain
          </p>
          <p className="text-sm font-medium" style={{ color: "var(--g-text)" }}>
            {terrain?.nom || "—"}
          </p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--g-muted)" }}>
            Quartier
          </p>
          <p className="text-sm font-medium" style={{ color: "var(--g-text)" }}>
            {terrain?.adresse || terrain?.ville || "—"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/profil/gerant")}
          className="w-full min-h-[44px] rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2"
          style={{ background: "var(--g-surface-2)", color: "var(--g-text-2)" }}
        >
          <Camera className="w-4 h-4" />
          Photo de profil
        </button>
      </section>

      <section className="rounded-xl p-4 space-y-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
          Compte
        </h2>
        <div>
          <p className="text-xs" style={{ color: "var(--g-muted)" }}>
            Nom et prénom
          </p>
          <p className="text-sm font-medium" style={{ color: "var(--g-text)" }}>
            {[account?.prenom || user?.prenom, account?.nom || user?.nom].filter(Boolean).join(" ") || "—"}
          </p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--g-muted)" }}>
            Téléphone
          </p>
          <p className="text-sm font-medium" style={{ color: "var(--g-text)" }}>
            {account?.telephone || user?.telephone || "—"}
          </p>
        </div>
        <div className="pt-1">
          <PasswordBlock />
        </div>
        <div className="flex items-center justify-between gap-3 py-2">
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--g-text)" }}>
              Apparence
            </p>
            <p className="text-xs" style={{ color: "var(--g-muted)" }}>
              Clair / sombre
            </p>
          </div>
          <ThemeToggle />
        </div>
        <button
          type="button"
          onClick={() => logout()}
          className="w-full min-h-[48px] rounded-xl text-sm font-semibold text-white inline-flex items-center justify-center gap-2"
          style={{ background: "var(--g-danger)" }}
        >
          <LogOut className="w-4 h-4" />
          Se déconnecter
        </button>
      </section>
    </div>
  );
}
