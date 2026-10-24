import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  Clock3,
  LogOut,
  MessageCircle,
  Sparkles,
  UserRound,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { gerantApi, profilApi } from "@/lib/api";
import WhatsAppGerantCard from "@/espaces/backoffice/components/WhatsAppGerantCard";
import GerantPhotosSection from "@/espaces/backoffice/components/GerantPhotosSection";
import GerantCommoditesSection from "@/espaces/backoffice/components/GerantCommoditesSection";
import BloquerCreneauModal from "@/espaces/backoffice/components/BloquerCreneauModal";
import { ThemeToggle } from "@/components/ThemeToggle";
import PushPreferencesPanel from "@/components/pwa/PushPreferencesPanel";
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
import ContacterAdminCard from "./parametres/ContacterAdminCard";
import { SubView, Surface } from "./parametres/ParametresChrome";
import CardPlanningGerant from "@/espaces/backoffice/components/CardPlanningGerant";
import { labelNuitDuJourASuivant, optionsHeuresSelect2 } from "@/utils/heuresSelect2";

function estFermetureNuit(heureFin: string) {
  const h = parseInt(String(heureFin || "").substring(0, 2), 10);
  return Number.isFinite(h) && h >= 0 && h <= 5;
}

type SectionId = "hub" | "compte" | "terrain" | "horaires" | "equipements" | "photos" | "whatsapp";

type Horaire = {
  jour: string;
  est_ouvert: number | boolean;
  heure_debut: string;
  heure_fin: string;
};

