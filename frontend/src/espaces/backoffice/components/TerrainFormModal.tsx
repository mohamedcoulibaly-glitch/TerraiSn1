import { useState, useEffect } from "react";
import { X, Upload, MapPin, Clock, Info, Phone } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { terrainsApi } from "@/lib/api";

interface TerrainFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  terrain?: any | null;
  onSuccess?: () => void;
}

const TerrainFormModal = ({ open, onOpenChange, terrain, onSuccess }: TerrainFormModalProps) => {
  const isEditing = !!terrain;
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    nom: "",
    type: "5v5",
    prix_heure: "",
    prix_moitie: "",
    prix_entier: "",
    montant_acompte: "5000",
    ville: "",
    adresse: "",
    description: "",
    telephone: "",
    is_active: true,
    heure_debut: "08:00",
    heure_fin: "23:00",
    photos: [] as string[],
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
        ville: terrain.ville || "",
        adresse: terrain.adresse || "",
        description: terrain.description || "",
        telephone: terrain.telephone || "",
        is_active: terrain.is_active ?? true,
        heure_debut: terrain.heure_debut || "08:00",
        heure_fin: terrain.heure_fin || "23:00",
        photos: terrain.photos || [],
      });
    } else {
      setForm({
        nom: "",
        type: "5v5",
        prix_heure: "",
        prix_moitie: "",
        prix_entier: "",
        montant_acompte: "5000",
        ville: "",
        adresse: "",
        description: "",
        telephone: "",
        is_active: true,
        heure_debut: "08:00",
        heure_fin: "23:00",
        photos: [],
      });
    }
  }, [terrain, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const data = {
        ...form,
        prix_heure: parseFloat(form.prix_entier || form.prix_heure),
        prix_moitie: parseFloat(form.prix_moitie),
        prix_entier: parseFloat(form.prix_entier || form.prix_heure),
        montant_acompte: parseFloat(form.montant_acompte),
      };

      if (isEditing) {
        await terrainsApi.update(terrain.id, data);
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
              <Select
                value={form.type}
                onValueChange={(value) => setForm({ ...form, type: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5v5">5 contre 5</SelectItem>
                  <SelectItem value="7v7">7 contre 7</SelectItem>
                  <SelectItem value="11v11">11 contre 11</SelectItem>
                </SelectContent>
              </Select>
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
            <div className="space-y-2">
              <Label htmlFor="montant_acompte">Acompte de réservation (FCFA) *</Label>
              <Input id="montant_acompte" type="number" placeholder="Ex: 5000" value={form.montant_acompte} onChange={(e) => setForm({ ...form, montant_acompte: e.target.value })} required />
            </div>
          </div>

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
              placeholder="Décrivez les équipements, l'état du terrain, etc."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
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
                  Heure d'ouverture
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
                  Heure de fermeture
                </Label>
                <Input
                  id="heure_fin"
                  type="time"
                  value={form.heure_fin}
                  onChange={(e) => setForm({ ...form, heure_fin: e.target.value })}
                />
              </div>
            </div>
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
            <div className="border-2 border-dashed border-border rounded-xl p-6 text-center">
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">
                Glissez-déposez des photos ou cliquez pour parcourir
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Formats: JPG, PNG (max 5Mo)
              </p>
            </div>
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
