import { ChangeEvent, ReactNode, useRef, useState } from "react";
import { Camera, LogOut, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { profilApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { normalizeRole } from "@/auth/roles";

export type ProfileAccount = {
  prenom?: string;
  nom?: string;
  email?: string;
  telephone?: string;
  photo_url?: string;
  created_at?: string;
};

export function initials(account?: ProfileAccount | null) {
  const p = (account?.prenom || "").trim();
  const n = (account?.nom || "").trim();
  return `${p.charAt(0)}${n.charAt(0)}`.toUpperCase() || "TS";
}

export function formatDate(date?: string) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("fr-FR");
}

export function readonlyInput(label: string, value?: string) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</span>
      <Input value={value || ""} readOnly className="bg-[var(--color-surface-2)]" />
    </label>
  );
}

export function ProfileLoading() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center px-4">
      <div className="glass-card w-full max-w-sm p-6 text-center">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">Chargement du profil...</p>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Recuperation de tes informations.</p>
      </div>
    </main>
  );
}

export function ProfileError({ message }: { message: string }) {
  const navigate = useNavigate();

  return (
    <main className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center px-4">
      <div className="glass-card w-full max-w-sm p-6 text-center">
        <p className="text-base font-bold text-[var(--color-text-primary)]">Impossible de charger le profil</p>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{message}</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            Retour
          </Button>
          <Button type="button" variant="hero" onClick={() => window.location.reload()}>
            Reessayer
          </Button>
        </div>
      </div>
    </main>
  );
}

export function ProfilePhoto({ account, onUpdated }: { account?: ProfileAccount | null; onUpdated: (url: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { refreshUser } = useAuth();

  const handlePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const uploaded = (await profilApi.uploadPhoto(String(reader.result || ""))) as { photo_url: string };
        onUpdated(uploaded.photo_url);
        await refreshUser();
        toast.success("Photo mise a jour");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Impossible d'envoyer la photo");
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="relative mx-auto w-[110px] h-[110px]">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="w-[110px] h-[110px] rounded-full overflow-hidden bg-[var(--color-primary)] text-white border-4 border-white shadow-sm inline-flex items-center justify-center"
        aria-label="Modifier la photo de profil"
      >
        {account?.photo_url ? (
          <img src={account.photo_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-3xl font-bold">{initials(account)}</span>
        )}
      </button>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-white border border-[var(--color-border)] shadow-sm inline-flex items-center justify-center text-[var(--color-primary)]"
        aria-label="Choisir une photo"
      >
        <Camera className="w-3.5 h-3.5" />
      </button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" capture="environment" className="hidden" onChange={handlePhoto} />
    </div>
  );
}

export function ProfileShell({
  account,
  roleLabel,
  subtitle,
  children,
}: {
  account?: ProfileAccount | null;
  roleLabel: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const [photoUrl, setPhotoUrl] = useState(account?.photo_url || "");
  const displayName = [account?.prenom, account?.nom].filter(Boolean).join(" ").trim() || account?.nom || "Utilisateur";

  return (
    <main className="min-h-screen bg-[var(--color-bg)] px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <section className="text-center">
          <ProfilePhoto account={{ ...account, photo_url: photoUrl || account?.photo_url }} onUpdated={setPhotoUrl} />
          <h1 className="mt-4 text-xl font-bold text-[var(--color-text-primary)]" style={{ fontFamily: "var(--font-display)" }}>
            {displayName}
          </h1>
          <div className="mt-2 inline-flex items-center rounded-full bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] px-3 py-1 text-xs font-semibold text-[var(--color-primary)]">
            {roleLabel}
          </div>
          {subtitle && <p className="mt-2 text-sm text-[var(--color-text-muted)]">{subtitle}</p>}
        </section>
        {children}
        <LogoutBlock />
      </div>
    </main>
  );
}

export function StatGrid({ stats }: { stats: { label: string; value: string | number }[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">Stats</h2>
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-[var(--color-text-primary)]" style={{ fontFamily: "var(--font-display)" }}>{stat.value}</p>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{stat.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PasswordBlock({ requireOld = false }: { requireOld?: boolean }) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await profilApi.changePassword({
        old_password: requireOld ? oldPassword : undefined,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Mot de passe modifie");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de modifier le mot de passe");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-8 space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Mot de passe</h2>
      {requireOld && <Input type="password" placeholder="Ancien mot de passe" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} />}
      <Input type="password" placeholder="Nouveau mot de passe" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
      <Input type="password" placeholder="Confirmer le mot de passe" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
      <Button type="button" variant="hero" className="w-full" disabled={saving} onClick={submit}>
        {saving ? "Modification..." : "Changer le mot de passe"}
      </Button>
    </section>
  );
}

export function LogoutBlock() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const role = normalizeRole(user);

  const confirm = () => {
    localStorage.clear();
    logout();
    navigate(role === "joueur" ? "/login" : "/backoffice/login", { replace: true });
  };

  return (
    <section className="mt-10 border-t border-[var(--color-border)] pt-5">
      <Button type="button" variant="outline" className="w-full min-h-[48px] border-red-500 text-red-600 hover:bg-red-50" onClick={() => setOpen(true)}>
        <LogOut className="w-4 h-4 mr-2" />
        Se deconnecter
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 px-4 py-6">
          <div className="w-full max-w-sm rounded-[var(--radius-lg)] bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Tu veux vraiment partir ?</h2>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Tu seras deconnecte et devras ressaisir tes infos.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="p-1 rounded-full hover:bg-[var(--color-surface-2)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
              <Button type="button" className="bg-red-600 text-white hover:bg-red-700" onClick={confirm}>Oui, me deconnecter</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
