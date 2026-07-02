import { useState, useEffect } from "react";
import { UserPlus, Mail, Phone, Lock, User } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { employesApi, proprietaireApi } from "@/lib/api";

interface EmployeeFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  terrains?: any[];
  onSuccess?: () => void;
}

const EmployeeFormModal = ({ open, onOpenChange, terrains: propTerrains, onSuccess }: EmployeeFormModalProps) => {
  const [submitting, setSubmitting] = useState(false);
  const [terrains, setTerrains] = useState<any[]>(propTerrains || []);
  const [form, setForm] = useState({
    nom: "",
    email: "",
    telephone: "",
    password: "",
    terrain_id: "",
  });

  useEffect(() => {
    if (open && !propTerrains) {
      loadTerrains();
    }
    if (!open) {
      setForm({
        nom: "",
        email: "",
        telephone: "",
        password: "",
        terrain_id: "",
      });
    }
  }, [open, propTerrains]);

  const loadTerrains = async () => {
    try {
      const data = await proprietaireApi.terrains();
      setTerrains(data);
      if (data.length > 0) {
        setForm(prev => ({ ...prev, terrain_id: data[0].id.toString() }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const data = {
        nom: form.nom,
        email: form.email,
        telephone: form.telephone,
        password: form.password,
        terrain_id: form.terrain_id ? parseInt(form.terrain_id) : undefined,
        role: "employe",
      };

      await employesApi.create(data);
      toast.success("Employé ajouté avec succès !");
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de l'ajout de l'employé");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display font-bold text-lg flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            Ajouter un employé gérant
          </DialogTitle>
          <DialogDescription>
            Créez un compte pour un gérant qui pourra gérer un terrain.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* Nom */}
          <div className="space-y-2">
            <Label htmlFor="nom">Nom complet *</Label>
            <div className="relative">
              <User className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                id="nom"
                placeholder="Ex: Mamadou Sarr"
                value={form.nom}
                onChange={(e) => setForm({ ...form, nom: e.target.value })}
                className="pl-9"
                required
              />
            </div>
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email">Adresse e-mail *</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="Ex: sarr@terrainsn.sn"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="pl-9"
                required
              />
            </div>
          </div>

          {/* Téléphone */}
          <div className="space-y-2">
            <Label htmlFor="telephone">Téléphone *</Label>
            <div className="relative">
              <Phone className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                id="telephone"
                type="tel"
                placeholder="Ex: 77 123 45 67"
                value={form.telephone}
                onChange={(e) => setForm({ ...form, telephone: e.target.value })}
                className="pl-9"
                required
              />
            </div>
          </div>

          {/* Mot de passe */}
          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe temporaire *</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="pl-9"
                required
                minLength={6}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Le gérant pourra modifier son mot de passe après sa première connexion.
            </p>
          </div>

          {/* Terrain affecté */}
          <div className="space-y-2">
            <Label htmlFor="terrain_id">Terrain à gérer *</Label>
            <Select
              value={form.terrain_id}
              onValueChange={(value) => setForm({ ...form, terrain_id: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un terrain" />
              </SelectTrigger>
              <SelectContent>
                {terrains.map((t) => (
                  <SelectItem key={t.id} value={t.id.toString()}>
                    {t.nom} {t.ville && ` - ${t.ville}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Ce gérant aura accès uniquement à ce terrain.
            </p>
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
              {submitting ? "Création..." : "Ajouter l'employé"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EmployeeFormModal;