/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { BackgroundSyncPlugin } from 'workbox-background-sync';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const reservationSync = new BackgroundSyncPlugin('reservation-queue', {
  maxRetentionTime: 24 * 60,
  onSync: async ({ queue }) => {
    await queue.replayRequests();
  },
});

/** Assets statiques — cache-first agressif */
registerRoute(
  ({ request }) =>
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'font' ||
    request.destination === 'image',
  new CacheFirst({
    cacheName: 'terrainsn-static-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 120,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
    ],
  }),
);

/** Données API GET — stale-while-revalidate (hors SSE / events) */
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.pathname.startsWith('/api/') &&
    !url.pathname.includes('/events') &&
    !url.pathname.includes('/stream'),
  new StaleWhileRevalidate({
    cacheName: 'terrainsn-api-v2',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 96,
        maxAgeSeconds: 60 * 60 * 24,
      }),
    ],
  }),
);

/** Création réservation — réseau + background sync si hors-ligne */
registerRoute(
  ({ url, request }) =>
    request.method === 'POST' &&
    (url.pathname === '/api/reservations' || url.pathname.endsWith('/reservations')),
  new NetworkFirst({
    cacheName: 'terrainsn-reservation-post-v1',
    networkTimeoutSeconds: 8,
    plugins: [
      reservationSync,
      new CacheableResponsePlugin({ statuses: [0, 200, 201] }),
    ],
  }),
  'POST',
);

/** Navigation SPA — fallback index.html */
const navigationHandler = new NetworkFirst({
  cacheName: 'terrainsn-pages-v1',
  networkTimeoutSeconds: 5,
  plugins: [
    new CacheableResponsePlugin({ statuses: [0, 200] }),
  ],
});

registerRoute(new NavigationRoute(navigationHandler));

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-reservations') {
    event.waitUntil(
      (async () => {
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach((client) =>
          client.postMessage({ type: 'RESERVATION_SYNC_COMPLETE' }),
        );
      })(),
    );
  }
});

interface PushPayload {
  title?: string;
  body?: string;
  icon?: string;
  badge?: string;
  vibrate?: number[];
  tag?: string;
  renotify?: boolean;
  requireInteraction?: boolean;
  url?: string;
  type?: string;
  data?: Record<string, unknown>;
  actions?: { action: string; title: string }[];
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  event.waitUntil((async () => {
    let notif: PushPayload = {};
    try {
      notif = event.data.json() as PushPayload;
    } catch {
      notif = { body: event.data.text() };
    }

    const data = {
      url: (notif.data?.url as string) || notif.url || '/',
      type: notif.type || (notif.data?.type as string) || '',
      ...(notif.data || {}),
    };

    await self.registration.showNotification(notif.title || 'TerrainSN', {
      body: notif.body || 'Nouvelle notification',
      icon: notif.icon || '/icons/icon-192.png',
      badge: notif.badge || '/icons/icon-72.png',
      vibrate: notif.vibrate || [200],
      tag: notif.tag || data.type || 'terrainsn',
      renotify: Boolean(notif.renotify),
      requireInteraction: Boolean(notif.requireInteraction),
      data,
      actions: notif.actions || [],
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const payload = (event.notification.data || {}) as Record<string, unknown>;
  const action = event.action;

  let url = String(payload.url || '/');
  if (action === 'scanner') {
    url = '/backoffice/gerant#scanner';
  } else if (action === 'qr') {
    url = String(payload.url || '/reservations');
  } else if (action === 'voir' || action === 'traiter') {
    url = String(payload.url || '/');
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          const focused = client as WindowClient;
          focused.focus();
          if ('navigate' in focused) {
            return focused.navigate(url);
          }
          return focused;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener('notificationclose', () => {
  /* stats optionnelles — no-op volontaire */
});
