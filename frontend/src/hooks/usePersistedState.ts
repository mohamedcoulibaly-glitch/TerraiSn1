import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "tsn:draft:";

type StorageKind = "local" | "session";

type Envelope<T> = {
  v: T;
  at: number;
};

export type PersistedStateOptions = {
  /** local = survit au refresh ; session = onglet uniquement */
  storage?: StorageKind;
  /** Durée de vie du brouillon (défaut 24 h) */
  ttlMs?: number;
  /** Délai avant écriture (défaut 250 ms) */
  debounceMs?: number;
  /** Si false, ne lit/écrit pas (ex: modal fermé) */
  enabled?: boolean;
};

function getStore(kind: StorageKind): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function fullKey(key: string) {
  return `${PREFIX}${key}`;
}

export function readDraft<T>(
  key: string,
  opts?: { storage?: StorageKind; ttlMs?: number },
): T | null {
  const store = getStore(opts?.storage ?? "local");
  const ttlMs = opts?.ttlMs ?? 1000 * 60 * 60 * 24;
  if (!store) return null;
  try {
    const raw = store.getItem(fullKey(key));
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || typeof env.at !== "number") {
      store.removeItem(fullKey(key));
      return null;
    }
    if (Date.now() - env.at > ttlMs) {
      store.removeItem(fullKey(key));
      return null;
    }
    return env.v as T;
  } catch {
    return null;
  }
}

export function writeDraft<T>(
  key: string,
  value: T,
  opts?: { storage?: StorageKind },
): void {
  const store = getStore(opts?.storage ?? "local");
  if (!store) return;
  try {
    const env: Envelope<T> = { v: value, at: Date.now() };
    store.setItem(fullKey(key), JSON.stringify(env));
  } catch {
    /* quota / private mode */
  }
}

export function clearDraft(key: string, opts?: { storage?: StorageKind }): void {
  const store = getStore(opts?.storage ?? "local");
  if (!store) return;
  try {
    store.removeItem(fullKey(key));
  } catch {
    /* ignore */
  }
}

/**
 * useState + autosave local/session.
 * Au retour sur la page / réouverture du modal, la dernière saisie est restaurée.
 */
export function usePersistedState<T>(
  key: string,
  initialValue: T | (() => T),
  options?: PersistedStateOptions,
): [T, React.Dispatch<React.SetStateAction<T>>, { clear: () => void; hasDraft: boolean }] {
  const storage = options?.storage ?? "local";
  const ttlMs = options?.ttlMs ?? 1000 * 60 * 60 * 24;
  const debounceMs = options?.debounceMs ?? 250;
  const enabled = options?.enabled !== false;

  const resolveInitial = () =>
    typeof initialValue === "function" ? (initialValue as () => T)() : initialValue;

  const [value, setValue] = useState<T>(() => {
    if (!enabled) return resolveInitial();
    return readDraft<T>(key, { storage, ttlMs }) ?? resolveInitial();
  });

  const [hasDraft, setHasDraft] = useState(() => {
    if (!enabled) return false;
    return readDraft<T>(key, { storage, ttlMs }) != null;
  });

  const keyRef = useRef(key);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextWrite = useRef(false);

  // Rehydrate si la clé change (ex: terrainId)
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    if (!enabled) return;
    const draft = readDraft<T>(key, { storage, ttlMs });
    skipNextWrite.current = true;
    setValue(draft ?? resolveInitial());
    setHasDraft(draft != null);
  }, [key, enabled, storage, ttlMs]);

  // Autosave
  useEffect(() => {
    if (!enabled) return;
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      writeDraft(key, value, { storage });
      setHasDraft(true);
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, key, enabled, storage, debounceMs]);

  const clear = useCallback(() => {
    clearDraft(key, { storage });
    skipNextWrite.current = true;
    setValue(resolveInitial());
    setHasDraft(false);
  }, [key, storage]);

  return [value, setValue, { clear, hasDraft }];
}
