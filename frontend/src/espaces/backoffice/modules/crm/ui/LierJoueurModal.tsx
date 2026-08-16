import { useEffect, useState } from "react";
import { gerantApi } from "@/lib/api";
import { toast } from "sonner";

type Props = {
  open: boolean;
  reservationId: number;
  defaultName?: string | null;
  defaultPhone?: string | null;
  onClose: () => void;
  onLinked: () => void;
};

type Hit = {
  id: number;
  display_nom: string;
  telephone?: string | null;
};

export default function LierJoueurModal({ open, reservationId, defaultName, defaultPhone, onClose, onLinked }: Props) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNom(defaultName || "");
    setTelephone(defaultPhone || "");
    setQ("");
    setHits([]);
  }, [open, defaultName, defaultPhone]);

  if (!open) return null;

  const search = async () => {
    const data = (await gerantApi.joueurs({ q })) as { joueurs: Hit[] };
    setHits(data.joueurs || []);
  };

  const linkExisting = async (joueurId: number) => {
    setBusy(true);
    try {
      await gerantApi.lierJoueurReservation(reservationId, { joueur_id: joueurId });
      toast.success("Joueur lié");
      onLinked();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible de lier");
    } finally {
      setBusy(false);
    }
  };

  const createAndLink = async () => {
    setBusy(true);
    try {
      await gerantApi.lierJoueurReservation(reservationId, { nom: nom.trim(), telephone: telephone.trim() });
      toast.success("Fiche CRM créée et liée");
      onLinked();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Création impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
      <button type="button" className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Fermer" />
      <div className="relative w-full max-w-md bg-white rounded-t-[var(--radius-lg)] md:rounded-[var(--radius-md)] border border-[var(--color-border)] p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-display)" }}>Lier au CRM</h2>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">Walk-in : rattacher une fiche existante ou en créer une.</p>
        </div>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void search()}
            placeholder="Nom ou téléphone"
            className="flex-1 h-10 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm"
          />
          <button type="button" onClick={() => void search()} className="h-10 px-3 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-white text-sm font-medium">
            Chercher
          </button>
        </div>
        {hits.length > 0 && (
          <ul className="max-h-40 overflow-auto border border-[var(--color-border)] rounded-[var(--radius-sm)] divide-y divide-[var(--color-border)]">
            {hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void linkExisting(hit.id)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-surface-2)]"
                >
                  <span className="font-medium">{hit.display_nom}</span>
                  <span className="text-[var(--color-text-muted)] ml-2">{hit.telephone}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Nouvelle fiche</p>
          <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom" className="w-full h-10 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm" />
          <input value={telephone} onChange={(e) => setTelephone(e.target.value)} placeholder="Téléphone" className="w-full h-10 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm" />
          <button type="button" disabled={busy || nom.trim().length < 2} onClick={() => void createAndLink()} className="w-full h-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-50">
            Créer et lier
          </button>
        </div>
      </div>
    </div>
  );
}
