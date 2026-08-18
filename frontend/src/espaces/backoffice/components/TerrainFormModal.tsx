import { useState, useEffect } from "react";
import { X, Upload, MapPin, Clock, Info, Phone, Trash2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Select2 from "@/components/Select2";
import PctMontantPair, { montantDepuisPct } from "@/components/PctMontantPair";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { terrainsApi } from "@/lib/api";
import CommoditesPicker from "@/components/CommoditesPicker";
import { parseCommodites, type CommoditeId } from "@/lib/commodites";

interface TerrainFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  terrain?: any | null;
  onSuccess?: () => void;
}

const TerrainFormModal = ({ open, onOpenChange, terrain, onSuccess }: TerrainFormModalProps) => {
  const isEditing = !!terrain;
  const [submitting, setSubmitting] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photos, setPhotos] = useState<any[]>([]);
  const [photoMeta, setPhotoMeta] = useState({ est_principale: true, ordre: "0" });
  const [form, setForm] = useState({
    nom: "",
    type: "5v5",
    prix_heure: "",
    prix_moitie: "",
    prix_entier: "",
    montant_acompte: "5000",
    pourcentage_avance: "8",
    modele_revenus: "commission",
    commission_pourcentage: "10",
    abonnement_montant: "",
    achat_definitif_montant: "",
    achat_definitif_paye: false,
    ville: "",
    adresse: "",
    latitude: "",
    longitude: "",
    description: "",
    telephone: "",
    is_active: true,
    heure_debut: "06:00",
    heure_fin: "00:00",
    photos: [] as string[],
    commodites: [] as CommoditeId[],
  });

  useEffect(() => {
    if (terrain) {
      setForm({
        nom: terrain.nom || "",
        type: terrain.type || "5v5",
        prix_heure: terrain.prix_heure?.toString() || "",
        prix_moitie: terrain.prix_moitie?.toString() || "",
        prix_entier: (terrain.prix_entier || terrain.prix_heure)?.toString() || "",
        montant_acompte: terrain.montant_acompte?.toString() || "5000",
        pourcentage_avance: terrain.pourcentage_avance?.toString() || "8",
        modele_revenus: terrain.modele_revenus || "commission",
        commission_pourcentage: terrain.commission_pourcentage?.toString() || "10",
        abonnement_montant: terrain.abonnement_montant?.toString() || "",
        achat_definitif_montant: terrain.achat_definitif_montant?.toString() || "",
        achat_definitif_paye: Boolean(terrain.achat_definitif_paye),
        ville: terrain.ville || "",
        adresse: terrain.adresse || "",
        latitude: terrain.latitude?.toString() || "",
        longitude: terrain.longitude?.toString() || "",
        description: terrain.description || "",
        telephone: terrain.telephone || "",
        is_active: terrain.is_active ?? true,
        heure_debut: terrain.heure_debut || "06:00",
        heure_fin: terrain.heure_fin || "00:00",
        photos: terrain.photos || [],
        commodites: parseCommodites(terrain.commodites),
      });
    } else {
      setForm({
        nom: "",
        type: "5v5",
        prix_heure: "",
        prix_moitie: "",
        prix_entier: "",
        montant_acompte: "5000",
        pourcentage_avance: "8",
        modele_revenus: "commission",
        commission_pourcentage: "10",
        abonnement_montant: "",
        achat_definitif_montant: "",
        achat_definitif_paye: false,
        ville: "",
        adresse: "",
        latitude: "",
        longitude: "",
        description: "",
        telephone: "",
        is_active: true,
        heure_debut: "06:00",
        heure_fin: "00:00",
        photos: [],
        commodites: [],
      });
    }
  }, [terrain, open]);

  useEffect(() => {
    if (!open || !terrain?.id) {
      setPhotos([]);
      return;
    }
    terrainsApi.listPhotos(terrain.id).then((items: any) => {
      setPhotos(Array.isArray(items) ? items : []);
    }).catch(() => setPhotos([]));
  }, [open, terrain?.id]);

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const uploadPhoto = async (file?: File | null) => {
    if (!terrain?.id || !file) return;
    setPhotoUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await terrainsApi.uploadPhoto(terrain.id, {
        dataUrl,
        est_principale: photoMeta.est_principale,
        ordre: Number(photoMeta.ordre || 0),
      });
      const next = await terrainsApi.listPhotos(terrain.id);
      setPhotos(Array.isArray(next) ? next : []);
      toast.success("Photo ajoutée");
    } catch (err: any) {
      toast.error(err.message || "Upload impossible");
    } finally {
      setPhotoUploading(false);
    }
  };

  const markPrincipal = async (photoId: number) => {
    if (!terrain?.id) return;
    await terrainsApi.updatePhoto(terrain.id, photoId, { est_principale: true });
    const next = await terrainsApi.listPhotos(terrain.id);
    setPhotos(Array.isArray(next) ? next : []);
  };

  const removePhoto = async (photoId: number) => {
    if (!terrain?.id) return;
    await terrainsApi.removePhoto(terrain.id, photoId);
    setPhotos((prev) => prev.filter((photo) => photo.id !== photoId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const data = {
        ...form,
        prix_heure: parseFloat(form.prix_entier || form.prix_heure),
        prix_moitie: parseFloat(form.prix_moitie),
        prix_entier: parseFloat(form.prix_entier || form.prix_heure),
        pourcentage_avance: parseFloat(form.pourcentage_avance),
        latitude: form.latitude ? parseFloat(form.latitude) : null,
        longitude: form.longitude ? parseFloat(form.longitude) : null,
      };

      if (isEditing) {
        await terrainsApi.update(terrain.id, data);
        const jours = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
        await terrainsApi.updateHoraires(
          terrain.id,
          jours.map((jour) => ({
            jour,
            heure_debut: form.heure_debut || "06:00",
            heure_fin: form.heure_fin || "00:00",
            est_ouvert: 1,
          })),
        );
        toast.success("Terrain modifié avec succès !");
      } else {
        await terrainsApi.create(data);
        toast.success("Terrain ajouté avec succès !");
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de l'enregistrement");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display font-bold text-lg">
            {isEditing ? "Modifier le terrain" : "Ajouter un nouveau terrain"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Modifiez les informations du terrain."
              : "Remplissez les informations pour créer un nouveau terrain."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* Nom du terrain */}
          <div className="space-y-2">
            <Label htmlFor="nom">Nom du terrain *</Label>
            <Input
              id="nom"
              placeholder="Ex: Terrain Principal"
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              required
            />
          </div>

          {/* Type et Prix */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">Type de terrain *</Label>
              <Select2
                value={form.type}
                onChange={(value) => setForm({ ...form, type: value })}
                options={[
                  { value: "5v5", label: "5 contre 5" },
                  { value: "7v7", label: "7 contre 7" },
                  { value: "11v11", label: "11 contre 11" },
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prix_entier">Terrain entier / heure (FCFA) *</Label>
              <Input
                id="prix_entier"
                type="number"
                placeholder="Ex: 70000"
                value={form.prix_entier}
                onChange={(e) => setForm({ ...form, prix_entier: e.target.value, prix_heure: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="prix_moitie">Moitié du terrain / heure (FCFA) *</Label>
              <Input id="prix_moitie" type="number" placeholder="Ex: 40000" value={form.prix_moitie} onChange={(e) => setForm({ ...form, prix_moitie: e.target.value })} required />
            </div>
          </div>

          <div className="space-y-4">
            <PctMontantPair
              label="Avance de réservation"
              labelMontant="Montant avance"
              pct={form.pourcentage_avance}
              onPctChange={(value) => setForm({ ...form, pourcentage_avance: value })}
              base={Number(form.prix_entier) || 0}
              minPct={1}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="modele_revenus">Modele de revenus *</Label>
              <Select2
                value={form.modele_revenus}
                disabled
                onChange={(value) => setForm({ ...form, modele_revenus: value })}
                options={[
                  { value: "commission", label: "Commission" },
                  { value: "abonnement", label: "Abonnement mensuel" },
                  { value: "achat_definitif", label: "Achat definitif" },
                ]}
              />
            </div>
            {form.modele_revenus === "commission" && (
              <PctMontantPair
                label="Commission plateforme"
                labelMontant="Montant commission"
                pct={form.commission_pourcentage}
                onPctChange={(value) => setForm({ ...form, commission_pourcentage: value })}
                base={montantDepuisPct(Number(form.pourcentage_avance) || 0, Number(form.prix_entier) || 0)}
                disabled
              />
            )}
            {form.modele_revenus === "abonnement" && (
              <div className="space-y-2">
                <Label htmlFor="abonnement_montant">Abonnement mensuel (FCFA)</Label>
                <Input id="abonnement_montant" type="number" min="0" placeholder="Ex: 50000" value={form.abonnement_montant} disabled readOnly onChange={(e) => setForm({ ...form, abonnement_montant: e.target.value })} />
              </div>
            )}
            {form.modele_revenus === "achat_definitif" && (
              <div className="space-y-2">
                <Label htmlFor="achat_definitif_montant">Achat definitif (FCFA)</Label>
                <Input id="achat_definitif_montant" type="number" min="0" placeholder="Ex: 500000" value={form.achat_definitif_montant} disabled readOnly onChange={(e) => setForm({ ...form, achat_definitif_montant: e.target.value })} />
              </div>
            )}
          </div>

          <p className="rounded-xl border border-[color-mix(in_srgb,var(--color-primary)_18%,white)] bg-[color-mix(in_srgb,var(--color-primary)_7%,white)] px-4 py-3 text-xs text-muted-foreground">
            Le mode de paiement du terrain est fixé avec TerrainSN. Tu peux modifier les infos du terrain, mais pas ce mode.
          </p>

          {/* Ville et Adresse */}
          <div className="space-y-2">
            <Label htmlFor="ville">Ville *</Label>
            <div className="relative">
              <MapPin className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                id="ville"
                placeholder="Ex: Dakar"
                value={form.ville}
                onChange={(e) => setForm({ ...form, ville: e.target.value })}
                className="pl-9"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adresse">Adresse précise</Label>
            <Input
              id="adresse"
              placeholder="Ex: Quartier Plateau, Rue 12"
              value={form.adresse}
              onChange={(e) => setForm({ ...form, adresse: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="latitude">Latitude</Label>
            <Input
              id="latitude"
              type="number"
              step="any"
              placeholder="Ex: 14.6928"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="longitude">Longitude</Label>
            <Input
              id="longitude"
              type="number"
              step="any"
              placeholder="Ex: -17.4467"
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })}
            />
          </div>

          {/* Téléphone */}
          <div className="space-y-2">
            <Label htmlFor="telephone">Téléphone de contact</Label>
            <div className="relative">
              <Phone className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                id="telephone"
                type="tel"
                placeholder="Ex: 77 123 45 67"
                value={form.telephone}
                onChange={(e) => setForm({ ...form, telephone: e.target.value })}
                className="pl-9"
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Décrivez l'ambiance, l'accès, les consignes…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Commodités &amp; services inclus</Label>
            <p className="text-xs text-muted-foreground">
              Coche les services proposés — affichés sur la fiche détaillée du joueur.
            </p>
            <CommoditesPicker
              value={form.commodites}
              onChange={(commodites) => setForm({ ...form, commodites })}
            />
          </div>

          {/* Horaires */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Horaires d'ouverture
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="heure_debut" className="text-xs text-muted-foreground">
                  Heure d&apos;ouverture
                </Label>
                <Input
                  id="heure_debut"
                  type="time"
                  value={form.heure_debut}
                  onChange={(e) => setForm({ ...form, heure_debut: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="heure_fin" className="text-xs text-muted-foreground">
                  Heure de fermeture (00:00 = minuit)
                </Label>
                <Input
                  id="heure_fin"
                  type="time"
                  value={form.heure_fin}
                  onChange={(e) => setForm({ ...form, heure_fin: e.target.value })}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Plages libres (avant 08h / après 22h OK). Fin à 00:00 active le créneau « … minuit »
              (vendredi 00h = Jeudi minuit).
            </p>
          </div>

          {/* Statut actif */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm">Terrain disponible à la réservation</span>
            </div>
            <Switch
              checked={form.is_active}
              onCheckedChange={(checked) => setForm({ ...form, is_active: checked })}
            />
          </div>

          {/* Upload photos (placeholder - would need backend support) */}
          <div className="space-y-2">
            <Label>Photos du terrain</Label>
            <div className="hidden">
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">
                Glissez-déposez des photos ou cliquez pour parcourir
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Formats: JPG, PNG (max 5Mo)
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {isEditing ? (
              <>
                <label className="block border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:bg-muted/40 transition-colors">
                  <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">
                    {photoUploading ? "Upload en cours..." : "Cliquez pour charger une photo"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    JPG, PNG, WEBP - 5 Mo maximum
                  </p>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    disabled={photoUploading}
                    onChange={(e) => uploadPhoto(e.target.files?.[0])}
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={photoMeta.est_principale}
                      onChange={(e) => setPhotoMeta({ ...photoMeta, est_principale: e.target.checked })}
                    />
                    Photo principale
                  </label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Ordre"
                    value={photoMeta.ordre}
                    onChange={(e) => setPhotoMeta({ ...photoMeta, ordre: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {photos.map((photo) => (
                    <article key={photo.id} className="rounded-xl border border-border overflow-hidden bg-white">
                      <img src={photo.url} alt="Terrain" className="h-24 w-full object-cover" loading="lazy" />
                      <div className="p-2 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => markPrincipal(photo.id)}
                          className={`text-[11px] inline-flex items-center gap-1 ${photo.est_principale ? "text-primary font-semibold" : "text-muted-foreground"}`}
                        >
                          <Star className="w-3 h-3" />
                          {photo.est_principale ? "Principale" : "Définir"}
                        </button>
                        <button
                          type="button"
                          onClick={() => removePhoto(photo.id)}
                          className="text-destructive"
                          aria-label="Supprimer la photo"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                {photos.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">Aucune photo enregistrée</p>
                )}
              </>
            ) : (
              <div className="border border-border rounded-xl p-4 bg-muted/30 text-xs text-muted-foreground">
                Enregistrez d'abord le terrain, puis rouvrez-le pour ajouter ses photos.
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button type="submit" variant="hero" disabled={submitting}>
              {submitting ? "Enregistrement..." : isEditing ? "Modifier" : "Ajouter"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default TerrainFormModal;
