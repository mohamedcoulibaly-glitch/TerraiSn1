import { ArrowLeft, Bell, Check, Wifi } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { notificationsApi, pushApi } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import {
  isPushSupported,
  subscribeToPushNotifications,
  unsubscribeFromPushNotifications,
  getPushPermission,
} from "@/lib/pushNotifications";

const notificationTypes = [
  { id: "reservation_confirmation", label: "Confirmation de réservation", desc: "Quand une réservation est acceptée ou refusée", requiresPush: true },
  { id: "rappel_reservation", label: "Rappel de réservation", desc: "Rappel 1h avant votre match", requiresPush: true },
  { id: "promotion", label: "Promotions et offres", desc: "Recevoir les offres spéciales et réductions", requiresPush: true },
  { id: "nouveau_message", label: "Nouveaux messages", desc: "Quand vous recevez un message du support", requiresPush: false },
  { id: "avis_reponse", label: "Réponse à vos avis", desc: "Quand un propriétaire répond à votre avis", requiresPush: false },
] as const;

type PrefKey = (typeof notificationTypes)[number]["id"];

const ProfilNotifications = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported] = useState(isPushSupported());
  const [notifications, setNotifications] = useState<any[]>([]);
  const [settings, setSettings] = useState<Record<PrefKey, boolean>>({
    reservation_confirmation: true,
    rappel_reservation: true,
    promotion: false,
    nouveau_message: true,
    avis_reponse: true,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [notifs, prefs] = await Promise.all([
        notificationsApi.list(),
        pushSupported ? pushApi.getPreferences().catch(() => null) : Promise.resolve(null),
      ]);
      setNotifications(Array.isArray(notifs) ? notifs : []);
      if (prefs) setSettings(prefs as Record<PrefKey, boolean>);
      const permission = await getPushPermission();
      setPushEnabled(permission === 'granted');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [pushSupported]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    loadData();
  }, [isAuthenticated, loadData, navigate]);

  const enablePush = async () => {
    try {
      const sub = await subscribeToPushNotifications();
      if (sub) {
        setPushEnabled(true);
        toast.success('Notifications push activées');
      } else {
        toast.error('Autorisation refusée ou push non disponible');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Impossible d\'activer les notifications push');
    }
  };

  const toggleSetting = async (key: PrefKey) => {
    const next = !settings[key];
    const updated = { ...settings, [key]: next };
    setSettings(updated);

    try {
      if (pushSupported && notificationTypes.find((t) => t.id === key)?.requiresPush) {
        if (next && !pushEnabled) {
          await enablePush();
        }
        await pushApi.updatePreferences(updated);
      }
      toast.success(next ? 'Notification activée' : 'Notification désactivée');
    } catch (err: unknown) {
      setSettings(settings);
      toast.error(err instanceof Error ? err.message : 'Erreur de mise à jour');
    }
  };

  const disableAllPush = async () => {
    try {
      await unsubscribeFromPushNotifications();
      setPushEnabled(false);
      toast.success('Notifications push désactivées');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur de désabonnement');
    }
  };

  const markAsRead = async (id: number) => {
    try {
      await notificationsApi.marquerLue(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, lu: true } : n)));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const markAllAsRead = async () => {
    const unreadIds = notifications.filter((n) => !n.lu).map((n) => n.id);
    for (const id of unreadIds) {
      try {
        await notificationsApi.marquerLue(id);
      } catch {
        /* continue */
      }
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, lu: true })));
    toast.success('Toutes les notifications ont été marquées comme lues');
  };

  const unreadCount = notifications.filter((n) => !n.lu).length;

  return (
    <div className="page-container">
      <div className="flex items-center gap-3 responsive-padding py-4">
        <button type="button" onClick={() => navigate("/profil")} className="bg-muted rounded-full p-2 min-h-[48px] min-w-[48px] flex items-center justify-center">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-display font-bold text-lg sm:text-xl">Notifications</h1>
      </div>

      <div className="max-w-2xl mx-auto">
        {pushSupported && (
          <div className="responsive-padding mt-2">
            <div className="glass-card p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
                  <Wifi className="w-5 h-5 text-[var(--color-primary)]" />
                </div>
                <div>
                  <p className="text-sm font-medium">Notifications push</p>
                  <p className="text-[10px] text-muted-foreground">
                    {pushEnabled ? 'Actives sur cet appareil' : 'Recevez des rappels même app fermée'}
                  </p>
                </div>
              </div>
              {pushEnabled ? (
                <button type="button" onClick={disableAllPush} className="text-xs text-[var(--color-danger)] min-h-[44px] px-3">
                  Désactiver
                </button>
              ) : (
                <button type="button" onClick={enablePush} className="text-xs text-[var(--color-primary)] font-medium min-h-[44px] px-3">
                  Activer
                </button>
              )}
            </div>
          </div>
        )}

        <div className="responsive-padding mt-4">
          <h3 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
            Préférences de notification
          </h3>
          <div className="glass-card divide-y divide-border">
            {notificationTypes.map((type) => (
              <div key={type.id} className="flex items-center justify-between p-4 gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{type.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{type.desc}</p>
                </div>
                <Switch
                  checked={settings[type.id]}
                  onCheckedChange={() => toggleSetting(type.id)}
                  disabled={loading}
                  className="data-[state=checked]:bg-primary flex-shrink-0"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="responsive-padding mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Notifications récentes
            </h3>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllAsRead} className="text-xs text-primary hover:underline min-h-[44px]">
                Tout marquer comme lu
              </button>
            )}
          </div>
          <div className="glass-card divide-y divide-border">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">Chargement…</div>
            ) : notifications.length === 0 ? (
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
                    notif.type === 'confirmation' ? 'bg-accent/20' :
                    notif.type === 'rappel' ? 'bg-secondary/20' : 'bg-muted'
                  }`}>
                    <Bell className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{notif.contenu || notif.titre || notif.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{notif.created_at}</p>
                  </div>
                  {!notif.lu && (
                    <button
                      type="button"
                      onClick={() => markAsRead(notif.id)}
                      className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0"
                      aria-label="Marquer comme lu"
                    >
                      <Check className="w-4 h-4 text-primary" />
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
