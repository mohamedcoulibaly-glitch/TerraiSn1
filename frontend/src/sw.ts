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

/** Données terrains & réservations — stale-while-revalidate */
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.pathname.startsWith('/api/') &&
    (url.pathname.includes('/terrains') ||
      url.pathname.includes('/reservations/mes') ||
      url.pathname.includes('/reservations/')),
  new StaleWhileRevalidate({
    cacheName: 'terrainsn-api-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 64,
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
  url?: string;
  tag?: string;
  type?: string;
}

self.addEventListener('push', (event) => {
  let data: PushPayload = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'TerrainSN', {
      body: data.body || 'Nouvelle notification',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      data: { url: data.url || '/reservations' },
      tag: data.tag || data.type || 'terrainsn',
      vibrate: [100, 50, 100],
      requireInteraction: data.type === 'rappel_reservation',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data?.url as string) || '/reservations';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return (client as WindowClient).focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