type TarifsLite = {
  prix_entier_base?: number;
  prix_moitie_base?: number;
  pourcentage_avance?: number;
  grille_standard?: GrilleValues;
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

const JOURS_GARDE = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;

const RETARD_OPTIONS = [
  { value: 0, label: "0 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 45, label: "45 min" },
  { value: 60, label: "1 h" },
];

const HUB_CARDS: Array<{
  id: Exclude<SectionId, "hub">;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  accent: string;
}> = [
  { id: "compte", title: "Mon Compte", subtitle: "Mot de passe, profil", icon: UserRound, accent: "#2563eb" },
  { id: "terrain", title: "Mon Terrain", subtitle: "Infos & planning de garde", icon: Sparkles, accent: "#059669" },
  { id: "horaires", title: "Horaires d'ouverture", subtitle: "Plages d'ouverture", icon: Clock3, accent: "#d97706" },
  { id: "equipements", title: "Équipements", subtitle: "Services & aménagements", icon: Zap, accent: "#7c3aed" },
  { id: "photos", title: "Photos du terrain", subtitle: "Galerie", icon: Camera, accent: "#db2777" },
  { id: "whatsapp", title: "Connexion WhatsApp", subtitle: "Notifications", icon: MessageCircle, accent: "#16a34a" },
];

function MonPlanningGardeSection() {
  const { user } = useAuth();
  const [data, setData] = useState<{
    planning: any[];
    planning_equipe?: any[];
    collegues: any[];
    garde_actuelle: any;
    multi_gerants: boolean;
    terrain_id?: number | null;
    nb_gerants?: number;
    est_principal?: boolean;
    peut_modifier_planning?: boolean;
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    gerantApi
      .planning()
      .then((payload) => setData(payload as any))
      .catch(() => setData(null));
  }, [reloadKey]);

  if (!data?.multi_gerants) return null;

  const myId = Number(user?.id);
  const equipe = Array.isArray(data.planning_equipe) && data.planning_equipe.length
    ? data.planning_equipe
    : data.planning || [];
  const peutModifier = Boolean(data.peut_modifier_planning);
  const terrainId = Number(data.terrain_id || 0);

  const planning = JOURS_GARDE.map((_, i) => {
    const slot = equipe.find(
      (p) => p.jour_semaine != null && Number(p.jour_semaine) === i && !p.date_specifique,
    );
    if (!slot) {
      return { est_moi: false, gerant_prenom: "—", heure_debut: "", heure_fin: "", vide: true };
    }
    const estMoi = Number(slot.gerant_id) === myId;
    const prenom =
      String(slot.prenom || "").trim()
      || (data.collegues || []).find((c) => Number(c.gerant_id ?? c.id) === Number(slot.gerant_id))?.prenom
      || "Gérant";
    return {
      est_moi: estMoi,
      gerant_prenom: String(prenom).split(/\s+/)[0],
      heure_debut: String(slot.heure_debut || "").slice(0, 5),
      heure_fin: String(slot.heure_fin || "").slice(0, 5),
      vide: false,
    };
  });

  const jeSuisDeGarde = Number(data.garde_actuelle?.gerant_id) === myId;

  return (
    <Surface>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
          Planning de l&apos;équipe cette semaine
        </h3>
        {peutModifier ? (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0"
            style={{
              background: "color-mix(in srgb, var(--g-primary) 14%, transparent)",
              color: "var(--g-primary)",
            }}
          >
            Gérant principal
          </span>
        ) : null}
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--g-muted)" }}>
        Ton terrain a {data.collegues.length} gérants — qui est de garde chaque jour.
      </p>
      {jeSuisDeGarde ? (
        <span
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full animate-pulse mb-3"
          style={{
            background: "color-mix(in srgb, var(--g-primary) 14%, transparent)",
            color: "var(--g-primary)",
          }}
        >
          De garde maintenant
        </span>
      ) : null}

      <div className="grid grid-cols-7 gap-1 text-center text-xs mb-3">
        {JOURS_GARDE.map((j) => (
          <div key={j} className="font-semibold pb-1" style={{ color: "var(--g-muted)" }}>
            {j.charAt(0)}
          </div>
        ))}
        {planning.map((jour, i) => (
          <div
            key={JOURS_GARDE[i]}
            className="rounded-lg p-1 text-center min-h-[52px]"
            style={{
              background: jour.est_moi ? "var(--g-primary-glow)" : "var(--g-surface-2)",
              border: jour.est_moi ? "1px solid var(--g-primary)" : "1px solid var(--g-border)",
              opacity: jour.vide ? 0.55 : 1,
            }}
          >
            <div
              className="text-xs font-semibold truncate"
              style={{ color: jour.est_moi ? "var(--g-primary)" : "var(--g-text-2)" }}
            >
              {jour.vide ? "—" : jour.est_moi ? "Toi" : jour.gerant_prenom}
            </div>
            {!jour.vide && (jour.heure_debut || jour.heure_fin) ? (
              <div className="text-[10px] mt-0.5" style={{ color: "var(--g-muted)" }}>
                {jour.heure_debut || "—"}→{jour.heure_fin || "—"}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {terrainId > 0 && (data.collegues || []).length > 0 ? (
        <div className="mt-1">
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--g-text-2)" }}>
            {peutModifier ? "Modifier les gardes par gérant" : "Détail par gérant"}
          </p>
          {(data.collegues || []).map((c) => (
            <CardPlanningGerant
              key={c.gerant_id}
              terrainId={terrainId}
              gerant={c}
              estMoi={Number(c.gerant_id) === myId}
              planningEquipe={equipe}
              editable={peutModifier}
              onSaved={() => setReloadKey((k) => k + 1)}
            />
          ))}
          {peutModifier ? (
            <p
              className="text-xs mt-3 p-3 rounded-lg"
              style={{
                background: "color-mix(in srgb, var(--g-info) 12%, transparent)",
                color: "var(--g-info)",
              }}
            >
              Les plannings peuvent se chevaucher. En cas de chevauchement, les notifications
              partent au gérant dont la garde est la plus récente.
            </p>
          ) : (
            <>
              <p className="text-xs mt-3" style={{ color: "var(--g-muted)" }}>
                Pour modifier le planning, contacte le gérant principal ou l&apos;administration.
              </p>
              <ContacterAdminCard hint="Pour changer tes jours de garde, écris à l'administration." />
            </>
          )}
        </div>
      ) : null}
    </Surface>
  );
}

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
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, logout } = useAuth();
  const sectionFromUrl = searchParams.get("section");
  const initialSection: SectionId =
    sectionFromUrl === "whatsapp" ||
    sectionFromUrl === "compte" ||
    sectionFromUrl === "terrain" ||
    sectionFromUrl === "horaires" ||
    sectionFromUrl === "equipements" ||
    sectionFromUrl === "photos"
      ? sectionFromUrl
      : "hub";
  const [section, setSection] = useState<SectionId>(initialSection);
  const [horaires, setHoraires] = useState<Horaire[]>([]);
  const [selectedJour, setSelectedJour] = useState("lundi");
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
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retard, setRetard] = useState(30);
  const [account, setAccount] = useState<{
    prenom?: string;
    nom?: string;
    telephone?: string;
    email?: string;
  } | null>(null);
  const [tarifs, setTarifs] = useState<TarifsLite | null>(null);
  const [grille, setGrille] = useState<GrilleValues>(emptyGrilleValues());
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  useEffect(() => {
    const s = searchParams.get("section");
    if (
      s === "whatsapp" ||
      s === "compte" ||
      s === "terrain" ||
      s === "horaires" ||
      s === "equipements" ||
      s === "photos"
    ) {
      setSection(s);
    }
  }, [searchParams]);

  const openSection = (id: SectionId) => {
    setSection(id);
    if (id === "hub") {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ section: id }, { replace: true });
    }
  };

  const backToHub = () => openSection("hub");

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
      .then(([dash, profil, fenetre, tarifsPayload]) => {
        if (!mounted) return;
        const list = normalizeHoraires(((dash as any)?.horaires || []) as Horaire[]);
        setHoraires(list);
        const todayKey = JOURS_ORDRE[(new Date().getDay() + 6) % 7];
        setSelectedJour(list.find((h) => h.jour === todayKey)?.jour || "lundi");
        setTerrain((dash as any)?.terrain || null);
        setFeatures(
          (dash as any)?.features && typeof (dash as any).features === "object"
            ? (dash as any).features
            : {},
        );
        setAccount((profil as any)?.account || null);
        const apiRetard = Number((fenetre as any)?.fenetre_retard);
        if ([0, 15, 30, 45, 60].includes(apiRetard)) setRetard(apiRetard);
        if (tarifsPayload) {
          const lite = tarifsPayload as TarifsLite;
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
      .catch(() => toast.error("Impossible de charger les paramètres"))
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

  const copyToWholeWeek = () => {
    const source = selectedHoraire;
    if (!source || !isOpen(source)) {
      toast.error("Choisis d’abord un jour ouvert comme modèle");
      return;
    }
    setHoraires((prev) =>
      prev.map((h) =>
        isOpen(h) ? { ...h, heure_debut: source.heure_debut, heure_fin: source.heure_fin } : h,
      ),
    );
    toast.success("Horaires copiés sur toute la semaine ✓");
  };

  const saveHoraires = async () => {
    for (const h of horaires) {
      if (!isOpen(h) || estFermetureNuit(h.heure_fin)) continue;
      if (h.heure_debut >= h.heure_fin) {
        toast.error(`${JOUR_LABELS[h.jour] || h.jour} : l’ouverture doit être avant la fermeture`);
        return;
      }
    }
    setSaving(true);
    try {
      await gerantApi.updateHoraires(horaires);
      toast.success("Enregistré avec succès !");
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
      toast.success("Enregistré avec succès !");
    } catch (err: any) {
      toast.error(err?.message || "Impossible d’enregistrer");
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-2xl" style={{ background: "var(--g-surface-2)" }} />
        ))}
      </div>
    );
  }

  if (section === "hub") {
    return (
      <div className="space-y-5 pb-6">
        <div>
          <h1
            className="text-xl font-semibold leading-tight"
            style={{ color: "var(--g-text)", fontFamily: "var(--font-display)" }}
          >
            Paramètres
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--g-muted)" }}>
            Touche une carte pour régler ce dont tu as besoin.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {HUB_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => openSection(card.id)}
                className="text-left rounded-2xl p-4 min-h-[104px] flex items-center gap-4 transition-transform active:scale-[0.98]"
                style={{
                  background: "var(--g-surface)",
                  boxShadow: "var(--g-shadow)",
                  border: "1px solid var(--g-border)",
                }}
              >
                <span
                  className="w-14 h-14 rounded-2xl inline-flex items-center justify-center shrink-0"
                  style={{ background: `${card.accent}18`, color: card.accent }}
                >
                  <Icon className="w-7 h-7" />
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold" style={{ color: "var(--g-text)" }}>
                    {card.title}
                  </span>
                  <span className="block text-sm mt-0.5" style={{ color: "var(--g-muted)" }}>
                    {card.subtitle}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="pt-4 space-y-3">
          <button
            type="button"
            onClick={() => setLogoutOpen(true)}
            className="w-full min-h-[48px] rounded-xl text-base font-semibold text-white inline-flex items-center justify-center gap-2"
            style={{ background: "var(--g-danger)" }}
          >
            <LogOut className="w-5 h-5" /> Se déconnecter
          </button>
        </div>

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

  if (section === "compte") {
    return (
      <SubView title="Mon Compte" onBack={backToHub}>
        <Surface>
          <button
            type="button"
            onClick={() => navigate("/profil/gerant")}
            className="w-full min-h-[48px] rounded-xl text-base font-semibold inline-flex items-center justify-center gap-2"
            style={{ background: "var(--g-surface-2)", color: "var(--g-text)" }}
          >
            <Camera className="w-5 h-5" /> Photo de profil
          </button>
          <div>
            <p className="text-sm" style={{ color: "var(--g-muted)" }}>
              Prénom, Nom
            </p>
            <p className="text-base font-medium" style={{ color: "var(--g-text)" }}>
              {[account?.prenom || user?.prenom, account?.nom || user?.nom].filter(Boolean).join(" ") ||
                "—"}
            </p>
          </div>
          <div>
            <p className="text-sm" style={{ color: "var(--g-muted)" }}>
              Téléphone
            </p>
            <p className="text-base font-medium" style={{ color: "var(--g-text)" }}>
              {account?.telephone || user?.telephone || "—"}
            </p>
          </div>
          <div>
            <p className="text-sm" style={{ color: "var(--g-muted)" }}>
              Email
            </p>
            <p className="text-base font-medium" style={{ color: "var(--g-text)" }}>
              {account?.email || (user as { email?: string })?.email || "—"}
            </p>
          </div>
          <ContacterAdminCard hint="Nom, téléphone et email : seul l’admin peut les changer." />
          <div className="pt-1">
            <PasswordBlock />
          </div>
          <div className="flex items-center justify-between gap-3 py-2 min-h-[48px]">
            <div>
              <p className="text-base font-medium" style={{ color: "var(--g-text)" }}>
                Apparence
              </p>
              <p className="text-sm" style={{ color: "var(--g-muted)" }}>
                Clair / sombre
              </p>
            </div>
            <ThemeToggle />
          </div>
          <PushPreferencesPanel />
        </Surface>
      </SubView>
    );
  }

  if (section === "terrain") {
    return (
      <SubView title="Mon Terrain" onBack={backToHub}>
        <Surface>
          <p className="text-base font-semibold" style={{ color: "var(--g-text)" }}>
            {terrain?.nom || "—"}
          </p>
          <p className="text-sm" style={{ color: "var(--g-muted)" }}>
            {terrain?.adresse || terrain?.quartier || terrain?.ville || "—"}
            {terrain?.type || terrain?.surface ? ` · ${terrain?.type || terrain?.surface}` : ""}
          </p>
          <ContacterAdminCard hint="Le nom et l’adresse du terrain sont verrouillés." />
        </Surface>

        <Surface>
          <h2 className="text-base font-semibold" style={{ color: "var(--g-text)" }}>
            Prix affichés aux joueurs
          </h2>
          <GrilleTarifaireCard grille={grille} />
          <p className="text-sm" style={{ color: "var(--g-muted)" }}>
            {Number(terrain?.delai_remboursement_heures) === 0
              ? "Annulation : pas de remboursement de l’avance."
              : `Annulation : remboursement dans les ${Number(terrain?.delai_remboursement_heures ?? 24)} h après confirmation.`}
            {tarifs?.pourcentage_avance != null
              ? ` · Avance ${Number(tarifs.pourcentage_avance)} %`
              : ""}
          </p>
          <ContacterAdminCard hint="Pour changer les prix, contacte l’administration." />
        </Surface>

        <Surface>
          <h2 className="text-base font-semibold" style={{ color: "var(--g-text)" }}>
            Bloquer un créneau
          </h2>
          <p className="text-sm" style={{ color: "var(--g-muted)" }}>
            Pluie, tournoi, abonnement… bloque les heures que tu ne veux plus proposer.
          </p>
          <button
            type="button"
            onClick={() => setBlockOpen(true)}
            className="w-full min-h-[48px] rounded-xl text-base font-semibold text-white"
            style={{ background: "var(--g-primary)" }}
          >
            Ouvrir le calendrier d’événements
          </button>
        </Surface>

        <MonPlanningGardeSection />

        <BloquerCreneauModal
          open={blockOpen}
          onClose={() => setBlockOpen(false)}
          terrainId={terrain?.id}
          features={features}
        />
      </SubView>
    );
  }

  if (section === "horaires") {
    return (
      <SubView title="Horaires d'ouverture" onBack={backToHub}>
        <Surface>
          <p className="text-sm" style={{ color: "var(--g-muted)" }}>
            Dis-nous quand ton terrain est ouvert. Touche un jour pour le prendre comme modèle.
          </p>

          <button
            type="button"
            onClick={copyToWholeWeek}
            className="w-full min-h-[48px] rounded-xl text-base font-semibold inline-flex items-center justify-center gap-2"
            style={{
              background: "color-mix(in srgb, #d97706 16%, var(--g-surface-2))",
              color: "#b45309",
              border: "1px solid color-mix(in srgb, #d97706 35%, transparent)",
            }}
          >
            <Zap className="w-5 h-5" />
            ⚡ Copier sur toute la semaine
            {selectedHoraire ? (
              <span className="font-normal opacity-80">({JOUR_LABELS[selectedHoraire.jour]})</span>
            ) : null}
          </button>

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
                    "rounded-xl px-3 py-3 transition-colors",
                    selected && "ring-2 ring-[var(--g-primary)]",
                  )}
                  style={{
                    background: ouvert
                      ? "var(--g-surface-2)"
                      : "color-mix(in srgb, var(--g-surface-2) 70%, transparent)",
                    opacity: ouvert ? 1 : 0.72,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
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
                      <p className="text-base font-semibold" style={{ color: "var(--g-text)" }}>
                        {JOUR_LABELS[h.jour] || h.jour}
                        {selected ? (
                          <span className="ml-2 text-xs font-medium" style={{ color: "var(--g-primary)" }}>
                            modèle
                          </span>
                        ) : null}
                      </p>
                      {!ouvert ? (
                        <p className="text-sm mt-0.5" style={{ color: "var(--g-muted)" }}>
                          Fermé ce jour
                        </p>
                      ) : (
                        <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <Select2
                              className="flex-1 min-w-0"
                              ariaLabel={`Ouverture ${JOUR_LABELS[h.jour]}`}
                              value={String(h.heure_debut || "").slice(0, 5)}
                              onChange={(v) => updateHoraire(h.jour, { heure_debut: v })}
                              options={optionsHeuresSelect2(h.heure_debut, h.jour)}
                            />
                            <span className="text-sm shrink-0" style={{ color: "var(--g-muted)" }}>
                              →
                            </span>
                            <Select2
                              className="flex-1 min-w-0"
                              ariaLabel={`Fermeture ${JOUR_LABELS[h.jour]}`}
                              value={String(h.heure_fin || "").slice(0, 5)}
                              onChange={(v) => updateHoraire(h.jour, { heure_fin: v })}
                              options={optionsHeuresSelect2(h.heure_fin, h.jour)}
                            />
                          </div>
                          {estFermetureNuit(h.heure_fin) ? (
                            <p style={{ color: "var(--g-primary)", fontSize: "12px" }}>
                              🌙 Ce terrain ferme à {String(h.heure_fin).slice(0, 2)}h du matin (
                              {labelNuitDuJourASuivant(h.jour)})
                            </p>
                          ) : null}
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
            disabled={saving}
            onClick={saveHoraires}
            className="w-full min-h-[52px] rounded-xl text-base font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--g-primary)" }}
          >
            {saving ? "Enregistrement…" : "Enregistrer les horaires"}
          </button>
        </Surface>

        <Surface>
          <label className="text-base font-semibold block" style={{ color: "var(--g-text)" }}>
            Délai d&apos;attente entre 2 matchs (Pause/Nettoyage)
          </label>
          <p className="text-sm mt-1 mb-3" style={{ color: "var(--g-muted)" }}>
            Temps laissé après un match avant le suivant (pour ranger et accueillir).
          </p>
          <Select2
            value={String(retard)}
            onChange={(v) => saveRetard(Number(v))}
            options={RETARD_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
          />
        </Surface>
      </SubView>
    );
  }

  if (section === "equipements") {
    return (
      <SubView title="Équipements" onBack={backToHub}>
        <GerantCommoditesSection />
      </SubView>
    );
  }

  if (section === "photos") {
    return (
      <SubView title="Photos du terrain" onBack={backToHub}>
        <GerantPhotosSection />
      </SubView>
    );
  }

  return (
    <SubView title="Connexion WhatsApp" onBack={backToHub}>
      <WhatsAppGerantCard />
    </SubView>
  );
}
