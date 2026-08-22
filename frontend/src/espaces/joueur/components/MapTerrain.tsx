import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

type MapTerrainProps = {
  latitude?: number | null;
  longitude?: number | null;
  nom?: string;
  quartier?: string;
};

export default function MapTerrain({ latitude, longitude, nom, quartier }: MapTerrainProps) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hasCoords) return;
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
      }).setView([lat, lng], 16);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(instance);
      const success = getComputedStyle(document.documentElement).getPropertyValue("--color-success").trim()
        || getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
      const icon = L.divIcon({
        className: "map-terrain-marker",
        html: `<div style="width:36px;height:36px;border-radius:50%;background:${success};color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;border:2px solid #fff">⚽</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
      });
      const marker = L.marker([lat, lng], { icon, draggable: false }).addTo(instance);
      const label = [nom, quartier].filter(Boolean).join(" · ");
      if (label) marker.bindTooltip(label, { direction: "top", offset: [0, -28] });
      L.circle([lat, lng], {
        radius: 50,
        color: success,
        fillColor: success,
        fillOpacity: 0.15,
        weight: 1,
      }).addTo(instance);
      map = instance;
      setTimeout(() => instance.invalidateSize(), 80);
      setReady(true);
    }
    void boot();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [hasCoords, lat, lng, nom, quartier]);

  if (!hasCoords) return null;

  return (
    <div className="relative overflow-hidden h-[220px] sm:h-[280px] rounded-[10px] bg-[var(--surface-2)]">
      <div ref={mapElRef} className="absolute inset-0" />
      {!ready ? (
        <div className="absolute inset-0 grid place-items-center bg-[var(--surface-2)]">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-muted)]" />
        </div>
      ) : null}
    </div>
  );
}
