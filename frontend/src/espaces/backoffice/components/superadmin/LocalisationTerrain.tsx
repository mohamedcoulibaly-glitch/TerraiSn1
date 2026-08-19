import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Loader2, MapPin, Navigation, Search } from "lucide-react";
import { toast } from "sonner";
import type { Map as LeafletMap, Marker as LeafletMarker, Circle as LeafletCircle, LeafletMouseEvent } from "leaflet";

export interface LocalisationTerrainProps {
  adresseTheorique: string;
  adresseNominatim: string;
  latitude: number | null;
  longitude: number | null;
  onChangeAdresseTheorique: (v: string) => void;
  onChangeCoordonnees: (lat: number, lng: number, adresseNominatim: string) => void;
  erreur?: string;
}

type NominatimHit = {
  lat: string;
  lon: string;
  display_name?: string;
  name?: string;
  address?: Record<string, string>;
};

const DAKAR: [number, number] = [14.6937, -17.4441];
const NOMINATIM_MIN_INTERVAL_MS = 1000;

let lastNominatimAt = 0;

function saVar(name: string) {
  const root = document.querySelector(".superadmin-app") as HTMLElement | null;
  return getComputedStyle(root || document.documentElement).getPropertyValue(name).trim();
}

function formatCoord(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(4);
}

function lieuPrincipal(hit: NominatimHit) {
  return (
    hit.name ||
    hit.address?.suburb ||
    hit.address?.neighbourhood ||
    hit.address?.quarter ||
    hit.address?.village ||
    hit.address?.town ||
    hit.address?.city ||
    hit.display_name?.split(",")[0]?.trim() ||
    "Lieu"
  );
}

async function waitNominatimSlot() {
  const wait = Math.max(0, NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastNominatimAt));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNominatimAt = Date.now();
}

