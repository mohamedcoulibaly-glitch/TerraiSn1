import { registerSW } from 'virtual:pwa-register';
import {
  getPendingReservations,
  removePendingReservation,
  isOnline,
} from '@/lib/offlineStore';

const API_URL = import.meta.env.VITE_API_URL || '/api';

let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        setInterval(() => registration.update(), 60 * 60 * 1000);
      }
      import('@/lib/pushNotifications').then(({ syncPushSubscription }) => {
        syncPushSubscription().catch(() => {});
      });
    },
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent('pwa-offline-ready'));
    },
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent('pwa-need-refresh'));
    },
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'RESERVATION_SYNC_COMPLETE') {
      window.dispatchEvent(new CustomEvent('reservation-sync-complete'));
    }
  });

  window.addEventListener('online', () => {
    flushPendingReservations();
    registerBackgroundSync();
  });
}

export async function registerBackgroundSync() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('sync' in reg) {
      await (reg as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register('sync-reservations');
    }
  } catch {
    /* Background Sync non supporté — fallback manuel */
  }
  await flushPendingReservations();
}

export async function flushPendingReservations(): Promise<number> {
  if (!isOnline()) return 0;

  const pending = await getPendingReservations();
  let synced = 0;

  for (const item of pending) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (item.token) headers.Authorization = `Bearer ${item.token}`;

      const res = await fetch(`${API_URL}/reservations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(item.payload),
      });

      if (res.ok) {
        await removePendingReservation(item.id);
        synced++;
      }
    } catch {
      /* Réessayer au prochain cycle */
    }
  }

  if (synced > 0) {
    window.dispatchEvent(new CustomEvent('reservation-sync-complete', { detail: { count: synced } }));
  }

  return synced;
}

export function applyServiceWorkerUpdate() {
  updateSW?.(true);
}

export { updateSW };
