import { useEffect, useRef, useState } from "react";
import { Camera, Star, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { gerantApi } from "@/lib/api";
import { ConfirmationModal } from "@/espaces/backoffice/components/ConfirmationModal";

type Photo = {
  id: number;
  url: string;
  est_principale?: number | boolean;
  uploaded_by_role?: string | null;
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

function readRatio(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img.width && img.height ? img.width / img.height : null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export default function GerantPhotosSection() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [commodites, setCommodites] = useState<{ cle: string; label_fr: string; icone: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [toDelete, setToDelete] = useState<Photo | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [p, c] = await Promise.all([
      gerantApi.terrainPhotos().catch(() => []),
      gerantApi.terrainCommodites().catch(() => []),
    ]);
    setPhotos(Array.isArray(p) ? p : []);
    setCommodites(Array.isArray(c) ? c : []);
  }

  useEffect(() => {
    load().catch(() => toast.error("Impossible de charger les photos du terrain"));
  }, []);

  async function ingest(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(fileOk);
    if (!files.length) return;
    if (photos.length >= MAX) {
      toast.error("Maximum 5 photos atteint");
      return;
    }
    const file = files[0];
    const ratio = await readRatio(file);
    if (ratio != null && (ratio < 1.6 || ratio > 1.9)) {
      toast.message("Photo hors format 16:9 — elle sera recadrée automatiquement");
    }
    setUploading(true);
    try {
      await gerantApi.uploadTerrainPhoto(file, photos.length === 0);
      toast.success("Photo ajoutée");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload impossible");
    } finally {
      setUploading(false);
    }
  }

  async function setPrincipale(photo: Photo) {
    try {
      await gerantApi.setTerrainPhotoPrincipale(photo.id);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible de définir la photo principale");
    }
  }

  const isAdmin = (p: Photo) => p.uploaded_by_role === "super_admin";

  return (
    <section className="rounded-xl p-4 space-y-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
            Photos du terrain
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--g-muted)" }}>
            {photos.length}/{MAX} photos · format 16:9 recommandé
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={uploading || photos.length >= MAX}
            onClick={() => galleryRef.current?.click()}
            className="h-10 px-3 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1"
            style={{ background: "var(--g-primary)", color: "#fff", opacity: uploading || photos.length >= MAX ? 0.6 : 1 }}
          >
            <Upload size={14} /> Ajouter
          </button>
          <button
            type="button"
            disabled={uploading || photos.length >= MAX}
            onClick={() => cameraRef.current?.click()}
            className="h-10 px-3 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1 md:hidden"
            style={{ border: "1px solid var(--g-border, var(--g-muted))", color: "var(--g-text-2)" }}
          >
            <Camera size={14} /> Photo
          </button>
        </div>
      </div>
      <input ref={galleryRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { void ingest(e.target.files || []); e.target.value = ""; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void ingest(e.target.files || []); e.target.value = ""; }} />

      {photos.length === 0 ? (
        <p className="text-[12px]" style={{ color: "var(--g-muted)" }}>Aucune photo. Ajoute au moins une vue du terrain.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative overflow-hidden rounded-lg" style={{ aspectRatio: "16/9", background: "var(--g-surface-2)" }}>
              <img src={p.url} alt="" className="w-full h-full object-cover" />
              {p.est_principale ? (
                <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold text-white" style={{ background: "var(--g-primary)" }}>
                  Principale
                </span>
              ) : null}
              {isAdmin(p) ? (
                <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: "var(--g-surface)", color: "var(--g-muted)" }}>
                  Admin
                </span>
              ) : null}
              <div className="absolute top-1.5 right-1.5 flex gap-1">
                <button type="button" onClick={() => void setPrincipale(p)} className="w-8 h-8 rounded-full grid place-items-center" style={{ background: "var(--g-surface)" }} aria-label="Définir comme principale">
                  <Star size={14} fill={p.est_principale ? "var(--g-warning, #FBBF24)" : "none"} style={{ color: p.est_principale ? "var(--g-warning, #FBBF24)" : "var(--g-text)" }} />
                </button>
                <button
                  type="button"
                  disabled={isAdmin(p)}
                  onClick={() => !isAdmin(p) && setToDelete(p)}
                  className="w-8 h-8 rounded-full grid place-items-center"
                  style={{ background: "var(--g-surface)", opacity: isAdmin(p) ? 0.35 : 1 }}
                  aria-label={isAdmin(p) ? "Photo administration, non supprimable" : "Supprimer"}
                  title={isAdmin(p) ? "Photo ajoutée par l'administration" : "Supprimer"}
                >
                  <Trash2 size={14} style={{ color: "var(--g-danger, #dc2626)" }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {commodites.length ? (
        <div>
          <p className="text-[11px] font-semibold mb-1.5" style={{ color: "var(--g-muted)" }}>
            Équipements affichés aux joueurs
          </p>
          <div className="flex flex-wrap gap-1.5">
            {commodites.map((c) => (
              <span key={c.cle} className="px-2 py-1 rounded-full text-[11px] font-semibold" style={{ background: "var(--g-surface-2)", color: "var(--g-text)" }}>
                {c.label_fr}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <ConfirmationModal
        ouvert={Boolean(toDelete)}
        titre="Supprimer cette photo ?"
        texte="Elle disparaîtra de la fiche joueur."
        variante="danger"
        onAnnuler={() => setToDelete(null)}
        onConfirmer={async () => {
          if (!toDelete) return;
          try {
            await gerantApi.deleteTerrainPhoto(toDelete.id);
            toast.success("Photo supprimée");
            setToDelete(null);
            await load();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Suppression impossible");
          }
        }}
      />
    </section>
  );
}
