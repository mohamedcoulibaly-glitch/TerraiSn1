import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Star, Trash2, Upload, Camera } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi, type TerrainPhoto } from "@/services/superAdminApi";

export type LocalPhoto = {
  key: string;
  file: File;
  preview: string;
  est_principale: boolean;
};

type Props = {
  terrainId?: number | null;
  photos?: TerrainPhoto[];
  onPhotosChange?: (photos: TerrainPhoto[]) => void;
  localPhotos?: LocalPhoto[];
  onLocalPhotosChange?: (photos: LocalPhoto[]) => void;
};

const MAX = 5;
const ACCEPT = "image/jpeg,image/png,image/webp";

function fileOk(file: File) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    toast.error("JPG, PNG ou WEBP uniquement");
    return false;
  }
  if (file.size > 5 * 1024 * 1024) {
    toast.error("5 Mo max par photo");
    return false;
  }
  return true;
}

export default function PhotoUploadTerrain({
  terrainId,
  photos = [],
  onPhotosChange,
  localPhotos = [],
  onLocalPhotosChange,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const remote = Boolean(terrainId);

  const count = remote ? photos.length : localPhotos.length;

  const items = useMemo(() => {
    if (remote) {
      return photos.map((p) => ({
        key: String(p.id),
        url: p.url,
        est_principale: Boolean(p.est_principale),
        id: p.id,
      }));
    }
    return localPhotos.map((p) => ({
      key: p.key,
      url: p.preview,
      est_principale: p.est_principale,
      id: p.key,
    }));
  }, [remote, photos, localPhotos]);

  async function ingestFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(fileOk);
    if (!files.length) return;
    if (count + files.length > MAX) {
      toast.error("Maximum 5 photos atteint");
      return;
    }

    if (!remote) {
      const next = [...localPhotos];
      for (const file of files) {
        if (next.length >= MAX) break;
        next.push({
          key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          file,
          preview: URL.createObjectURL(file),
          est_principale: next.length === 0,
        });
      }
      onLocalPhotosChange?.(next);
      return;
    }

    for (const file of files) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      setUploading((prev) => ({ ...prev, [key]: 15 }));
      try {
        const timer = window.setInterval(() => {
          setUploading((prev) => ({ ...prev, [key]: Math.min(90, (prev[key] || 15) + 12) }));
        }, 180);
        await superAdminApi.uploadTerrainPhotoFile(Number(terrainId), file, photos.length === 0);
        window.clearInterval(timer);
        setUploading((prev) => ({ ...prev, [key]: 100 }));
        const refreshed = await superAdminApi.terrainPhotos(Number(terrainId));
        onPhotosChange?.(refreshed);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload impossible");
      } finally {
        setUploading((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    }
  }

  async function setPrincipale(item: (typeof items)[number]) {
    if (!remote) {
      onLocalPhotosChange?.(localPhotos.map((p) => ({ ...p, est_principale: p.key === item.key })));
      return;
    }
    await superAdminApi.setTerrainPhotoPrincipale(Number(terrainId), Number(item.id));
    onPhotosChange?.(await superAdminApi.terrainPhotos(Number(terrainId)));
  }

  async function remove(item: (typeof items)[number]) {
    if (!window.confirm("Supprimer cette photo ?")) return;
    if (!remote) {
      const target = localPhotos.find((p) => p.key === item.key);
      if (target) URL.revokeObjectURL(target.preview);
      const next = localPhotos.filter((p) => p.key !== item.key);
      if (next.length && !next.some((p) => p.est_principale)) next[0].est_principale = true;
      onLocalPhotosChange?.(next);
      return;
    }
    await superAdminApi.removeTerrainPhoto(Number(terrainId), Number(item.id));
    onPhotosChange?.(await superAdminApi.terrainPhotos(Number(terrainId)));
  }

  async function move(index: number, dir: -1 | 1) {
    const nextIndex = index + dir;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    if (!remote) {
      const next = [...localPhotos];
      const [row] = next.splice(index, 1);
      next.splice(nextIndex, 0, row);
      onLocalPhotosChange?.(next);
      return;
    }
    const ids = photos.map((p) => p.id);
    const [row] = ids.splice(index, 1);
    ids.splice(nextIndex, 0, row);
    await superAdminApi.reorderTerrainPhotos(Number(terrainId), ids);
    onPhotosChange?.(await superAdminApi.terrainPhotos(Number(terrainId)));
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>
        Photos (obligatoire pour activer le terrain)
      </p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void ingestFiles(e.dataTransfer.files);
        }}
        className="rounded-xl px-4 py-8 text-center"
        style={{
          border: `2px dashed ${dragOver ? "var(--sa-primary)" : "var(--sa-border)"}`,
          background: dragOver ? "var(--sa-primary-glow)" : "var(--sa-surface-2)",
          borderRadius: 12,
          padding: 32,
        }}
      >
        <Upload className="mx-auto mb-2" size={22} style={{ color: "var(--sa-primary)" }} />
        <p className="text-[13px] font-medium" style={{ color: "var(--sa-text)" }}>Glisse tes photos ici</p>
        <p className="mt-1 text-[11px]" style={{ color: "var(--sa-muted)" }}>
          JPG, PNG, WEBP — 5 Mo max par photo — 5 photos max
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            className="h-10 px-3 rounded-lg text-[12px] font-semibold"
            style={{ background: "var(--sa-primary)", color: "#fff" }}
          >
            Choisir des photos
          </button>
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="h-10 px-3 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1 md:hidden"
            style={{ border: "1px solid var(--sa-border)", color: "var(--sa-text-2)" }}
          >
            <Camera size={14} /> Prendre une photo
          </button>
        </div>
        <input ref={galleryRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => { void ingestFiles(e.target.files || []); e.target.value = ""; }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void ingestFiles(e.target.files || []); e.target.value = ""; }} />
      </div>

      {items.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {items.map((item, index) => (
            <div key={item.key} className="relative overflow-hidden group" style={{ borderRadius: 8, aspectRatio: "16/9" }}>
              <img src={item.url} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "rgba(0,0,0,0.35)" }}>
                <button type="button" onClick={() => void remove(item)} className="absolute top-2 left-2 w-8 h-8 rounded-full grid place-items-center bg-white/90" aria-label="Supprimer">
                  <Trash2 size={14} />
                </button>
                <button type="button" onClick={() => void setPrincipale(item)} className="absolute top-2 right-2 w-8 h-8 rounded-full grid place-items-center bg-white/90" aria-label="Photo principale">
                  <Star size={14} fill={item.est_principale ? "#FBBF24" : "none"} color={item.est_principale ? "#FBBF24" : "#111"} />
                </button>
                <div className="absolute bottom-2 right-2 flex gap-1">
                  <button type="button" disabled={index === 0} onClick={() => void move(index, -1)} className="w-7 h-7 rounded-full grid place-items-center bg-white/90 disabled:opacity-40">
                    <ChevronLeft size={14} />
                  </button>
                  <button type="button" disabled={index === items.length - 1} onClick={() => void move(index, 1)} className="w-7 h-7 rounded-full grid place-items-center bg-white/90 disabled:opacity-40">
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
              {item.est_principale ? (
                <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[11px] text-white" style={{ background: "var(--sa-primary)" }}>
                  Principale
                </span>
              ) : null}
            </div>
          ))}
          {Object.values(uploading).map((pct, i) => (
            <div key={`up-${i}`} className="relative overflow-hidden" style={{ borderRadius: 8, aspectRatio: "16/9", background: "var(--sa-surface-2)" }}>
              <div className="absolute bottom-0 left-0 h-1.5" style={{ width: `${pct}%`, background: "var(--sa-success)" }} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
