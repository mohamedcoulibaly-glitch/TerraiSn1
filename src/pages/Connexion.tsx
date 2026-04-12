import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Eye, EyeOff, Mail, Lock, User, Phone } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const Connexion = () => {
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ nom: "", email: "", telephone: "", password: "" });
  const [accountType, setAccountType] = useState("proprietaire");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (isLogin) {
        await login(form.email, form.password, accountType);
        toast.success("Connexion réussie ! 🎉");
        // Redirect based on account type
        if (accountType === 'proprietaire') {
          navigate("/proprietaire");
        } else if (accountType === 'employe') {
          navigate("/gerant");
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Erreur de connexion");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-primary responsive-padding pt-12 pb-10 sm:pt-16 sm:pb-14 text-center rounded-b-[2rem]">
        <p className="text-4xl sm:text-5xl mb-3">⚽</p>
        <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-primary-foreground">TerrainSN</h1>
        <p className="text-primary-foreground/70 text-xs sm:text-sm mt-1">Réserve ton terrain de sport en un clic</p>
      </div>

      <div className="flex-1 responsive-padding mt-6 max-w-md mx-auto w-full">
        {/* Header simple */}
        <div className="flex bg-muted rounded-2xl p-1 mb-4">
          <button className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-card text-foreground shadow-sm">
            Espace Partenaire
          </button>
        </div>

        {/* Account type selector (login only) */}
        {isLogin && (
          <div className="mb-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Type de compte</p>
            <div className="flex gap-2">
              {[
                { value: "proprietaire", label: "Propriétaire" },
                { value: "employe", label: "Gérant" },
              ].map((t) => (
                <button
                  key={t.value}
                  onClick={() => setAccountType(t.value)}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors ${
                    accountType === t.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Adresse e-mail</label>
            <div className="flex items-center gap-2 bg-muted rounded-xl px-4 py-3">
              <Mail className="w-4 h-4 text-muted-foreground" />
              <input
                type="email"
                placeholder="abdou@email.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="flex-1 bg-transparent outline-none text-sm"
                required
                id="login-email"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Mot de passe</label>
            <div className="flex items-center gap-2 bg-muted rounded-xl px-4 py-3">
              <Lock className="w-4 h-4 text-muted-foreground" />
              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="flex-1 bg-transparent outline-none text-sm"
                required
                id="login-password"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
              </button>
            </div>
          </div>

          {isLogin && (
            <button type="button" className="text-xs text-primary font-medium text-right">
              Mot de passe oublié ?
            </button>
          )}

          <Button variant="hero" className="w-full h-12 text-base mt-2" type="submit" disabled={submitting}>
            {submitting ? "Chargement..." : "Se connecter"}
          </Button>
        </form>

        {/* Demo credentials info */}
        {isLogin && (
          <div className="mt-4 p-3 bg-accent/50 rounded-xl">
            <p className="text-[10px] sm:text-xs font-medium text-accent-foreground mb-1">🔑 Comptes démo :</p>
            <div className="text-[10px] sm:text-xs text-muted-foreground space-y-0.5">
              <p><span className="font-medium">Propriétaire :</span> diop@terrainsn.sn</p>
              <p><span className="font-medium">Gérant :</span> sarr@terrainsn.sn</p>
              <p><span className="font-medium">Mot de passe :</span> password123</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Connexion;
