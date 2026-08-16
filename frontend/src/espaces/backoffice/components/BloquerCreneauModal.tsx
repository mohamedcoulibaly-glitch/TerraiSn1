import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { gerantApi, terrainsApi } from "@/lib/api";
import { localYmd } from "@/lib/localDate";
import { cn } from "@/lib/utils";

type Blocage = {
  id: number;
  date: string;
  heure_debut: string;
  heure_fin: string;
  motif?: string | null;
};

type FreeSlot = {
  heure_debut: string;
  heure_fin: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  terrainId?: number;
  blocages?: Blocage[];
  onChanged?: () => void;
};

const MOTIFS = [
  { value: "pluie", label: "🌧️ Pluie" },
  { value: "maintenance", label: "🔧 Maintenance" },
  { value: "match_prive", label: "🔒 Match privé" },
  { value: "autre", label: "Autre" },
] as const;

const MOTIF_LABEL: Record<string, string> = {
  pluie: "Pluie",
  maintenance: "Maintenance",
  match_prive: "Match privé",
  autre: "Autre",
};

function formatPill(debut: string, fin: string) {
  const d = String(debut).slice(0, 5).replace(":", "h");
  const f = String(fin).slice(0, 5).replace(":", "h");
  return `${d} - ${f}`;
}

function slotKey(s: { heure_debut: string; heure_fin: string }) {
  return `${String(s.heure_debut).slice(0, 5)}|${String(s.heure_fin).slice(0, 5)}`;
}

