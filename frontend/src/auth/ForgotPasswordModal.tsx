import { useState } from "react";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface ForgotPasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ForgotPasswordModal = ({ open, onOpenChange }: ForgotPasswordModalProps) => {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      // Simuler une demande de réinitialisation de mot de passe
      // Dans une implémentation réelle, cela appellerait l'API
      await new Promise((resolve) => setTimeout(resolve, 1500));
      
      // Ici, on simule un succès
      toast.success("Si un compte existe avec cet email, vous recevrez les instructions de réinitialisation.");
      setSubmitted(true);
    } catch (err: any) {
      toast.error(err.message || "Une erreur est survenue");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setSubmitted(false);
    setEmail("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display font-bold text-lg">
            {submitted ? "Vérifiez votre boîte mail" : "Mot de passe oublié ?"}
          </DialogTitle>
          <DialogDescription>
            {submitted
              ? "Si un compte existe avec cette adresse, vous recevrez un lien pour réinitialiser votre mot de passe."
              : "Entrez votre adresse e-mail et nous vous enverrons les instructions pour réinitialiser votre mot de passe."}
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-accent-foreground" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <p className="font-medium text-foreground">Email envoyé !</p>
              <p className="text-sm text-muted-foreground">
                Consultez votre boîte mail à l'adresse <strong>{email}</strong>
              </p>
              <p className="text-xs text-muted-foreground">
                Pensez aussi à vérifier vos spams si vous ne voyez pas l'email.
              </p>
            </div>
            <Button
              variant="hero"
              className="w-full"
              onClick={handleClose}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Retour à la connexion
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email">Adresse e-mail</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="votre@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button type="submit" variant="hero" className="w-full" disabled={submitting}>
                {submitting ? "Envoi en cours..." : "Envoyer les instructions"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleClose}
                disabled={submitting}
              >
                Retour
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ForgotPasswordModal;