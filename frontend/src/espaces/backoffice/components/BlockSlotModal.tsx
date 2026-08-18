import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import Select2 from "@/components/Select2";

interface BlockSlotModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { date: string; heure_debut: string; heure_fin: string; motif: string }) => void;
  isLoading?: boolean;
}

const BlockSlotModal = ({ isOpen, onClose, onSubmit, isLoading = false }: BlockSlotModalProps) => {
  const [date, setDate] = useState("");
  const [heureDebut, setHeureDebut] = useState("08:00");
  const [heureFin, setHeureFin] = useState("10:00");
  const [motif, setMotif] = useState("entretien");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!date) {
      toast.error("Veuillez sélectionner une date");
      return;
    }
    
    if (heureDebut >= heureFin) {
      toast.error("L'heure de début doit être avant l'heure de fin");
      return;
    }

    onSubmit({ date, heure_debut: heureDebut, heure_fin: heureFin, motif });
    
    // Reset form
    setDate("");
    setHeureDebut("08:00");
    setHeureFin("10:00");
    setMotif("entretien");
  };

  const motifOptions = [
    { value: "entretien", label: "Entretien" },
    { value: "maintenance", label: "Maintenance" },
    { value: "evenement_prive", label: "Événement privé" },
    { value: "meteo", label: "Météo défavorable" },
    { value: "autre", label: "Autre" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-background rounded-2xl w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-display font-bold text-lg">Bloquer un créneau</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Date */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Date *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="w-full bg-muted rounded-lg px-3 py-2 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          {/* Heure début */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Heure de début *</label>
            <input
              type="time"
              value={heureDebut}
              onChange={(e) => setHeureDebut(e.target.value)}
              className="w-full bg-muted rounded-lg px-3 py-2 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          {/* Heure fin */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Heure de fin *</label>
            <input
              type="time"
              value={heureFin}
              onChange={(e) => setHeureFin(e.target.value)}
              className="w-full bg-muted rounded-lg px-3 py-2 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          {/* Motif */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Motif *</label>
            <Select2
              value={motif}
              onChange={setMotif}
              required
              options={motifOptions}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
              disabled={isLoading}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              variant="hero"
              className="flex-1"
              disabled={isLoading}
            >
              {isLoading ? "Blocage..." : "Bloquer le créneau"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BlockSlotModal;