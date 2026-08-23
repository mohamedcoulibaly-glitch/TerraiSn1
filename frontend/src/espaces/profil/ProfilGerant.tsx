import { ChangeEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { profilApi } from "@/lib/api";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/hooks/use-auth";

type Account = {
  prenom?: string;
  nom?: string;
  email?: string;
  telephone?: string;
  photo_url?: string;
  created_at?: string;
};

type GerantProfile = {
  account: Account;
  terrain?: { nom?: string };
  stats?: { membre_depuis?: string };
};

function initials(account?: Account | null) {
  const p = (account?.prenom || "").trim();
  const n = (account?.nom || "").trim();
  return `${p.charAt(0)}${n.charAt(0)}`.toUpperCase() || "G";
}

function formatMembreDepuis(date?: string) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs" style={{ color: "var(--g-muted)" }}>
        {label}
      </p>
      <p className="text-sm font-medium mt-0.5" style={{ color: "var(--g-text)" }}>
        {value}
      </p>
    </div>
  );
}

export default function ProfilGerant() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<GerantProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    let mounted = true;
    profilApi
      .getGerant()
      .then((payload) => {
        if (mounted) setData(payload as GerantProfile);
      })
      .catch((err) => {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : "Impossible de charger le profil";
        setError(message);
        toast.error(message);
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
        const uploaded = (await profilApi.uploadPhoto(String(reader.result || ""))) as { photo_url: string };
        setData((prev) =>
          prev ? { ...prev, account: { ...prev.account, photo_url: uploaded.photo_url } } : prev,
        );
        await refreshUser();
        toast.success("Photo mise à jour");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Impossible d'envoyer la photo");
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  };

  const changePassword = async () => {
    if (!newPassword || newPassword.length < 8) {
      toast.error("Le mot de passe doit contenir au moins 8 caractères");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Les mots de passe ne correspondent pas");
      return;
    }
    setSavingPassword(true);
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
      setSavingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="gerant-app min-h-screen p-4 animate-pulse" style={{ background: "var(--g-bg)" }}>
        <div className="h-40 rounded-b-2xl" style={{ background: "var(--g-primary)" }} />
        <div className="h-24 w-24 rounded-full mx-auto -mt-12" style={{ background: "var(--g-surface-2)" }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="gerant-app min-h-screen p-4 flex items-center justify-center" style={{ background: "var(--g-bg)" }}>
        <p className="text-sm text-center" style={{ color: "var(--g-danger)" }}>
          {error || "Profil introuvable"}
        </p>
      </div>
    );
  }

  const account = data.account;
  const prenom = (account.prenom || "").trim();
  const nom = (account.nom || "").trim();
  const nomComplet =
    prenom && nom.toLowerCase().startsWith(prenom.toLowerCase())
      ? nom.includes(" ")
        ? nom
        : `${prenom} ${nom}`.trim()
      : [prenom, nom].filter(Boolean).join(" ") || "Gérant";

  return (
    <div className="gerant-app min-h-screen pb-8" style={{ background: "var(--g-bg)" }}>
      <header className="relative h-40" style={{ background: "var(--g-primary)" }}>
        <button
          type="button"
          onClick={() => navigate("/backoffice/gerant/parametres")}
          className="absolute top-3 left-3 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-white/90"
          aria-label="Retour"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      </header>

      <div className="relative flex justify-center -mt-12">
        <div className="relative w-24 h-24">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-24 h-24 rounded-full overflow-hidden inline-flex items-center justify-center text-2xl font-bold"
            style={{
              background: "var(--g-surface)",
              color: "var(--g-primary)",
              border: "3px solid #fff",
              boxShadow: "var(--g-shadow-md)",
            }}
            aria-label="Modifier la photo de profil"
          >
            {account.photo_url ? (
              <img src={account.photo_url} alt="" className="w-full h-full object-cover" />
            ) : (
              initials(account)
            )}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="absolute bottom-0 right-0 w-8 h-8 rounded-full inline-flex items-center justify-center text-white"
            style={{ background: "var(--g-primary)", border: "2px solid #fff" }}
            aria-label="Choisir une photo"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handlePhoto}
          />
        </div>
      </div>

      <p
        className="mt-3 text-center text-lg font-bold"
        style={{ color: "var(--g-text)", fontFamily: "var(--font-display)" }}
      >
        {nomComplet}
      </p>
      <div className="flex justify-center mt-1">
        <span
          className="text-[11px] font-semibold px-3 py-1 rounded-full"
          style={{ background: "var(--g-primary-glow)", color: "var(--g-primary)" }}
        >
          Gérant
        </span>
      </div>

      <div className="max-w-lg mx-auto px-4 mt-6 space-y-5">
        <section className="rounded-xl p-4 space-y-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
          <InfoRow label="Prénom" value={account.prenom} />
          <InfoRow label="Nom" value={account.nom} />
          <InfoRow label="Téléphone" value={account.telephone} />
          {account.email ? <InfoRow label="Email" value={account.email} /> : null}
          <div>
            <p className="text-xs" style={{ color: "var(--g-muted)" }}>
              Terrain géré
            </p>
            <span
              className="inline-flex mt-1 min-h-[28px] items-center px-2.5 rounded-full text-xs font-semibold"
              style={{ background: "var(--g-primary-glow)", color: "var(--g-primary)" }}
            >
              {data.terrain?.nom || "Non assigné"}
            </span>
          </div>
          <InfoRow label="Membre depuis" value={formatMembreDepuis(data.stats?.membre_depuis || account.created_at)} />
          <p className="text-[11px] pt-1" style={{ color: "var(--g-muted)" }}>
            Pour modifier tes informations, contacte l&apos;administration
          </p>
        </section>

        <section className="rounded-xl p-4 space-y-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
            Mot de passe
          </h2>
          <input
            type="password"
            placeholder="Nouveau mot de passe"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full h-12 px-3 rounded-xl text-sm outline-none"
            style={{ background: "var(--g-surface-2)", color: "var(--g-text)", border: "1px solid var(--g-border)" }}
          />
          <input
            type="password"
            placeholder="Confirmer"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full h-12 px-3 rounded-xl text-sm outline-none"
            style={{ background: "var(--g-surface-2)", color: "var(--g-text)", border: "1px solid var(--g-border)" }}
          />
          <button
            type="button"
            disabled={savingPassword}
            onClick={() => void changePassword()}
            className="w-full min-h-[48px] rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--g-primary)" }}
          >
            {savingPassword ? "Modification…" : "Changer mon mot de passe"}
          </button>
        </section>

        <section
          className="rounded-xl p-4 flex items-center justify-between gap-3"
          style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
        >
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--g-text)" }}>
              Apparence
            </p>
            <p className="text-xs" style={{ color: "var(--g-muted)" }}>
              Clair / sombre
            </p>
          </div>
          <ThemeToggle />
        </section>

        <p className="text-center text-xs pb-2" style={{ color: "var(--g-muted)" }}>
          Pour te déconnecter, ouvre Paramètres dans le menu gérant.
        </p>
      </div>
    </div>
  );
}
