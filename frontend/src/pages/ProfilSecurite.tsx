import { ArrowLeft, Lock, Shield, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authApi } from "@/lib/api";

const ProfilSecurite = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuth();
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passwords, setPasswords] = useState({
    current: "",
    new: "",
    confirm: "",
  });

  if (!isAuthenticated || !user) {
    return (
      <div className="page-container flex flex-col items-center justify-center gap-4">
        <p className="text-3xl">🔐</p>
        <p className="text-muted-foreground text-sm">Connectez-vous pour accéder à cette page</p>
        <Button variant="hero" onClick={() => navigate("/connexion")}>Se connecter</Button>
      </div>
    );
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (passwords.new !== passwords.confirm) {
      toast.error("Les nouveaux mots de passe ne correspondent pas");
      return;
    }
    
    if (passwords.new.length < 8) {
      toast.error("Le mot de passe doit contenir au moins 8 caractères");
      return;
    }

    setLoading(true);
    try {
      // In a real app, this would call an API endpoint
      // For now, we'll simulate success
      await new Promise(resolve => setTimeout(resolve, 1000));
      toast.success("Mot de passe modifié avec succès");
      setPasswords({ current: "", new: "", confirm: "" });
    } catch (err: any) {
      toast.error(err.message || "Erreur lors du changement de mot de passe");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer votre compte ? Cette action est irréversible.")) {
      return;
    }
    
    if (!confirm("Voulez-vous vraiment continuer ? Toutes vos données seront définitivement supprimées.")) {
      return;
    }

    setLoading(true);
    try {
      // In a real app, this would call an API endpoint
      await new Promise(resolve => setTimeout(resolve, 1000));
      toast.success("Compte supprimé avec succès");
      logout();
      navigate("/");
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de la suppression du compte");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <div className="flex items-center gap-3 responsive-padding py-4">
        <button onClick={() => navigate("/profil")} className="bg-muted rounded-full p-2">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-display font-bold text-lg sm:text-xl">Sécurité</h1>
      </div>

      <div className="max-w-2xl mx-auto">
        {/* Change Password */}
        <div className="responsive-padding mt-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="w-4 h-4" />
                Changer le mot de passe
              </CardTitle>
              <CardDescription>
                Choisissez un mot de passe fort pour sécuriser votre compte
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="current-password">Mot de passe actuel</Label>
                  <div className="relative">
                    <Input
                      id="current-password"
                      type={showCurrentPassword ? "text" : "password"}
                      value={passwords.current}
                      onChange={(e) => setPasswords(prev => ({ ...prev, current: e.target.value }))}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nouveau mot de passe</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showNewPassword ? "text" : "password"}
                      value={passwords.new}
                      onChange={(e) => setPasswords(prev => ({ ...prev, new: e.target.value }))}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Minimum 8 caractères. Utilisez des majuscules, minuscules, chiffres et symboles.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirmer le nouveau mot de passe</Label>
                  <div className="relative">
                    <Input
                      id="confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      value={passwords.confirm}
                      onChange={(e) => setPasswords(prev => ({ ...prev, confirm: e.target.value }))}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <Button 
                  type="submit" 
                  variant="hero" 
                  className="w-full"
                  disabled={loading || !passwords.current || !passwords.new || !passwords.confirm}
                >
                  {loading ? "Modification..." : "Modifier le mot de passe"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Security Info */}
        <div className="responsive-padding mt-4">
          <h3 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
            Informations de sécurité
          </h3>
          <div className="glass-card divide-y divide-border">
            <div className="flex items-center gap-3 p-4">
              <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                <Shield className="w-4 h-4 text-accent-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Statut du compte</p>
                <p className="text-[10px] text-muted-foreground">Votre compte est actif et sécurisé</p>
              </div>
              <span className="text-xs text-primary font-medium">Actif</span>
            </div>
            <div className="flex items-center gap-3 p-4">
              <div className="w-8 h-8 rounded-full bg-secondary/20 flex items-center justify-center">
                <Lock className="w-4 h-4 text-secondary-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Dernière connexion</p>
                <p className="text-[10px] text-muted-foreground">Connecté actuellement</p>
              </div>
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="responsive-padding mt-6">
          <h3 className="text-xs font-medium text-destructive mb-3 uppercase tracking-wider">
            Zone de danger
          </h3>
          <div className="glass-card border-destructive/20">
            <div className="flex items-start gap-3 p-4">
              <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium">Supprimer le compte</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Cette action est irréversible. Toutes vos données (réservations, avis, informations personnelles) seront définitivement supprimées.
                </p>
              </div>
            </div>
            <div className="px-4 pb-4">
              <Button
                variant="outline"
                className="w-full text-destructive border-destructive/20 hover:bg-destructive/5"
                onClick={handleDeleteAccount}
                disabled={loading}
              >
                {loading ? "Suppression..." : "Supprimer mon compte"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilSecurite;