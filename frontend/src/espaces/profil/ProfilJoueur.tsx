import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { profilApi } from "@/lib/api";
import { ProfileAccount, ProfileError, ProfileLoading, ProfileShell, StatGrid, readonlyInput } from "./ProfileBlocks";

type JoueurProfile = {
  account: ProfileAccount & { quartier?: string; date_naissance?: string };
  stats: { reservations_totales: number; matchs_joues: number; terrain_prefere: string };
};

export default function ProfilJoueur() {
  const [data, setData] = useState<JoueurProfile | null>(null);
  const [form, setForm] = useState({ prenom: "", nom: "", quartier: "", date_naissance: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    profilApi.getJoueur().then((payload: JoueurProfile) => {
      if (!mounted) return;
      setData(payload);
      setForm({
        prenom: payload.account.prenom || "",
        nom: payload.account.nom || "",
        quartier: payload.account.quartier || "",
        date_naissance: payload.account.date_naissance ? String(payload.account.date_naissance).slice(0, 10) : "",
      });
    }).catch((err) => {
      if (!mounted) return;
      const message = err instanceof Error ? err.message : "Impossible de charger le profil joueur";
      setError(message);
      toast.error(message);
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await profilApi.updateJoueur(form);
      const refreshed = (await profilApi.getJoueur()) as JoueurProfile;
      setData(refreshed);
      toast.success("Profil enregistre");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'enregistrer");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ProfileLoading />;
  if (error || !data) return <ProfileError message={error || "Profil joueur introuvable"} />;

  return (
    <ProfileShell account={data.account} roleLabel="Joueur">
      <form onSubmit={submit} className="mt-8 space-y-3">
        <Input placeholder="Prenom" value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} />
        <Input placeholder="Nom" required value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
        {readonlyInput("Telephone", data.account.telephone)}
        <Input placeholder="Quartier" value={form.quartier} onChange={(e) => setForm({ ...form, quartier: e.target.value })} />
        <Input type="date" value={form.date_naissance} onChange={(e) => setForm({ ...form, date_naissance: e.target.value })} />
        <Button type="submit" variant="hero" className="w-full" disabled={saving}>{saving ? "Enregistrement..." : "Enregistrer"}</Button>
      </form>
      <StatGrid stats={[
        { label: "Reservations totales", value: data.stats.reservations_totales },
        { label: "Matchs joues", value: data.stats.matchs_joues },
        { label: "Terrain prefere", value: data.stats.terrain_prefere },
      ]} />
    </ProfileShell>
  );
}
