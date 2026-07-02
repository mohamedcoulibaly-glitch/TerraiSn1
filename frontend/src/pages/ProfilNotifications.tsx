import { ArrowLeft, Bell, ToggleLeft, ToggleRight, Check, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { notificationsApi } from "@/lib/api";
import { Switch } from "@/components/ui/switch";

const notificationTypes = [
  { id: "reservation_confirmation", label: "Confirmation de réservation", desc: "Quand une réservation est acceptée ou refusée" },
  { id: "rappel_reservation", label: "Rappel de réservation", desc: "Rappel 1h avant votre réservation" },
  { id: "promotion", label: "Promotions et offres", desc: "Recevoir les offres spéciales et réductions" },
  { id: "nouveau_message", label: "Nouveaux messages", desc: "Quand vous recevez un message du support" },
  { id: "avis_reponse", label: "Réponse à vos avis", desc: "Quand un propriétaire répond à votre avis" },
];

const ProfilNotifications = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [settings, setSettings] = useState<Record<string, boolean>>({
    reservation_confirmation: true,
    rappel_reservation: true,
    promotion: false,
    nouveau_message: true,
    avis_reponse: true,
  });

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/connexion');
      return;
    }
    loadNotifications();
  }, [isAuthenticated]);

  const loadNotifications = async () => {
    try {
      const data = await notificationsApi.list();
      setNotifications(data || []);
    } catch (err: any) {
      console.error(err);
    }
  };

  const toggleSetting = async (key: string) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
    toast.success(`Notifications ${key === 'promotion' ? 'désactivées' : 'activées'}`);
  };

  const markAsRead = async (id: number) => {
    try {
      await notificationsApi.marquerLue(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, lu: true } : n));
      toast.success("Notification marquée comme lue");
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de la mise à jour");
    }
  };

  const markAllAsRead = async () => {
    const unreadIds = notifications.filter(n => !n.lu).map(n => n.id);
    for (const id of unreadIds) {
      try {
        await notificationsApi.marquerLue(id);
      } catch (err) {
        console.error(err);
      }
    }
    setNotifications(prev => prev.map(n => ({ ...n, lu: true })));
    toast.success("Toutes les notifications ont été marquées comme lues");
  };

  const unreadCount = notifications.filter(n => !n.lu).length;

  return (
    <div className="page-container">
      <div className="flex items-center gap-3 responsive-padding py-4">
        <button onClick={() => navigate("/profil")} className="bg-muted rounded-full p-2">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-display font-bold text-lg sm:text-xl">Notifications</h1>
      </div>

      <div className="max-w-2xl mx-auto">
        {/* Notification Settings */}
        <div className="responsive-padding mt-2">
          <h3 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
            Préférences de notification
          </h3>
          <div className="glass-card divide-y divide-border">
            {notificationTypes.map((type) => (
              <div key={type.id} className="flex items-center justify-between p-4">
                <div className="flex-1">
                  <p className="text-sm font-medium">{type.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{type.desc}</p>
                </div>
                <Switch
                  checked={settings[type.id]}
                  onCheckedChange={() => toggleSetting(type.id)}
                  className="data-[state=checked]:bg-primary"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Recent Notifications */}
        <div className="responsive-padding mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Notifications récentes
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-primary hover:underline"
              >
                Tout marquer comme lu
              </button>
            )}
          </div>
          <div className="glass-card divide-y divide-border">
            {notifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Aucune notification</p>
              </div>
            ) : (
              notifications.slice(0, 10).map((notif) => (
                <div
                  key={notif.id}
                  className={`flex items-start gap-3 p-4 ${!notif.lu ? 'bg-primary/5' : ''}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    notif.type === 'reservation' ? 'bg-accent/20' : 
                    notif.type === 'rappel' ? 'bg-secondary/20' : 'bg-muted'
                  }`}>
                    <Bell className={`w-4 h-4 ${notif.type === 'reservation' ? 'text-accent-foreground' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{notif.titre}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{notif.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{notif.created_at}</p>
                  </div>
                  {!notif.lu && (
                    <button
                      onClick={() => markAsRead(notif.id)}
                      className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0"
                    >
                      <Check className="w-3 h-3 text-primary" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilNotifications;