import { useEffect, useState } from "react";
import { toast } from "sonner";
import { profilApi } from "@/lib/api";
import { PasswordBlock, ProfileAccount, ProfileError, ProfileLoading, ProfileShell, StatGrid, formatDate, readonlyInput } from "./ProfileBlocks";

type ProprietaireProfile = {
  account: ProfileAccount;
  terrains: { id: number; nom: string; ville?: string; adresse?: string }[];
  stats: { nombre_terrains: number; matchs_joues_mois: number; membre_depuis?: string };
};

export default function ProfilProprietaire() {
  const [data, setData] = useState<ProprietaireProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    profilApi.getProprietaire().then((payload) => {
      if (mounted) setData(payload);
    }).catch((err) => {
      if (!mounted) return;
      const message = err instanceof Error ? err.message : "Impossible de charger le profil proprietaire";
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
  if (error || !data) return <ProfileError message={error || "Profil proprietaire introuvable"} />;

  return (
    <ProfileShell account={data.account} roleLabel="Proprietaire" subtitle={`${data.terrains.length} terrain(s) associe(s)`}>
      <section className="mt-8 space-y-3">
        {readonlyInput("Prenom", data.account.prenom)}
        {readonlyInput("Nom", data.account.nom)}
        {readonlyInput("Telephone", data.account.telephone)}
        {readonlyInput("Email", data.account.email)}
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-3">
          <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-2">Terrains associes</p>
          <div className="space-y-2">
            {data.terrains.map((terrain) => (
              <div key={terrain.id} className="text-sm text-[var(--color-text-primary)]">
                {terrain.nom}
                <span className="block text-xs text-[var(--color-text-muted)]">{terrain.ville || terrain.adresse || ""}</span>
              </div>
            ))}
            {data.terrains.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">Aucun terrain assigne</p>}
          </div>
        </div>
      </section>
      <PasswordBlock />
      <StatGrid stats={[
        { label: "Nombre de terrains", value: data.stats.nombre_terrains },
        { label: "Matchs joues ce mois", value: data.stats.matchs_joues_mois },
        { label: "Membre depuis", value: formatDate(data.stats.membre_depuis) },
      ]} />
    </ProfileShell>
  );
}
