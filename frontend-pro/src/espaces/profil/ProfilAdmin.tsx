import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { profilApi } from "@/lib/api";
import { PasswordBlock, ProfileAccount, ProfileError, ProfileLoading, ProfileShell, StatGrid, formatDate, readonlyInput } from "./ProfileBlocks";
import PushPreferencesPanel from "@/components/pwa/PushPreferencesPanel";

type AdminProfile = {
  account: ProfileAccount;
  stats: { membre_depuis?: string };
};

export default function ProfilAdmin() {
  const [data, setData] = useState<AdminProfile | null>(null);
  const [form, setForm] = useState({ prenom: "", nom: "", email: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    profilApi.getAdmin().then((payload: AdminProfile) => {
      if (!mounted) return;
      setData(payload);
      setForm({
        prenom: payload.account.prenom || "",
        nom: payload.account.nom || "",
        email: payload.account.email || "",
      });
    }).catch((err) => {
      if (!mounted) return;
      const message = err instanceof Error ? err.message : "Impossible de charger le profil admin";
      setError(message);
      toast.error(message);
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [reloadKey]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await profilApi.updateAdmin(form);
      const refreshed = (await profilApi.getAdmin()) as AdminProfile;
      setData(refreshed);
      toast.success("Profil admin enregistre");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'enregistrer");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ProfileLoading />;
  if (error || !data) {
    return (
      <ProfileError
        message={error || "Profil admin introuvable"}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }

  return (
    <ProfileShell account={data.account} roleLabel="Admin">
      <form onSubmit={submit} className="mt-8 space-y-3">
        <Input placeholder="Prenom" value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} />
        <Input placeholder="Nom" required value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
        {readonlyInput("Telephone", data.account.telephone)}
        <Input type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Button type="submit" variant="hero" className="w-full" disabled={saving}>{saving ? "Enregistrement..." : "Enregistrer"}</Button>
      </form>
      <PasswordBlock requireOld />
      <div className="mt-6">
        <PushPreferencesPanel />
      </div>
      <StatGrid stats={[{ label: "Membre depuis", value: formatDate(data.stats.membre_depuis) }]} />
    </ProfileShell>
  );
}