async function searchNominatim(query: string, signal: AbortSignal): Promise<NominatimHit[]> {
  await waitNominatimSlot();
  if (signal.aborted) return [];
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${query}, Sénégal`);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "sn");
  url.searchParams.set("addressdetails", "1");
  const res = await fetch(url.toString(), {
    headers: { "Accept-Language": "fr", Accept: "application/json" },
    signal,
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data.slice(0, 5) : [];
}

async function reverseNominatim(lat: number, lng: number, signal?: AbortSignal): Promise<string> {
  await waitNominatimSlot();
  if (signal?.aborted) return "";
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "json");
  const res = await fetch(url.toString(), {
    headers: { "Accept-Language": "fr", Accept: "application/json" },
    signal,
  });
  if (!res.ok) return "";
  const data = await res.json();
  return typeof data?.display_name === "string" ? data.display_name : "";
}

const inputClass = "w-full h-11 rounded-lg px-3 text-sm";
const inputStyle = {
  border: "1px solid var(--sa-border)",
  background: "var(--sa-surface)",
  color: "var(--sa-text)",
};

export default function LocalisationTerrain({
  adresseTheorique,
  adresseNominatim,
  latitude,
  longitude,
  onChangeAdresseTheorique,
  onChangeCoordonnees,
  erreur,
}: LocalisationTerrainProps) {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const circleRef = useRef<LeafletCircle | null>(null);
  const circleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const coordsRef = useRef({ latitude, longitude });
  const reverseAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const onChangeCoordonneesRef = useRef(onChangeCoordonnees);
  const adresseNominatimRef = useRef(adresseNominatim);

  const [mapReady, setMapReady] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  coordsRef.current = { latitude, longitude };
  onChangeCoordonneesRef.current = onChangeCoordonnees;
  adresseNominatimRef.current = adresseNominatim;
  const hasCoords = latitude != null && longitude != null && Number.isFinite(latitude) && Number.isFinite(longitude);

  const hideCircleTemporarily = useCallback(() => {
    if (circleTimerRef.current) clearTimeout(circleTimerRef.current);
    circleRef.current?.setStyle({ opacity: 0, fillOpacity: 0 });
    circleTimerRef.current = setTimeout(() => {
      circleRef.current?.setStyle({ opacity: 0.7, fillOpacity: 0.15 });
    }, 1000);
  }, []);

  const applyCoords = useCallback(async (lat: number, lng: number, doReverse: boolean) => {
    let adresse = adresseNominatimRef.current;
    if (doReverse) {
      reverseAbortRef.current?.abort();
      const controller = new AbortController();
      reverseAbortRef.current = controller;
      try {
        adresse = await reverseNominatim(lat, lng, controller.signal);
      } catch (err) {
        if ((err as Error).name !== "AbortError") adresse = adresseNominatimRef.current;
      }
    }
    onChangeCoordonneesRef.current(lat, lng, adresse || "");
  }, []);

  const placeMarker = useCallback(
    (lat: number, lng: number, L: typeof import("leaflet")) => {
      const map = mapRef.current;
      if (!map) return;
      const success = saVar("--sa-success");
      const surface = saVar("--sa-surface");
      const shadow = saVar("--sa-shadow-md");
      const icon = L.divIcon({
        className: "localisation-terrain-marker",
        html: `<div style="width:36px;height:36px;border-radius:50%;background:${success};color:${surface};display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:${shadow};border:2px solid ${surface}">⚽</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        popupAnchor: [0, -36],
      });

      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
        markerRef.current.setIcon(icon);
      } else {
        const marker = L.marker([lat, lng], { draggable: true, icon }).addTo(map);
        marker.bindTooltip("Glisse pour ajuster la position", { direction: "top", offset: [0, -28] });
        marker.on("dragstart", () => hideCircleTemporarily());
        marker.on("drag", () => {
          const pos = marker.getLatLng();
          circleRef.current?.setLatLng(pos);
        });
        marker.on("dragend", () => {
          const pos = marker.getLatLng();
          hideCircleTemporarily();
          void applyCoords(pos.lat, pos.lng, true);
        });
        markerRef.current = marker;
      }

      if (circleRef.current) {
        circleRef.current.setLatLng([lat, lng]);
      } else {
        circleRef.current = L.circle([lat, lng], {
          radius: 50,
          color: success,
          fillColor: success,
          fillOpacity: 0.15,
          weight: 1,
          opacity: 0.7,
        }).addTo(map);
      }
    },
    [applyCoords, hideCircleTemporarily],
  );

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const leafletMod = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      const L = leafletMod.default;
      if (cancelled || !mapElRef.current || mapRef.current) return;
      leafletRef.current = L;
      const { latitude: lat, longitude: lng } = coordsRef.current;
      const has = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
      const map = L.map(mapElRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView(has ? [lat, lng] : DAKAR, has ? 16 : 12);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      map.on("click", (e: LeafletMouseEvent) => {
        const nextL = leafletRef.current;
        if (!nextL) return;
        hideCircleTemporarily();
        placeMarker(e.latlng.lat, e.latlng.lng, nextL);
        void applyCoords(e.latlng.lat, e.latlng.lng, true);
      });

      mapRef.current = map;
      if (has) placeMarker(lat, lng, L);
      setTimeout(() => map.invalidateSize(), 80);
      setMapReady(true);
    }
    void boot();
    return () => {
      cancelled = true;
      if (circleTimerRef.current) clearTimeout(circleTimerRef.current);
      reverseAbortRef.current?.abort();
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
  }, [applyCoords, hideCircleTemporarily, placeMarker]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || latitude == null || longitude == null) return;
    placeMarker(latitude, longitude, L);
  }, [latitude, longitude, placeMarker]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    const timer = setTimeout(() => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      setSearching(true);
      setDropdownOpen(true);
      void searchNominatim(q, controller.signal)
        .then((hits) => {
          if (!controller.signal.aborted) setResults(hits);
        })
        .catch((err) => {
          if ((err as Error).name !== "AbortError") setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 500);
    return () => {
      clearTimeout(timer);
      searchAbortRef.current?.abort();
    };
  }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDropdownOpen(false);
    }
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target) || searchWrapRef.current?.contains(target)) return;
      setDropdownOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, []);

  function selectHit(hit: NominatimHit) {
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const L = leafletRef.current;
    const map = mapRef.current;
    if (L && map) {
      map.setView([lat, lng], 16);
      placeMarker(lat, lng, L);
    }
    onChangeCoordonnees(lat, lng, hit.display_name || "");
    setDropdownOpen(false);
  }

  function useMyPosition() {
    if (!navigator.geolocation) {
      toast.error("Impossible d'accéder à votre position");
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const L = leafletRef.current;
        const map = mapRef.current;
        if (L && map) {
          map.setView([lat, lng], 16);
          placeMarker(lat, lng, L);
        }
        void applyCoords(lat, lng, true).finally(() => setGeoLoading(false));
      },
      () => {
        setGeoLoading(false);
        toast.error("Impossible d'accéder à votre position");
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  async function copyCoords() {
    if (!hasCoords) return;
    const text = `${latitude!.toFixed(4)}, ${longitude!.toFixed(4)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copie impossible");
    }
  }

  const showDropdown = dropdownOpen && query.trim().length >= 3;

  return (
    <section
      id="sa-localisation-terrain"
      className="rounded-xl scroll-mt-24"
      style={{
        background: "var(--sa-surface)",
        borderRadius: 12,
        padding: 20,
        borderTop: "3px solid var(--sa-primary)",
        boxShadow: "var(--sa-shadow)",
      }}
    >
      <h3 className="text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
        Localisation du terrain
      </h3>

      <label className="mt-4 block">
        <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>
          Adresse pour les joueurs
        </span>
        <input
          className={`${inputClass} mt-1`}
          style={inputStyle}
          value={adresseTheorique}
          onChange={(e) => onChangeAdresseTheorique(e.target.value)}
          placeholder="Ex : Fass Dakar, à côté de la place de la Nation"
          required
        />
        <span className="mt-1 block text-[12px] leading-snug" style={{ color: "var(--sa-muted)" }}>
          Description simple que le joueur comprend.
          <br />
          Elle s&apos;affichera sur la fiche terrain.
        </span>
      </label>

      <div className="mt-4 relative" ref={searchWrapRef}>
        <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>
          Rechercher sur la carte
        </span>
        <div className="relative mt-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--sa-muted)" }}
          />
          <input
            className={`${inputClass} pl-9`}
            style={inputStyle}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setDropdownOpen(true);
            }}
            onFocus={() => {
              if (query.trim().length >= 3) setDropdownOpen(true);
            }}
            placeholder="Tapez un lieu, quartier ou adresse..."
            autoComplete="off"
          />
        </div>
        {showDropdown ? (
          <div
            ref={dropdownRef}
            className="absolute z-20 mt-1 w-full overflow-hidden"
            style={{
              background: "var(--sa-surface)",
              boxShadow: "var(--sa-shadow-md)",
              borderRadius: 8,
              border: "1px solid var(--sa-border)",
            }}
          >
            {searching ? (
              <p className="flex items-center gap-2 px-3 py-3 text-[13px]" style={{ color: "var(--sa-muted)" }}>
                <Loader2 size={14} className="animate-spin" />
                Recherche en cours...
              </p>
            ) : results.length === 0 ? (
              <p className="px-3 py-3 text-[13px]" style={{ color: "var(--sa-muted)" }}>
                Aucun résultat. Placez le marqueur manuellement.
              </p>
            ) : (
              results.map((hit) => (
                <button
                  key={`${hit.lat}-${hit.lon}-${hit.display_name}`}
                  type="button"
                  className="w-full text-left px-3 py-2.5 flex items-start gap-2"
                  style={{ borderBottom: "1px solid var(--sa-border)" }}
                  onClick={() => selectHit(hit)}
                >
                  <MapPin size={14} className="mt-0.5 shrink-0" style={{ color: "var(--sa-muted)" }} />
                  <span className="min-w-0">
                    <span className="block text-[13px] leading-tight" style={{ color: "var(--sa-text)" }}>
                      {lieuPrincipal(hit)}
                    </span>
                    <span className="block text-[11px] mt-0.5 leading-snug" style={{ color: "var(--sa-muted)" }}>
                      {hit.display_name}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      <div
        className="relative mt-4 overflow-hidden h-[240px] md:h-[320px]"
        style={{
          borderRadius: 10,
          background: "var(--sa-surface-2)",
        }}
      >
        <div ref={mapElRef} className="absolute inset-0 z-0" />
        {!mapReady ? (
          <div className="absolute inset-0 grid place-items-center" style={{ background: "var(--sa-surface-2)" }}>
            <Loader2 className="animate-spin" size={22} style={{ color: "var(--sa-muted)" }} />
          </div>
        ) : null}
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none"
          style={{ zIndex: 1000 }}
        >
          <p
            className="whitespace-nowrap text-[11px]"
            style={{
              background: "color-mix(in srgb, var(--sa-surface) 85%, transparent)",
              backdropFilter: "blur(6px)",
              borderRadius: 6,
              padding: "6px 10px",
              color: "var(--sa-muted)",
            }}
          >
            {hasCoords
              ? "Glissez le marqueur pour ajuster la position exacte"
              : "Recherchez un lieu ci-dessus ou cliquez sur la carte"}
          </p>
        </div>
      </div>

      <div
        className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2"
        style={{
          background: "var(--sa-surface-2)",
          borderRadius: 8,
          padding: "10px 14px",
        }}
      >
        <p className="text-[13px]">
          <span style={{ color: "var(--sa-muted)" }}>Latitude : </span>
          <span style={{ color: hasCoords ? "var(--sa-success)" : "var(--sa-danger)", fontWeight: 600 }}>
            {formatCoord(latitude)}
          </span>
        </p>
        <p className="text-[13px]">
          <span style={{ color: "var(--sa-muted)" }}>Longitude : </span>
          <span style={{ color: hasCoords ? "var(--sa-success)" : "var(--sa-danger)", fontWeight: 600 }}>
            {formatCoord(longitude)}
          </span>
        </p>
        <button
          type="button"
          disabled={!hasCoords}
          onClick={() => void copyCoords()}
          className="ml-auto inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] font-semibold"
          style={{
            border: "1px solid var(--sa-border)",
            color: "var(--sa-text-2)",
            background: "var(--sa-surface)",
            opacity: hasCoords ? 1 : 0.5,
          }}
        >
          <Copy size={12} />
          {copied ? "Copié" : "Copier"}
        </button>
      </div>
      {!hasCoords ? (
        <p className="mt-2 text-[12px]" style={{ color: "var(--sa-danger)" }}>
          Position non définie — obligatoire pour activer le terrain
        </p>
      ) : null}
      {erreur ? (
        <p className="mt-2 text-[12px]" style={{ color: "var(--sa-danger)" }}>
          {erreur}
        </p>
      ) : null}

      <button
        type="button"
        onClick={useMyPosition}
        disabled={geoLoading}
        className="mt-3 inline-flex items-center gap-2 h-10 px-3 rounded-lg text-[13px] font-medium"
        style={{
          background: "var(--sa-surface-2)",
          border: "1px solid var(--sa-border)",
          color: "var(--sa-text)",
        }}
      >
        {geoLoading ? <Loader2 size={14} className="animate-spin" /> : <Navigation size={14} />}
        {geoLoading ? "Localisation en cours..." : "Utiliser ma position actuelle"}
      </button>
    </section>
  );
}
