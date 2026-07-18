import { useEffect, useState } from "react";
import { toast } from "sonner";
import { profilApi } from "@/lib/api";
import { PasswordBlock, ProfileAccount, ProfileError, ProfileLoading, ProfileShell, StatGrid, formatDate, readonlyInput } from "./ProfileBlocks";

type GerantProfile = {
  account: ProfileAccount;
  terrain?: { nom?: string; adresse?: string; ville?: string };
  stats: { matchs_valides_mois: number; creneaux_actifs: number; membre_depuis?: string };
};

export default function ProfilGerant() {
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
      <section className="mt-8 space-y-3">
        {readonlyInput("Prenom", data.account.prenom)}
        {readonlyInput("Nom", data.account.nom)}
        {readonlyInput("Telephone", data.account.telephone)}
        {readonlyInput("Email", data.account.email)}
        {readonlyInput("Terrain gere", data.terrain?.nom)}
      </section>
      <PasswordBlock />
      <StatGrid stats={[
        { label: "Matchs valides ce mois", value: data.stats.matchs_valides_mois },
        { label: "Creneaux actifs", value: data.stats.creneaux_actifs },
        { label: "Membre depuis", value: formatDate(data.stats.membre_depuis) },
      ]} />
    </ProfileShell>
  );
}