export default function BloquerCreneauModal({
  open,
  onClose,
  terrainId,
  blocages = [],
  onChanged,
}: Props) {
  const [date, setDate] = useState(localYmd());
  const [motif, setMotif] = useState<(typeof MOTIFS)[number]["value"] | null>("pluie");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [freeSlots, setFreeSlots] = useState<FreeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showList, setShowList] = useState(false);
  const [localBlocages, setLocalBlocages] = useState<Blocage[]>(blocages);

  useEffect(() => {
    if (!open) return;
    setDate(localYmd());
    setMotif("pluie");
    setSelected(new Set());
    setShowList(false);
    setLocalBlocages(blocages);
    setBusy(false);
  }, [open, blocages]);

  useEffect(() => {
    if (!open || !terrainId || !date) {
      setFreeSlots([]);
      return;
    }
    let cancelled = false;
    setLoadingSlots(true);
    terrainsApi
      .getCreneaux(terrainId, date)
      .then((data: any) => {
        if (cancelled) return;
        const slots: FreeSlot[] = (data?.creneaux || [])
          .filter((c: any) => c.disponible !== false && c.statut !== "occupe" && c.statut !== "bloque")
          .map((c: any) => {
            const debut = String(c.heure_debut || c.heure || "").slice(0, 5);
            const fin =
              String(c.heure_fin || "").slice(0, 5) ||
              (() => {
                const h = parseInt(debut.split(":")[0], 10);
                return `${String(h + 1).padStart(2, "0")}:00`;
              })();
            return { heure_debut: debut, heure_fin: fin };
          })
          .filter((c: FreeSlot) => c.heure_debut);
        setFreeSlots(slots);
      })
      .catch(() => {
        if (!cancelled) setFreeSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, terrainId, date]);

  const dayBlocages = useMemo(
    () => localBlocages.filter((b) => String(b.date).slice(0, 10) === date),
    [localBlocages, date],
  );

  if (!open) return null;

  const toggleSlot = (slot: FreeSlot) => {
    const key = slotKey(slot);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleBlock = async () => {
    if (selected.size === 0) {
      toast.error("Sélectionne au moins un créneau");
      return;
    }
    const creneaux = freeSlots.filter((s) => selected.has(slotKey(s)));
    setBusy(true);
    try {
      const result = (await gerantApi.addBlocagesBatch({
        date,
        motif: motif || null,
        creneaux,
      })) as { count?: number; blocages?: Blocage[]; message?: string };

      const count = Number(result?.count || creneaux.length);
      if (result?.blocages?.length) {
        setLocalBlocages((prev) => [...result.blocages!, ...prev]);
      }
      setSelected(new Set());
      toast.success(result?.message || `${count} créneau(x) bloqué(s) ✓`);
      onChanged?.();
      // Refresh free slots
      if (terrainId) {
        const data = (await terrainsApi.getCreneaux(terrainId, date)) as any;
        const slots: FreeSlot[] = (data?.creneaux || [])
          .filter((c: any) => c.disponible !== false && c.statut !== "occupe" && c.statut !== "bloque")
          .map((c: any) => ({
            heure_debut: String(c.heure_debut || c.heure || "").slice(0, 5),
            heure_fin: String(c.heure_fin || "").slice(0, 5),
          }))
          .filter((c: FreeSlot) => c.heure_debut && c.heure_fin);
        setFreeSlots(slots);
      }
    } catch (err: any) {
      toast.error(err?.message || "Blocage impossible");
    } finally {
      setBusy(false);
    }
  };

  const handleUnblock = async (id: number) => {
    try {
      await gerantApi.removeBlocage(id);
      setLocalBlocages((prev) => prev.filter((b) => b.id !== id));
      toast.success("Créneau débloqué");
      onChanged?.();
      if (terrainId) {
        const data = (await terrainsApi.getCreneaux(terrainId, date)) as any;
        const slots: FreeSlot[] = (data?.creneaux || [])
          .filter((c: any) => c.disponible !== false && c.statut !== "occupe" && c.statut !== "bloque")
          .map((c: any) => ({
            heure_debut: String(c.heure_debut || c.heure || "").slice(0, 5),
            heure_fin: String(c.heure_fin || "").slice(0, 5),
          }))
          .filter((c: FreeSlot) => c.heure_debut && c.heure_fin);
        setFreeSlots(slots);
      }
    } catch (err: any) {
      toast.error(err?.message || "Déblocage impossible");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Fermer" onClick={onClose} />
      <div
        className="relative w-full max-w-lg rounded-t-2xl md:rounded-2xl max-h-[92vh] overflow-y-auto pb-safe"
        style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow-md)" }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <span className="w-10 h-1 rounded-full" style={{ background: "var(--g-border)" }} />
        </div>
        <div className="flex items-start justify-between px-4 pb-3">
          <div>
            <h2 className="text-base font-bold" style={{ color: "var(--g-text)" }}>
              Bloquer un créneau
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--g-muted)" }}>
              Pluie, maintenance, match privé…
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 min-h-[44px] min-w-[44px]" aria-label="Fermer">
            <X className="w-5 h-5" style={{ color: "var(--g-muted)" }} />
          </button>
        </div>

        <div className="px-4 pb-6 space-y-4">
          {!showList ? (
            <>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--g-text-2)" }}>
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setSelected(new Set());
                  }}
                  className="h-[48px] w-full px-3 rounded-xl text-sm outline-none"
                  style={{
                    background: "var(--g-surface-2)",
                    color: "var(--g-text)",
                    border: "1px solid var(--g-border)",
                  }}
                />
              </div>

              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: "var(--g-text-2)" }}>
                  Créneaux libres — sélection multiple
                </p>
                {loadingSlots ? (
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-11 w-28 animate-pulse rounded-full" style={{ background: "var(--g-surface-2)" }} />
                    ))}
                  </div>
                ) : freeSlots.length === 0 ? (
                  <p className="text-sm py-4 text-center" style={{ color: "var(--g-muted)" }}>
                    Aucun créneau libre ce jour
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {freeSlots.map((slot) => {
                      const key = slotKey(slot);
                      const actif = selected.has(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleSlot(slot)}
                          className={cn(
                            "min-h-[44px] px-3.5 rounded-full text-sm font-semibold border transition-colors",
                          )}
                          style={{
                            background: actif ? "var(--g-bloque)" : "var(--g-surface-2)",
                            color: actif ? "#fff" : "var(--g-text)",
                            borderColor: actif ? "var(--g-bloque)" : "var(--g-border)",
                          }}
                        >
                          {formatPill(slot.heure_debut, slot.heure_fin)}
                        </button>
                      );
                    })}
                  </div>
                )}
                {selected.size > 0 ? (
                  <p className="mt-2 text-xs" style={{ color: "var(--g-muted)" }}>
                    {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
                  </p>
                ) : null}
              </div>

              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: "var(--g-text-2)" }}>
                  Motif (optionnel)
                </p>
                <div className="flex flex-wrap gap-2">
                  {MOTIFS.map((m) => {
                    const actif = motif === m.value;
                    return (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => setMotif(actif ? null : m.value)}
                        className="px-3 min-h-[44px] rounded-full text-sm font-semibold"
                        style={{
                          background: actif ? "var(--g-danger)" : "var(--g-surface-2)",
                          color: actif ? "#fff" : "var(--g-muted)",
                        }}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                disabled={busy || selected.size === 0}
                onClick={() => void handleBlock()}
                className="w-full min-h-[48px] rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--g-danger)" }}
              >
                {busy ? "Blocage…" : `Bloquer${selected.size > 0 ? ` (${selected.size})` : ""}`}
              </button>

              <button
                type="button"
                onClick={() => setShowList(true)}
                className="w-full text-center text-sm font-semibold min-h-[44px]"
                style={{ color: "var(--g-primary)" }}
              >
                Voir les créneaux bloqués ({dayBlocages.length})
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowList(false)}
                className="text-sm font-semibold min-h-[44px]"
                style={{ color: "var(--g-primary)" }}
              >
                ← Retour
              </button>
              <ul className="space-y-2">
                {dayBlocages.length === 0 && (
                  <li className="text-sm text-center py-6" style={{ color: "var(--g-muted)" }}>
                    Aucun créneau bloqué ce jour
                  </li>
                )}
                {dayBlocages.map((b) => (
                  <li
                    key={b.id}
                    className="rounded-xl p-3 flex items-center gap-3"
                    style={{
                      background: "var(--g-surface-2)",
                      borderLeft: "4px solid var(--g-bloque)",
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
                        {formatPill(b.heure_debut, b.heure_fin)}
                      </p>
                      <p className="text-xs" style={{ color: "var(--g-muted)" }}>
                        {MOTIF_LABEL[String(b.motif || "")] || b.motif || "Sans motif"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleUnblock(b.id)}
                      className="text-xs font-semibold min-h-[44px] px-3"
                      style={{ color: "var(--g-danger)" }}
                    >
                      Débloquer
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
