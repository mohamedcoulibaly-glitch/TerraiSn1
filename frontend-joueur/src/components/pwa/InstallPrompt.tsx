import { useCallback, useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const DISMISS_KEY = 'terrainsn_pwa_install_dismissed';
const DISMISS_DAYS = 7;
const MIN_VISITS_KEY = 'terrainsn_pwa_visit_count';
const MIN_VISITS = 2;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function wasDismissedRecently(): boolean {
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const dismissedAt = parseInt(raw, 10);
  return Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

function incrementVisitCount(): number {
  const count = parseInt(localStorage.getItem(MIN_VISITS_KEY) || '0', 10) + 1;
  localStorage.setItem(MIN_VISITS_KEY, String(count));
  return count;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (isStandalone() || wasDismissedRecently()) return;

    const visits = incrementVisitCount();

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      if (visits >= MIN_VISITS) {
        setTimeout(() => setVisible(true), 2000);
      }
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setVisible(false);
    } finally {
      setInstalling(false);
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }, []);

  if (!visible || !deferredPrompt) return null;

  return (
    <div
      className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-4 right-4 z-[60] max-w-md mx-auto animate-in slide-in-from-bottom-4 duration-300"
      role="dialog"
      aria-label="Installer TerrainSN"
    >
      <div className="bg-[var(--color-primary)] text-white rounded-[var(--radius-lg)] shadow-xl p-4 flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
          <img src="/icons/icon-96.png" alt="" className="w-10 h-10 rounded-lg" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm" style={{ fontFamily: 'var(--font-display)' }}>
            Installer TerrainSN
          </p>
          <p className="text-xs text-white/80 mt-0.5 leading-relaxed">
            Accédez à vos réservations en un tap — même avec une connexion faible.
          </p>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              onClick={handleInstall}
              disabled={installing}
              className="min-h-[44px] bg-white text-[var(--color-primary)] hover:bg-white/90 font-medium"
            >
              <Download className="w-4 h-4 mr-1.5" />
              {installing ? 'Installation…' : 'Installer'}
            </Button>
            <button
              type="button"
              onClick={handleDismiss}
              className="min-h-[44px] min-w-[44px] px-3 text-xs text-white/70 hover:text-white"
            >
              Plus tard
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/60 hover:text-white -mt-1 -mr-1"
          aria-label="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
