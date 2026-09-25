import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pwaRegister", () => ({
  registerBackgroundSync: vi.fn(),
}));

import { getGerantTerrainActif, setGerantTerrainActif } from "@/lib/api";

const store = new Map<string, string>();

function installLocalStorageMock() {
  store.clear();
  const mock: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  vi.stubGlobal("localStorage", mock);
}

describe("getGerantTerrainActif / setGerantTerrainActif", () => {
  beforeEach(() => {
    installLocalStorageMock();
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      localStorage: globalThis.localStorage,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    store.clear();
  });

  it("retourne null si aucune valeur", () => {
    expect(getGerantTerrainActif()).toBeNull();
  });

  it("persiste et relit un id numérique", () => {
    setGerantTerrainActif(7);
    expect(localStorage.getItem("gerant_terrain_actif")).toBe("7");
    expect(getGerantTerrainActif()).toBe(7);
  });

  it("accepte un id string et le convertit", () => {
    setGerantTerrainActif("12");
    expect(getGerantTerrainActif()).toBe(12);
  });

  it("efface la clé avec null ou chaîne vide", () => {
    setGerantTerrainActif(3);
    expect(getGerantTerrainActif()).toBe(3);
    setGerantTerrainActif(null);
    expect(getGerantTerrainActif()).toBeNull();
    expect(localStorage.getItem("gerant_terrain_actif")).toBeNull();

    setGerantTerrainActif(5);
    setGerantTerrainActif("");
    expect(getGerantTerrainActif()).toBeNull();
  });

  it("retourne null si la valeur stockée n'est pas un nombre", () => {
    localStorage.setItem("gerant_terrain_actif", "abc");
    expect(getGerantTerrainActif()).toBeNull();
  });

  it("émet gerant-terrain-changed au set", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent, localStorage: globalThis.localStorage });
    setGerantTerrainActif(99);
    expect(dispatchEvent).toHaveBeenCalledOnce();
    const evt = dispatchEvent.mock.calls[0][0] as CustomEvent;
    expect(evt.type).toBe("gerant-terrain-changed");
    expect(evt.detail).toBe(99);
  });
});
