import { useEffect, useMemo, useState } from "react";
import { Camera, LogOut } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { gerantApi, profilApi } from "@/lib/api";
import WhatsAppGerantCard from "@/espaces/backoffice/components/WhatsAppGerantCard";
import GerantPhotosSection from "@/espaces/backoffice/components/GerantPhotosSection";
import GerantCommoditesSection from "@/espaces/backoffice/components/GerantCommoditesSection";
import BloquerCreneauModal from "@/espaces/backoffice/components/BloquerCreneauModal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PasswordBlock } from "@/espaces/profil/ProfileBlocks";
import { ConfirmationModal } from "@/espaces/backoffice/components/ConfirmationModal";
import { GSwitch } from "@/espaces/backoffice/components/GSwitch";
import GrilleTarifaireCard from "@/espaces/backoffice/components/GrilleTarifaireCard";
import {
  emptyGrilleValues,
  type GrilleValues,
} from "@/espaces/backoffice/components/GrilleTarifaireForm";
import { cn } from "@/lib/utils";
import Select2 from "@/components/Select2";

const JOURS_GARDE = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;

function MonPlanningGardeSection() {
  const { user } = useAuth();
  const [data, setData] = useState<{
    planning: any[];
    collegues: any[];
    garde_actuelle: any;
    multi_gerants: boolean;
  } | null>(null);

  useEffect(() => {
    gerantApi
      .planning()
      .then((payload) => setData(payload as any))
      .catch(() => setData(null));
  }, []);

  if (!data?.multi_gerants) return null;

  const myId = Number(user?.id);
  const mine = (data.planning || []).filter((p) => Number(p.gerant_id) === myId);
  const hebdo = JOURS_GARDE.map((_, i) => {
    const slot = mine.find((p) => p.jour_semaine != null && Number(p.jour_semaine) === i && !p.date_specifique);
    return slot
      ? { actif: true, debut: String(slot.heure_debut || "").slice(0, 5), fin: String(slot.heure_fin || "").slice(0, 5) }
      : { actif: false, debut: "", fin: "" };
  });
  const jeSuisDeGarde = Number(data.garde_actuelle?.gerant_id) === myId;

  return (
    <div className="mt-4 pt-4 space-y-3" style={{ borderTop: "1px solid var(--g-border)" }}>
      <h3 className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
        Mon planning de garde
      </h3>
      <p className="text-[12px]" style={{ color: "var(--g-muted)" }}>
        Ton terrain a {data.collegues.length} gérants. Voici ton planning de garde configuré par
        l&apos;administration.
      </p>
      {jeSuisDeGarde ? (
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full animate-pulse"
          style={{ background: "color-mix(in srgb, var(--g-primary) 14%, transparent)", color: "var(--g-primary)" }}
        >
          De garde maintenant
        </span>
      ) : null}
      <div className="grid grid-cols-7 gap-1">
        {hebdo.map((h, i) => (
          <div
            key={JOURS_GARDE[i]}
            className="rounded-lg p-1.5 text-center"
            style={{
              background: h.actif
                ? "color-mix(in srgb, var(--g-primary) 12%, transparent)"
                : "var(--g-surface-2)",
              opacity: h.actif ? 1 : 0.55,
            }}
          >
            <p className="text-[10px] font-semibold" style={{ color: "var(--g-text)" }}>
              {JOURS_GARDE[i]}
            </p>
            {h.actif ? (
              <p className="text-[9px] mt-0.5" style={{ color: "var(--g-muted)" }}>
                {h.debut || "—"}
                <br />
                {h.fin || ""}
              </p>
            ) : (
              <p className="text-[9px] mt-0.5" style={{ color: "var(--g-muted)" }}>
                —
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] italic" style={{ color: "var(--g-muted)" }}>
        Pour modifier ton planning, contacte l&apos;administration
      </p>
    </div>
  );
}

type TarifsLite = {
  prix_entier_base?: number;
  prix_moitie_base?: number;
  pourcentage_avance?: number;
  grille_standard?: GrilleValues;
};

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

const PARAM_SECTIONS = [
  { id: "compte", label: "Compte" },
  { id: "terrain", label: "Mon terrain" },
  { id: "creneaux", label: "Créneaux" },
  { id: "equipements", label: "Équipements" },
  { id: "photos", label: "Photos" },
  { id: "notifications", label: "Notifications" },
] as const;

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
  const location = useLocation();
  const { user, logout } = useAuth();
  const [horaires, setHoraires] = useState<Horaire[]>([]);
  const [selectedJour, setSelectedJour] = useState<string>("lundi");
  const [terrain, setTerrain] = useState<{
    id?: number;
    nom?: string;
    adresse?: string;
    ville?: string;
    quartier?: string;
    type?: string;
    surface?: string;
    delai_remboursement_heures?: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retard, setRetard] = useState(30);
  const [account, setAccount] = useState<{ prenom?: string; nom?: string; telephone?: string; email?: string } | null>(null);
  const [tarifs, setTarifs] = useState<TarifsLite | null>(null);
  const [grille, setGrille] = useState<GrilleValues>(emptyGrilleValues());
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    const key = `gerant-fenetre-retard-${user?.id || "x"}`;
    const stored = Number(localStorage.getItem(key));
    if ([0, 15, 30, 45, 60].includes(stored)) setRetard(stored);

    Promise.all([
      gerantApi.dashboard(),
      profilApi.getGerant(),
      gerantApi.getFenetreRetard().catch(() => null),
      gerantApi.getTarifs().catch(() => null),
    ])
      .then(([dash, profil, fenetre, grille]) => {
        if (!mounted) return;
        const list = normalizeHoraires(((dash as any)?.horaires || []) as Horaire[]);
        setHoraires(list);
        const todayKey = JOURS_ORDRE[(new Date().getDay() + 6) % 7];
        setSelectedJour(list.find((h) => h.jour === todayKey)?.jour || "lundi");
        setTerrain((dash as any)?.terrain || null);
        setAccount((profil as any)?.account || null);
        const apiRetard = Number((fenetre as any)?.fenetre_retard);
        if ([0, 15, 30, 45, 60].includes(apiRetard)) setRetard(apiRetard);
        if (grille) {
          const lite = grille as TarifsLite;
          setTarifs(lite);
          setGrille(
            lite.grille_standard ||
              emptyGrilleValues({
                entier: Number(lite.prix_entier_base || 0),
                demi: Number(lite.prix_moitie_base || 0),
              }),
          );
        }
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

  useEffect(() => {
    if (loading) return;
    const raw = location.hash.replace("#", "");
    if (!raw) return;
    document.getElementById(`param-${raw}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash, loading]);

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
      <div className="space-y-3 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-xl" style={{ background: "var(--g-surface-2)" }} />
        ))}
      </div>
    );
  }

  const activeHash = (location.hash || "#compte").replace("#", "") || "compte";

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold leading-tight" style={{ color: "var(--g-text)", fontFamily: "var(--font-display)" }}>
        Paramètres
      </h1>

      <nav className="flex md:flex-col gap-1.5 overflow-x-auto pb-1 md:pb-0 md:sticky md:top-2">
        {PARAM_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => navigate({ pathname: location.pathname, search: location.search, hash: s.id })}
            className="shrink-0 px-3 min-h-[40px] rounded-full text-[12px] font-semibold md:rounded-xl md:text-left"
            style={{
              background: activeHash === s.id ? "var(--g-primary-glow)" : "var(--g-surface-2)",
              color: activeHash === s.id ? "var(--g-primary)" : "var(--g-muted)",
            }}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <section id="param-compte" className="scroll-mt-16 rounded-xl p-4 space-y-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>Compte</h2>
        <button type="button" onClick={() => navigate("/profil/gerant")} className="w-full min-h-[44px] rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2" style={{ background: "var(--g-surface-2)", color: "var(--g-text-2)" }}>
          <Camera className="w-4 h-4" /> Photo de profil
        </button>
        <div>
          <p className="text-xs" style={{ color: "var(--g-muted)" }}>Prénom, Nom</p>
          <p className="text-sm font-medium" style={{ color: "var(--g-text)" }}>
            {[account?.prenom || user?.prenom, account?.nom || user?.nom].filter(Boolean).join(" ") || "—"}
          </p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--g-muted)" }}>Téléphone</p>
          <p className="text-sm font-medium" style={{ color: "var(--g-text)" }}>{account?.telephone || user?.telephone || "—"}</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--g-muted)" }}>Email</p>
          <p className="text-sm font-medium" style={{ color: "var(--g-text)" }}>{account?.email || (user as { email?: string })?.email || "—"}</p>
        </div>
        <p className="text-[11px]" style={{ color: "var(--g-muted)" }}>Pour modifier tes infos, contacte l&apos;administration</p>
        <div className="pt-1"><PasswordBlock /></div>
        <div className="flex items-center justify-between gap-3 py-2">
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--g-text)" }}>Apparence</p>
            <p className="text-xs" style={{ color: "var(--g-muted)" }}>Clair / sombre</p>
          </div>
          <ThemeToggle />
        </div>
        <button type="button" onClick={() => setLogoutOpen(true)} className="w-full min-h-[48px] rounded-xl text-sm font-semibold text-white inline-flex items-center justify-center gap-2" style={{ background: "var(--g-danger)" }}>
          <LogOut className="w-4 h-4" /> Se déconnecter
        </button>
      </section>

      <section id="param-terrain" className="scroll-mt-16 space-y-4">
      <section className="rounded-xl p-4 space-y-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>Mon terrain</h2>
        <p className="text-sm font-medium" style={{ color: "var(--g-text)" }}>{terrain?.nom || "—"}</p>
        <p className="text-xs" style={{ color: "var(--g-muted)" }}>{terrain?.adresse || terrain?.quartier || terrain?.ville || "—"} · {terrain?.type || terrain?.surface || ""}</p>
        <p className="text-[11px]" style={{ color: "var(--g-muted)" }}>Pour modifier, contacte l&apos;administration</p>
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
                  <div
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <GSwitch
                      checked={ouvert}
                      label={`${JOUR_LABELS[h.jour]} ${ouvert ? "ouvert" : "fermé"}`}
                      onChange={(next) => {
                        updateHoraire(h.jour, { est_ouvert: next ? 1 : 0 });
                        setSelectedJour(h.jour);
                      }}
                    />
                  </div>

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
        <Select2
          value={String(retard)}
          onChange={(v) => saveRetard(Number(v))}
          options={RETARD_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
        />
      </section>

      <section className="rounded-xl px-3 py-3 space-y-2" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
            Grille tarifaire
          </h2>
        </div>

        <GrilleTarifaireCard grille={grille} />

        <p className="text-[11px] pt-0.5" style={{ color: "var(--g-muted)" }}>
          {Number(terrain?.delai_remboursement_heures) === 0
            ? "Annulation : pas de remboursement de l'avance."
            : `Annulation : remboursement dans les ${Number(terrain?.delai_remboursement_heures ?? 24)} h après confirmation.`}
          {tarifs?.pourcentage_avance != null
            ? ` · Avance ${Number(tarifs.pourcentage_avance)} %`
            : ""}
        </p>
      </section>
      </section>

      <section id="param-creneaux" className="scroll-mt-16 rounded-xl p-4 space-y-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>Créneaux</h2>
        <p className="text-[12px]" style={{ color: "var(--g-muted)" }}>
          Indisponibilité, tournoi ou abonnement : trois types distincts, visibles dans la file d&apos;attente.
        </p>
        <button type="button" onClick={() => setBlockOpen(true)} className="w-full min-h-[48px] rounded-xl text-sm font-semibold text-white" style={{ background: "var(--g-primary)" }}>
          Événements
        </button>
        <MonPlanningGardeSection />
      </section>

      <div id="param-equipements" className="scroll-mt-16">
        <GerantCommoditesSection />
      </div>

      <div id="param-photos" className="scroll-mt-16">
        <GerantPhotosSection />
      </div>

      <section id="param-notifications" className="scroll-mt-16 rounded-xl p-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
        <p className="text-xs font-semibold mb-2" style={{ color: "var(--g-muted)" }}>Notifications</p>
        <WhatsAppGerantCard />
      </section>

      <BloquerCreneauModal open={blockOpen} onClose={() => setBlockOpen(false)} terrainId={terrain?.id} />

      <ConfirmationModal
        ouvert={logoutOpen}
        titre="Tu pars déjà ? 👋"
        texte="Tu seras déconnecté. Tes données sont sauvegardées."
        labelAnnuler="Rester"
        labelConfirmer="Me déconnecter"
        variante="danger"
        onAnnuler={() => setLogoutOpen(false)}
        onConfirmer={() => {
          setLogoutOpen(false);
          logout();
        }}
      />
    </div>
  );
}
