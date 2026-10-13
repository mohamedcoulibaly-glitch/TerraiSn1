import { pushApi } from '@/lib/api';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getPushPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestPushPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isPushSupported()) return 'unsupported';
  return Notification.requestPermission();
}

export async function subscribeToPushNotifications(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;

  const permission = await requestPushPermission();
  if (permission !== 'granted') return null;

  const { publicKey } = await pushApi.getVapidPublicKey();
  const registration = await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  await pushApi.subscribe(subscription.toJSON());
  return subscription;
}

export async function unsubscribeFromPushNotifications(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return true;

  const endpoint = subscription.endpoint;
  await pushApi.unsubscribe(endpoint);
  await subscription.unsubscribe();
  return true;
}

export async function syncPushSubscription(): Promise<void> {
  if (!isPushSupported() || Notification.permission !== 'granted') return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await pushApi.subscribe(subscription.toJSON());
    }
  } catch {
    /* Silencieux — réessayera à la prochaine connexion */
  }
}
