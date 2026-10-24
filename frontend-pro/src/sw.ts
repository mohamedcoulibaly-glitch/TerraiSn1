/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

/** Assets statiques — cache-first agressif */
registerRoute(
  ({ request }) =>
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'font' ||
    request.destination === 'image',
  new CacheFirst({
    cacheName: 'terrainsn-pro-static-v2',
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
    !url.pathname.includes('/stream') &&
    // notifications manquées : toujours fraîches (sinon SWR rejouerait des notifs déjà vues)
    !url.pathname.includes('/push/missed'),
  new StaleWhileRevalidate({
    cacheName: 'terrainsn-pro-api-v2',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 96,
        maxAgeSeconds: 60 * 60 * 24,
      }),
    ],
  }),
);

/** Navigation SPA — fallback index.html */
const navigationHandler = new NetworkFirst({
  cacheName: 'terrainsn-pro-pages-v2',
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
  /** id de la ligne push_logs côté serveur (permet de marquer la notif comme cliquée) */
  logId?: number;
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

    const scopeBase = new URL(self.registration.scope).pathname.replace(/\/?$/, '/');
    const withScope = (path: string) => {
      if (!path || path.startsWith('http')) return path || scopeBase;
      if (path.startsWith(scopeBase)) return path;
      const clean = path.startsWith('/') ? path.slice(1) : path;
      return `${scopeBase}${clean}`;
    };

    const data = {
      url: withScope((notif.data?.url as string) || notif.url || '/'),
      type: notif.type || (notif.data?.type as string) || '',
      logId: notif.logId ?? (notif.data?.logId as number | undefined),
      ...(notif.data || {}),
    };

    // `vibrate` est supporté par les navigateurs mais absent de NotificationOptions (lib.dom).
    const options: NotificationOptions & {
      vibrate?: number[];
      renotify?: boolean;
      actions?: Array<{ action: string; title: string; icon?: string }>;
    } = {
      body: notif.body || 'Nouvelle notification',
      icon: notif.icon || withScope('/icons/icon-192.png'),
      badge: notif.badge || withScope('/icons/icon-72.png'),
      vibrate: notif.vibrate || [200],
      tag: notif.tag || data.type || 'terrainsn-pro',
      renotify: Boolean(notif.renotify),
      requireInteraction: Boolean(notif.requireInteraction),
      data,
      actions: notif.actions || [],
    };
    await self.registration.showNotification(notif.title || 'TerrainSN Pro', options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const payload = (event.notification.data || {}) as Record<string, unknown>;
  const action = event.action;
  const scopeBase = new URL(self.registration.scope).pathname.replace(/\/?$/, '/');
  const withScope = (path: string) => {
    if (!path || path.startsWith('http')) return path || scopeBase;
    if (path.startsWith(scopeBase)) return path;
    const clean = path.startsWith('/') ? path.slice(1) : path;
    return `${scopeBase}${clean}`;
  };

  let url = withScope(String(payload.url || '/'));
  if (action === 'scanner') {
    url = withScope('/backoffice/gerant#scanner');
  } else if (action === 'voir' || action === 'traiter') {
    url = withScope(String(payload.url || '/'));
  }

  // Marque la notif comme cliquée côté serveur : la page consomme ?push_log=ID au chargement
  // (src/lib/missedNotifications.ts → POST /api/push/missed/seen) pour ne pas la rejouer en toast.
  const logId = Number(payload.logId);
  if (Number.isInteger(logId) && logId > 0) {
    try {
      const target = new URL(url, self.location.origin);
      target.searchParams.set('push_log', String(logId));
      url = `${target.pathname}${target.search}${target.hash}`;
    } catch {
      /* URL invalide : on garde l'originale */
    }
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
