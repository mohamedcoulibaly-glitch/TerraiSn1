import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

type MapTerrainProps = {
  latitude?: number | null;
  longitude?: number | null;
  nom?: string;
  quartier?: string;
  /** Si false, la carte n'est pas montée (évite conflit z-index avec galerie fullscreen). */
  active?: boolean;
};

/** Tuiles Carto Voyager (lisibilité labels + retina). */
const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

export default function MapTerrain({
  latitude,
  longitude,
  nom,
  quartier,
  active = true,
}: MapTerrainProps) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hasCoords || !active) {
      setReady(false);
      return;
    }
    let cancelled = false;
    let map: { remove: () => void } | null = null;
    async function boot() {
      const leafletMod = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      const L = leafletMod.default;
      if (cancelled || !mapElRef.current) return;
      const instance = L.map(mapElRef.current, {
        zoomControl: true,
        dragging: true,
        scrollWheelZoom: false,
        preferCanvas: true,
      }).setView([lat, lng], 16);
      L.tileLayer(TILE_URL, {
        maxZoom: 20,
        maxNativeZoom: 20,
        attribution: TILE_ATTR,
        subdomains: "abcd",
        detectRetina: true,
      }).addTo(instance);
      const success =
        getComputedStyle(document.documentElement).getPropertyValue("--color-success").trim() ||
        getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() ||
        "#059669";
      const icon = L.divIcon({
        className: "map-terrain-marker",
        html: `<div class="map-terrain-pin" style="--pin:${success}"><span></span></div>`,
        iconSize: [40, 48],
        iconAnchor: [20, 46],
      });
      const marker = L.marker([lat, lng], { icon, draggable: false }).addTo(instance);
      const label = [nom, quartier].filter(Boolean).join(" · ");
      if (label) {
        marker.bindTooltip(label, {
          direction: "top",
          offset: [0, -40],
          className: "map-terrain-tooltip",
          opacity: 1,
        });
      }
      L.circle([lat, lng], {
        radius: 45,
        color: success,
        fillColor: success,
        fillOpacity: 0.12,
        weight: 1.5,
      }).addTo(instance);
      map = instance;
      setTimeout(() => instance.invalidateSize(), 100);
      setReady(true);
    }
    void boot();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [hasCoords, lat, lng, nom, quartier, active]);

  if (!hasCoords) return null;
  if (!active) {
    return (
      <div className="relative overflow-hidden h-[220px] sm:h-[280px] rounded-[10px] bg-[var(--surface-2)] grid place-items-center">
        <p className="text-xs text-[var(--color-text-muted)]">Carte masquée pendant la galerie</p>
      </div>
    );
  }

  return (
    <div className="map-terrain-shell relative overflow-hidden h-[220px] sm:h-[280px] rounded-[10px] bg-[var(--surface-2)] isolate">
      <div ref={mapElRef} className="absolute inset-0 z-0" />
      {!ready ? (
        <div className="absolute inset-0 z-[1] grid place-items-center bg-[var(--surface-2)]">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-muted)]" />
        </div>
      ) : null}
    </div>
  );
}
