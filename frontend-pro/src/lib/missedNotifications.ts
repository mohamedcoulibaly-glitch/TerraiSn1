/**
 * Notifications manquées (push non vus / sans abonnement push) → toasts à la connexion.
 *
 * Flux : GET /api/push/missed → toast par notification (niveau success|error|warning|info)
 *        → POST /api/push/missed/seen (clique = 1) une fois affichées.
 */
import { toast } from "sonner";
import { pushApi } from "@/lib/api";

export type ToastLevel = "success" | "error" | "warning" | "info";

export interface MissedNotification {
  id: number;
  type: string;
  titre: string;
  corps: string;
  statut: string;
  level: ToastLevel;
  url: string | null;
  created_at: string;
}

/** Au-delà, les notifications restantes sont regroupées dans un toast récapitulatif. */
const MAX_INDIVIDUAL_TOASTS = 5;
const STAGGER_MS = 450;
const REFETCH_MIN_INTERVAL_MS = 5 * 60 * 1000;
const PUSH_LOG_PARAM = "push_log";

let inFlight: Promise<number> | null = null;
let lastKey = "";
let lastRunAt = 0;

function isLevel(value: unknown): value is ToastLevel {
  return value === "success" || value === "error" || value === "warning" || value === "info";
}

function withBase(path: string): string {
  const base = String(import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
  if (!path || path.startsWith("http")) return path;
  if (path.startsWith(base)) return path;
  const clean = path.startsWith("/") ? path.slice(1) : path;
  return `${base}${clean}`;
}

function navigateTo(url: string) {
  try {
    const scoped = withBase(url);
    const target = new URL(scoped, window.location.origin);
    if (target.origin !== window.location.origin) return;
    // BrowserRouter écoute popstate → navigation SPA sans rechargement
    window.history.pushState({}, "", `${target.pathname}${target.search}${target.hash}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    /* URL invalide : ignorée */
  }
}

function showOne(notification: MissedNotification) {
  const level: ToastLevel = isLevel(notification.level) ? notification.level : "info";
  const url = notification.url;
  toast[level](notification.titre, {
    description: notification.corps,
    id: `missed-${notification.id}`,
    action: url
      ? { label: "Voir", onClick: () => navigateTo(url) }
      : undefined,
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Notification système cliquée (?push_log=ID) : la marque comme vue puis nettoie l'URL. */
export function consumePushLogParam(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get(PUSH_LOG_PARAM);
    if (!raw) return null;
    url.searchParams.delete(PUSH_LOG_PARAM);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) {
      void pushApi.markMissedSeen([id]).catch(() => undefined);
      return id;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Récupère et affiche les notifications manquées.
 * @returns le nombre de notifications affichées (récapitulatif inclus dans le compte)
 */
export async function showMissedNotifications(): Promise<number> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    consumePushLogParam();

    let items: MissedNotification[] = [];
    try {
      const data = await pushApi.getMissed();
      items = Array.isArray(data) ? (data as MissedNotification[]) : [];
    } catch {
      return 0; // hors-ligne / 401 : réessaiera à la prochaine connexion
    }
    if (!items.length) return 0;

    // du plus ancien au plus récent : le dernier arrivé reste en haut de la pile
    const ordered = [...items].reverse();
    const individuals = ordered.slice(-MAX_INDIVIDUAL_TOASTS);
    const hidden = ordered.length - individuals.length;

    if (hidden > 0) {
      toast.info(`${hidden} autre${hidden > 1 ? "s" : ""} notification${hidden > 1 ? "s" : ""} manquée${hidden > 1 ? "s" : ""}`, {
        description: "Pendant ton absence (dernières 24 h).",
        id: "missed-summary",
      });
      await sleep(STAGGER_MS);
    }
    for (const notification of individuals) {
      showOne(notification);
      await sleep(STAGGER_MS);
    }

    try {
      await pushApi.markMissedSeen(items.map((n) => n.id));
    } catch {
      /* sera réaffichée au prochain passage, sans conséquence */
    }
    return items.length;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * À appeler à la connexion / restauration de session. Une seule exécution par compte
 * tant que la page reste ouverte ; `force` relance (ex. retour sur l'onglet).
 */
export function checkMissedNotificationsForUser(userKey: string, { force = false } = {}): void {
  const now = Date.now();
  if (!force && userKey === lastKey) return;
  if (force && now - lastRunAt < REFETCH_MIN_INTERVAL_MS) return;
  lastKey = userKey;
  lastRunAt = now;
  // laisse le <Toaster /> finir de monter (AuthProvider monte avant ses enfants)
  setTimeout(() => {
    void showMissedNotifications();
  }, 400);
}

export function resetMissedNotificationsState(): void {
  lastKey = "";
  lastRunAt = 0;
}