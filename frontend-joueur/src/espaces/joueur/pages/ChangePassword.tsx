import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

export default function ChangePassword() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { logout } = useAuth();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) return toast.error("Les mots de passe ne correspondent pas");
    setSubmitting(true);
    try {
      await authApi.changePassword(password);
      toast.success("Mot de passe modifié");
      await logout({ redirect: false });
      navigate("/login", { replace: true });
    } catch (error: any) {
      toast.error(error.message || "Impossible de changer le mot de passe");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="joueur-app min-h-screen flex items-center justify-center responsive-padding">
      <form onSubmit={submit} className="glass-card w-full max-w-md p-6 space-y-4">
        <h1 className="font-display text-xl font-bold">Créez votre mot de passe</h1>
        <p className="text-sm text-muted-foreground">
          Le mot de passe temporaire doit être remplacé avant de continuer.
        </p>
        <Input
          type="password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Nouveau mot de passe"
          required
        />
        <Input
          type="password"
          minLength={8}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          placeholder="Confirmer le mot de passe"
          required
        />
        <Button className="w-full" disabled={submitting}>
          {submitting ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </form>
    </div>
  );
}
