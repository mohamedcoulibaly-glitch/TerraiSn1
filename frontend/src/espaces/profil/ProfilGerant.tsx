import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { profilApi } from "@/lib/api";
import WhatsAppGerantCard from "@/espaces/backoffice/components/WhatsAppGerantCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/contexts/ThemeContext";
import { PasswordBlock, ProfileAccount, ProfileError, ProfileLoading, ProfileShell, StatGrid, formatDate, readonlyInput } from "./ProfileBlocks";

type GerantProfile = {
  account: ProfileAccount;
  terrain?: { nom?: string; adresse?: string; ville?: string };
  stats: { matchs_valides_mois: number; creneaux_actifs: number; membre_depuis?: string };
};

export default function ProfilGerant() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [data, setData] = useState<GerantProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    profilApi.getGerant().then((payload) => {
      if (mounted) setData(payload);
    }).catch((err) => {
      if (!mounted) return;
      const message = err instanceof Error ? err.message : "Impossible de charger le profil gerant";
      setError(message);
      toast.error(message);
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <ProfileLoading />;
  if (error || !data) return <ProfileError message={error || "Profil gerant introuvable"} />;

  return (
    <ProfileShell account={data.account} roleLabel="Gerant" subtitle={data.terrain?.nom || "Terrain non assigne"}>
      <section className="mt-8 flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">Apparence</p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {theme === "dark" ? "Mode sombre activé" : "Mode clair activé"}
          </p>
        </div>
        <ThemeToggle />
      </section>
      <section className="mt-8 space-y-3">
        {readonlyInput("Prenom", data.account.prenom)}
        {readonlyInput("Nom", data.account.nom)}
        {readonlyInput("Telephone", data.account.telephone)}
        {readonlyInput("Email", data.account.email)}
        {readonlyInput("Terrain gere", data.terrain?.nom)}
      </section>
      <div className="mt-6">
        <WhatsAppGerantCard />
      </div>
      <button
        type="button"
        onClick={() => navigate("/backoffice/gerant/portefeuille")}
        className="mt-6 w-full min-h-[48px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white text-sm font-medium inline-flex items-center justify-center gap-2"
      >
        <Wallet className="w-4 h-4 text-[var(--color-primary)]" />
        Voir mon portefeuille
      </button>
      <PasswordBlock />
      <StatGrid stats={[
        { label: "Matchs valides ce mois", value: data.stats.matchs_valides_mois },
        { label: "Creneaux actifs", value: data.stats.creneaux_actifs },
        { label: "Membre depuis", value: formatDate(data.stats.membre_depuis) },
      ]} />
    </ProfileShell>
  );
}
