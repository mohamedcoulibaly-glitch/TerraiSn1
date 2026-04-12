import { ArrowLeft, User, Mail, Phone, MapPin, LogOut, ChevronRight, Bell, HelpCircle, Shield, Edit } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const menuItems = [
  { icon: Bell, label: "Notifications", badge: "3", desc: "Gérer vos alertes" },
  { icon: Shield, label: "Sécurité", desc: "Mot de passe et confidentialité" },
  { icon: HelpCircle, label: "Aide et support", desc: "FAQ et contact" },
];

const Profil = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuth();

  if (!isAuthenticated || !user) {
    return (
      <div className="page-container flex flex-col items-center justify-center gap-4">
        <p className="text-3xl">🔐</p>
        <p className="text-muted-foreground text-sm">Connectez-vous pour voir votre profil</p>
        <Button variant="hero" onClick={() => navigate("/connexion")}>Se connecter</Button>
      </div>
    );
  }

  const roleLabel = user.role === 'superadmin' ? 'Super Admin' : user.role === 'proprietaire' ? 'Propriétaire' : user.role === 'employe' ? 'Gérant' : 'Joueur';

  return (
    <div className="page-container">
      <div className="flex items-center gap-3 responsive-padding py-4">
        <button onClick={() => navigate("/")} className="bg-muted rounded-full p-2">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-display font-bold text-lg sm:text-xl">Mon profil</h1>
      </div>

      <div className="max-w-2xl mx-auto">
        <div className="responsive-padding mt-2">
          <div className="glass-card p-5 flex items-center gap-4">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-primary/10 flex items-center justify-center relative">
              <User className="w-8 h-8 sm:w-10 sm:h-10 text-primary" />
              <button className="absolute -bottom-1 -right-1 bg-primary text-primary-foreground rounded-full p-1">
                <Edit className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1">
              <h2 className="font-display font-bold text-lg sm:text-xl">{user.nom}</h2>
              <div className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground mt-0.5">
                <MapPin className="w-3 h-3" /> Dakar, Sénégal
              </div>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent text-accent-foreground mt-1">
                ⚽ {roleLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="responsive-padding mt-4">
          <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Informations personnelles</h3>
          <div className="glass-card divide-y divide-border">
            <div className="flex items-center gap-3 p-4">
              <Mail className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-[11px] text-muted-foreground">Adresse e-mail</p>
                <p className="text-sm font-medium">{user.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4">
              <Phone className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-[11px] text-muted-foreground">Téléphone</p>
                <p className="text-sm font-medium">{user.telephone || 'Non renseigné'}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="responsive-padding mt-4">
          <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Paramètres</h3>
          <div className="glass-card divide-y divide-border">
            {menuItems.map((item) => (
              <button key={item.label} className="flex items-center gap-3 p-4 w-full hover:bg-muted/50 transition-colors">
                <item.icon className="w-4 h-4 text-muted-foreground" />
                <div className="flex-1 text-left">
                  <span className="text-sm font-medium">{item.label}</span>
                  <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                </div>
                {item.badge && (
                  <span className="bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {item.badge}
                  </span>
                )}
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>

        <div className="responsive-padding mt-6">
          <Button 
            variant="outline" 
            className="w-full gap-2 text-destructive border-destructive/20 hover:bg-destructive/5"
            onClick={() => {
              logout();
              toast.success("Déconnexion réussie");
              navigate("/connexion");
            }}
          >
            <LogOut className="w-4 h-4" /> Se déconnecter
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Profil;
