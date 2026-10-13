import { useCallback, useEffect, useState } from 'react';
import { pushApi } from '@/lib/api';

export type PushStatus = 'unsupported' | 'denied' | 'granted' | 'default' | 'loading';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>('loading');
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);

  const refresh = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setStatus('unsupported');
      return;
    }
    const permission = Notification.permission;
    if (permission === 'denied') {
      setStatus('denied');
      return;
    }
    if (permission === 'granted') {
      try {
        const sw = await navigator.serviceWorker.ready;
        const sub = await sw.pushManager.getSubscription();
        setSubscription(sub);
        setStatus('granted');
      } catch {
        setStatus('granted');
      }
      return;
    }
    setStatus('default');
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const requestPermission = useCallback(async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'default');
        return false;
      }
      const { publicKey } = await pushApi.getVapidPublicKey();
      const sw = await navigator.serviceWorker.ready;
      let sub = await sw.pushManager.getSubscription();
      if (!sub) {
        sub = await sw.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      await pushApi.subscribe(sub.toJSON());
      setSubscription(sub);
      setStatus('granted');
      return true;
    } catch (err) {
      console.error('[Push] activation', err);
      setStatus('denied');
      return false;
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    if (!subscription) return;
    await pushApi.unsubscribe(subscription.endpoint);
    await subscription.unsubscribe();
    setSubscription(null);
    setStatus('default');
  }, [subscription]);

  return { status, subscription, requestPermission, unsubscribe, refresh };
}
