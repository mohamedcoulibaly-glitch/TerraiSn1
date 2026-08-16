import { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { isOnline } from '@/lib/offlineStore';
import { applyServiceWorkerUpdate } from '@/lib/pwaRegister';

export default function OfflineBanner() {
  const [offline, setOffline] = useState(!isOnline());
  const [needsRefresh, setNeedsRefresh] = useState(false);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    window.addEventListener('pwa-need-refresh', () => setNeedsRefresh(true));

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (needsRefresh) {
    return (
      <div className="fixed top-14 left-0 right-0 z-[55] bg-[var(--color-info)] text-white px-4 py-2 flex items-center justify-between gap-3 text-sm safe-top">
        <span>Nouvelle version disponible</span>
        <button
          type="button"
          onClick={() => applyServiceWorkerUpdate()}
          className="min-h-[44px] px-3 font-medium underline flex items-center gap-1"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Mettre à jour
        </button>
      </div>
    );
  }

  if (!offline) return null;

  return (
    <div className="fixed top-14 left-0 right-0 z-[55] bg-[var(--color-warning)] text-white px-4 py-2.5 flex items-center gap-2 text-sm">
      <WifiOff className="w-4 h-4 flex-shrink-0" />
      <span>Mode hors-ligne — vos réservations en cache restent accessibles</span>
    </div>
  );
}
