import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { profilApi } from "@/lib/api";
import SkeletonProfil from "@/components/skeletons/SkeletonProfil";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/contexts/ThemeContext";
import { ProfileAccount, ProfileError, ProfileShell, StatGrid, readonlyInput } from "./ProfileBlocks";
import { clearDraft, readDraft, usePersistedState } from "@/hooks/usePersistedState";

type JoueurProfile = {
  account: ProfileAccount & { quartier?: string; date_naissance?: string };
  stats: { reservations_totales: number; matchs_joues: number; terrain_prefere: string };
};

type ProfilForm = { prenom: string; nom: string; quartier: string; date_naissance: string };

const PROFIL_DRAFT_KEY = "joueur:profil-edit";

export default function ProfilJoueur() {
  const { theme } = useTheme();
  const [data, setData] = useState<JoueurProfile | null>(null);
  const [form, setForm, { clear: clearProfilDraft }] = usePersistedState<ProfilForm>(PROFIL_DRAFT_KEY, {
    prenom: "",
    nom: "",
    quartier: "",
    date_naissance: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    profilApi
      .getJoueur()
      .then((payload: JoueurProfile) => {
        if (!mounted) return;
        setData(payload);
        const draft = readDraft<ProfilForm>(PROFIL_DRAFT_KEY);
        const fromApi: ProfilForm = {
          prenom: payload.account.prenom || "",
          nom: payload.account.nom || "",
          quartier: payload.account.quartier || "",
          date_naissance: payload.account.date_naissance
            ? String(payload.account.date_naissance).slice(0, 10)
            : "",
        };
        // Garde le brouillon local s'il diffère déjà de l'API
        if (
          draft &&
          (draft.prenom !== fromApi.prenom ||
            draft.nom !== fromApi.nom ||
            draft.quartier !== fromApi.quartier ||
            draft.date_naissance !== fromApi.date_naissance)
        ) {
          setForm(draft);
        } else {
          setForm(fromApi);
        }
      })
      .catch((err) => {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : "Impossible de charger le profil joueur";
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [reloadKey, setForm]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await profilApi.updateJoueur(form);
      const refreshed = (await profilApi.getJoueur()) as JoueurProfile;
      setData(refreshed);
      clearProfilDraft();
      clearDraft(PROFIL_DRAFT_KEY);
      setForm({
        prenom: refreshed.account.prenom || "",
        nom: refreshed.account.nom || "",
        quartier: refreshed.account.quartier || "",
        date_naissance: refreshed.account.date_naissance
          ? String(refreshed.account.date_naissance).slice(0, 10)
          : "",
      });
      toast.success("Profil enregistre");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'enregistrer");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="joueur-app"><SkeletonProfil /></div>;
  if (error || !data) {
    return (
      <div className="joueur-app">
        <ProfileError
          message={error || "Profil joueur introuvable"}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </div>
    );
  }

  return (
    <ProfileShell account={data.account} roleLabel="Joueur" className="joueur-app">
      <form
        onSubmit={submit}
        className="mt-8 t-card rounded-[var(--radius-lg)] border border-[var(--border)] p-4 space-y-3"
      >
        <h2 className="text-[12px] font-semibold uppercase tracking-wide t-muted border-b border-[var(--border)] pb-2">
          Informations
        </h2>
        <Input
          placeholder="Prenom"
          value={form.prenom}
          onChange={(e) => setForm({ ...form, prenom: e.target.value })}
          className="h-12"
        />
        <Input
          placeholder="Nom"
          required
          value={form.nom}
          onChange={(e) => setForm({ ...form, nom: e.target.value })}
          className="h-12"
        />
        {readonlyInput("Telephone", data.account.telephone)}
        <Input
          placeholder="Quartier"
          value={form.quartier}
          onChange={(e) => setForm({ ...form, quartier: e.target.value })}
          className="h-12"
        />
        <Input
          type="date"
          value={form.date_naissance}
          onChange={(e) => setForm({ ...form, date_naissance: e.target.value })}
          className="h-12"
        />
        <Button type="submit" variant="hero" className="w-full h-12" disabled={saving}>
          {saving ? "Enregistrement..." : "Enregistrer"}
        </Button>
      </form>

      <div className="t-card rounded-2xl border p-4 flex items-center justify-between mt-8">
        <div>
          <p className="font-semibold t-text text-sm">Apparence</p>
          <p className="t-muted text-xs mt-0.5">
            {theme === "dark" ? "Mode sombre activé" : "Mode clair activé"}
          </p>
        </div>
        <ThemeToggle />
      </div>

      <StatGrid
        stats={[
          { label: "Matchs joués", value: data.stats.matchs_joues },
          { label: "Réservations", value: data.stats.reservations_totales },
          { label: "Terrain préféré", value: data.stats.terrain_prefere || "—" },
        ]}
      />
    </ProfileShell>
  );
}
