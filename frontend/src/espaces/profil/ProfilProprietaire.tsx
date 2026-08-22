import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Camera, LogOut } from "lucide-react";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/hooks/use-auth";
import { profilApi, proprietaireApi } from "@/lib/api";

type Account = {
  prenom?: string;
  nom?: string;
  email?: string;
  telephone?: string;
  photo_url?: string;
  created_at?: string;
};

export default function ProfilProprietaire() {
  const { logout, refreshUser } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [terrains, setTerrains] = useState<Array<{ id: number; nom: string; is_active?: number }>>([]);
  const [matchsMois, setMatchsMois] = useState(0);
  const [scoreMoyen, setScoreMoyen] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([profilApi.getProprietaire(), proprietaireApi.stats().catch(() => null)])
      .then(async ([payload, stats]) => {
        if (!mounted) return;
        setAccount(payload?.account || null);
        const list = Array.isArray(payload?.terrains) ? payload.terrains : [];
        setTerrains(list);
        setMatchsMois(Number(payload?.stats?.matchs_joues_mois ?? stats?.matchsJoues ?? 0));
        const scores = await Promise.all(
          list.map(async (t: { id: number }) => {
            try {
              const s = await proprietaireApi.santeTerrain(t.id);
              return Number(s?.score_confiance);
            } catch {
              return null;
            }
          }),
        );
        const valid = scores.filter((n): n is number => Number.isFinite(n));
        setScoreMoyen(valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Impossible de charger le profil");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handlePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result || "");
        const updated = await profilApi.uploadPhoto(dataUrl);
        const url = updated?.photo_url || dataUrl;
        setAccount((prev) => (prev ? { ...prev, photo_url: url } : prev));
        await refreshUser();
        toast.success("Photo mise à jour");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload impossible");
      }
    };
    reader.readAsDataURL(file);
  };

  const submitPassword = async () => {
    setSavingPwd(true);
    try {
      await profilApi.changePassword({
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Mot de passe modifié");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible de modifier le mot de passe");
    } finally {
      setSavingPwd(false);
    }
  };

  const confirmLogout = async () => {
    await logout({ redirect: false });
    window.location.href = "/backoffice/login";
  };

  if (loading) {
    return (
      <div className="proprio-app min-h-screen flex items-center justify-center">
        <p className="text-sm" style={{ color: "var(--p-muted)" }}>Chargement du profil...</p>
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="proprio-app min-h-screen flex items-center justify-center px-4">
        <p className="text-sm text-center" style={{ color: "var(--p-verifier)" }}>{error || "Profil introuvable"}</p>
      </div>
    );
  }

  const initials = `${(account.prenom || "").charAt(0)}${(account.nom || "").charAt(0)}`.toUpperCase() || "P";
  const displayName = [account.prenom, account.nom].filter(Boolean).join(" ") || "Propriétaire";
  const membreDepuis = account.created_at
    ? new Date(account.created_at).toLocaleDateString("fr-FR")
    : "—";

  return (
    <div className="proprio-app min-h-screen pb-10" style={{ background: "var(--p-bg)" }}>
      <div className="relative h-40" style={{ background: "var(--p-primary)" }} />
      <div className="max-w-md mx-auto px-4 -mt-12">
        <div className="flex flex-col items-center">
          <div className="relative">
            <div
              className="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center text-2xl font-bold"
              style={{ border: "3px solid #fff", background: "var(--p-surface)", color: "var(--p-primary)" }}
            >
              {account.photo_url ? (
                <img src={account.photo_url} alt="" className="w-full h-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="absolute bottom-0 right-0 w-9 h-9 rounded-full inline-flex items-center justify-center"
              style={{ background: "var(--p-primary)", color: "#fff" }}
              aria-label="Changer la photo"
            >
              <Camera className="w-4 h-4" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
          </div>
          <h1 className="mt-3 text-lg font-bold text-center" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
            {displayName}
          </h1>
          <span className="mt-1 text-[11px] font-semibold px-3 py-1 rounded-full" style={{ background: "var(--p-primary-glow)", color: "var(--p-primary)" }}>
            Propriétaire
          </span>
        </div>

        <section className="mt-6 space-y-3">
          {[
            ["Prénom", account.prenom],
            ["Nom", account.nom],
            ["Téléphone", account.telephone],
            ["Email", account.email],
            ["Membre depuis", membreDepuis],
          ].map(([label, value]) => (
            <label key={label} className="block">
              <span className="text-xs font-medium" style={{ color: "var(--p-muted)" }}>{label}</span>
              <input
                readOnly
                value={value || ""}
                className="mt-1 w-full min-h-[44px] rounded-xl px-3 text-sm"
                style={{ background: "var(--p-surface-2)", color: "var(--p-text)" }}
              />
            </label>
          ))}
          <p className="text-xs" style={{ color: "var(--p-muted)" }}>
            Pour modifier tes informations, contacte l'administration
          </p>
        </section>

        <section className="mt-6 rounded-2xl p-4" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--p-text)" }}>Terrains associés</h2>
          {terrains.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--p-muted)" }}>Aucun terrain assigné</p>
          ) : (
            <ul className="space-y-2">
              {terrains.map((t) => (
                <li key={t.id} className="flex items-center justify-between text-sm">
                  <span style={{ color: "var(--p-text)" }}>{t.nom}</span>
                  <span className="text-[11px]" style={{ color: Number(t.is_active) === 0 ? "var(--p-muted)" : "var(--p-optimal)" }}>
                    {Number(t.is_active) === 0 ? "Inactif" : "Actif"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-4 grid grid-cols-3 gap-2">
          {[
            ["Terrains", String(terrains.length)],
            ["Matchs ce mois", String(matchsMois)],
            ["Score moyen", scoreMoyen == null ? "—" : String(scoreMoyen)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl p-3 text-center" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
              <p className="text-lg font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>{value}</p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--p-muted)" }}>{label}</p>
            </div>
          ))}
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-sm font-semibold" style={{ color: "var(--p-text)" }}>Mot de passe</h2>
          <input
            type="password"
            placeholder="Nouveau mot de passe"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full min-h-[44px] rounded-xl px-3 text-sm"
            style={{ background: "var(--p-surface)", color: "var(--p-text)" }}
          />
          <input
            type="password"
            placeholder="Confirmer"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full min-h-[44px] rounded-xl px-3 text-sm"
            style={{ background: "var(--p-surface)", color: "var(--p-text)" }}
          />
          <button
            type="button"
            disabled={savingPwd}
            onClick={submitPassword}
            className="w-full min-h-[44px] rounded-xl text-sm font-semibold"
            style={{ background: "var(--p-primary)", color: "#fff" }}
          >
            {savingPwd ? "Modification..." : "Changer mon mot de passe"}
          </button>
        </section>

        <section className="mt-6 rounded-2xl p-4 flex items-center justify-between" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
          <span className="text-sm font-medium" style={{ color: "var(--p-text)" }}>Apparence</span>
          <ThemeToggle />
        </section>

        <button
          type="button"
          onClick={() => setLogoutOpen(true)}
          className="mt-6 w-full min-h-[48px] rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2"
          style={{ border: "1.5px solid var(--p-verifier)", color: "var(--p-verifier)", background: "transparent" }}
        >
          <LogOut className="w-4 h-4" />
          Se déconnecter
        </button>
      </div>

      {logoutOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 px-4 py-6">
          <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: "var(--p-surface)" }}>
            <h2 className="text-lg font-bold" style={{ color: "var(--p-text)" }}>Tu veux vraiment partir ? 👋</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--p-text-2)" }}>Tu seras déconnecté de l'espace propriétaire.</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setLogoutOpen(false)}
                className="min-h-[44px] rounded-xl text-sm font-semibold"
                style={{ background: "var(--p-surface-2)", color: "var(--p-text)" }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmLogout}
                className="min-h-[44px] rounded-xl text-sm font-semibold text-white"
                style={{ background: "var(--p-verifier)" }}
              >
                Oui, partir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
