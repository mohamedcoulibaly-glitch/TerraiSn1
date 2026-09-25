import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { usePushNotifications } from '@/hooks/usePushNotifications';

const STORAGE_KEY = 'push_banner_dismissed';

export default function PushPermissionBanner() {
  const { isAuthenticated } = useAuth();
  const { status, requestPermission } = usePushNotifications();
  const [hidden, setHidden] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');

  if (!isAuthenticated || hidden || status !== 'default') return null;

  const activate = async () => {
    const ok = await requestPermission();
    if (ok) {
      localStorage.setItem(STORAGE_KEY, '1');
      setHidden(true);
    }
  };

  const later = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setHidden(true);
  };

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 md:left-auto md:right-6 md:w-96">
      <div
        className="rounded-xl p-4 flex flex-col gap-3"
        style={{
          background: 'var(--color-surface, var(--g-surface, var(--sa-surface, var(--p-surface))))',
          border: '1px solid var(--color-border, var(--g-border, var(--sa-border, var(--p-border))))',
          boxShadow: 'var(--shadow-lg, 0 12px 40px color-mix(in srgb, var(--color-text, #111) 18%, transparent))',
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'color-mix(in srgb, var(--color-primary, var(--g-primary, var(--sa-primary, var(--p-primary)))) 16%, transparent)' }}
          >
            <Bell className="w-5 h-5" style={{ color: 'var(--color-primary, var(--g-primary, var(--sa-primary, var(--p-primary))))' }} />
          </div>
          <div>
            <p className="font-semibold text-sm" style={{ color: 'var(--text-primary, var(--g-text, var(--sa-text, var(--p-text))))' }}>
              Activer les notifications
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted, var(--g-muted, var(--sa-muted, var(--p-muted))))' }}>
              Reçois les confirmations de réservation, rappels de match et alertes terrain directement sur cet appareil.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={activate}
            className="flex-1 py-2 rounded-lg text-sm font-semibold text-white min-h-[44px]"
            style={{ background: 'var(--color-primary, var(--g-primary, var(--sa-primary, var(--p-primary))))' }}
          >
            Activer
          </button>
          <button
            type="button"
            onClick={later}
            className="px-4 py-2 rounded-lg text-sm min-h-[44px]"
            style={{
              background: 'var(--color-surface-2, var(--g-surface-2, var(--sa-surface-2, var(--p-surface-2))))',
              color: 'var(--text-muted, var(--g-muted, var(--sa-muted, var(--p-muted))))',
            }}
          >
            Plus tard
          </button>
        </div>
      </div>
    </div>
  );
}
