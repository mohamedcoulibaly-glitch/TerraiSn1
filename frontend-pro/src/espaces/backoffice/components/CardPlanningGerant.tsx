import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { gerantApi } from "@/lib/api";

const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;

export type SlotHebdo = {
  jour_semaine: number;
  actif: boolean;
  heure_debut: string;
  heure_fin: string;
};

export type ColleguePlanning = {
  gerant_id: number;
  prenom?: string;
  nom?: string;
  est_principal?: number;
  photo_profil?: string | null;
};

function initialHebdo(planningEquipe: any[], gerantId: number): SlotHebdo[] {
  const mine = (planningEquipe || []).filter(
    (p) => Number(p.gerant_id) === Number(gerantId) && !p.date_specifique,
  );
  return JOURS.map((_, i) => {
    const slot = mine.find((p) => p.jour_semaine != null && Number(p.jour_semaine) === i);
    return {
      jour_semaine: i,
      actif: Boolean(slot),
      heure_debut: String(slot?.heure_debut || "08:00").slice(0, 5),
      heure_fin: String(slot?.heure_fin || "23:00").slice(0, 5),
    };
  });
}

function initials(prenom?: string, nom?: string) {
  const a = String(prenom || "").trim().charAt(0);
  const b = String(nom || "").trim().charAt(0);
  return (a + b).toUpperCase() || "?";
}

/**
 * Carte planning d'un gérant — éditable par le gérant principal.
 */
export default function CardPlanningGerant({
  terrainId,
  gerant,
  estMoi,
  planningEquipe,
  editable,
  onSaved,
}: {
  terrainId: number;
  gerant: ColleguePlanning;
  estMoi: boolean;
  planningEquipe: any[];
  editable: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hebdo, setHebdo] = useState<SlotHebdo[]>(() =>
    initialHebdo(planningEquipe, gerant.gerant_id),
  );
  const [saving, setSaving] = useState(false);

  const nbGardes = useMemo(
    () => hebdo.filter((h) => h.actif).length,
    [hebdo],
  );

  const syncFromProps = () => {
    setHebdo(initialHebdo(planningEquipe, gerant.gerant_id));
  };

  const toggleExpand = () => {
    if (!expanded) syncFromProps();
    setExpanded((v) => !v);
  };

  const save = async () => {
    if (!editable) return;
    setSaving(true);
    try {
      await gerantApi.saveEquipePlanning(terrainId, gerant.gerant_id, {
        planning_hebdo: hebdo.filter((h) => h.actif).map((h) => ({
          jour_semaine: h.jour_semaine,
          heure_debut: h.heure_debut,
          heure_fin: h.heure_fin,
          actif: true,
        })),
      });
      toast.success("Planning enregistré");
      await onSaved();
      setExpanded(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-xl mb-2 overflow-hidden"
      style={{ border: "1px solid var(--g-border)" }}
    >
      <button
        type="button"
        onClick={toggleExpand}
        className="w-full flex items-center gap-3 p-3 text-left btn-press"
        style={{ background: "var(--g-surface)" }}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden"
          style={{
            background: "color-mix(in srgb, var(--g-primary) 16%, transparent)",
            color: "var(--g-primary)",
          }}
        >
          {gerant.photo_profil ? (
            <img src={gerant.photo_profil} alt="" className="w-full h-full object-cover" />
          ) : (
            initials(gerant.prenom, gerant.nom)
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate" style={{ color: "var(--g-text)" }}>
              {gerant.prenom || ""} {gerant.nom || ""}
              {estMoi ? (
                <span className="text-xs ml-1 font-medium" style={{ color: "var(--g-muted)" }}>
                  (toi)
                </span>
              ) : null}
            </p>
            {Number(gerant.est_principal) === 1 ? (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                style={{
                  background: "color-mix(in srgb, var(--g-primary) 14%, transparent)",
                  color: "var(--g-primary)",
                }}
              >
                Principal
              </span>
            ) : null}
          </div>
          <p className="text-xs" style={{ color: "var(--g-muted)" }}>
            {nbGardes} garde{nbGardes > 1 ? "s" : ""} cette semaine
          </p>
        </div>
        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
          style={{ color: "var(--g-muted)" }}
        />
      </button>

      {expanded ? (
        <div
          className="p-3 border-t space-y-1"
          style={{ borderColor: "var(--g-border)", background: "var(--g-surface-2)" }}
        >
          {hebdo.map((slot, i) => (
            <div
              key={slot.jour_semaine}
              className="flex items-center gap-2 py-2 border-b last:border-b-0 flex-wrap"
              style={{ borderColor: "var(--g-border)" }}
            >
              <span className="text-xs font-semibold w-8 shrink-0" style={{ color: "var(--g-text-2)" }}>
                {JOURS[i]}
              </span>
              <label className="inline-flex items-center gap-1.5 text-xs shrink-0" style={{ color: "var(--g-text)" }}>
                <input
                  type="checkbox"
                  checked={slot.actif}
                  disabled={!editable}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setHebdo((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, actif: checked } : x)),
                    );
                  }}
                />
                Garde
              </label>
              {slot.actif ? (
                <>
                  <input
                    type="time"
                    value={slot.heure_debut}
                    disabled={!editable}
                    onChange={(e) =>
                      setHebdo((prev) =>
                        prev.map((x, idx) =>
                          idx === i ? { ...x, heure_debut: e.target.value } : x,
                        ),
                      )
                    }
                    className="text-xs rounded-lg px-2 py-1.5 min-h-[36px]"
                    style={{
                      background: "var(--g-surface)",
                      border: "1px solid var(--g-border)",
                      color: "var(--g-text)",
                    }}
                  />
                  <span className="text-xs" style={{ color: "var(--g-muted)" }}>
                    →
                  </span>
                  <input
                    type="time"
                    value={slot.heure_fin}
                    disabled={!editable}
                    onChange={(e) =>
                      setHebdo((prev) =>
                        prev.map((x, idx) =>
                          idx === i ? { ...x, heure_fin: e.target.value } : x,
                        ),
                      )
                    }
                    className="text-xs rounded-lg px-2 py-1.5 min-h-[36px]"
                    style={{
                      background: "var(--g-surface)",
                      border: "1px solid var(--g-border)",
                      color: "var(--g-text)",
                    }}
                  />
                </>
              ) : null}
            </div>
          ))}

          {editable ? (
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="w-full mt-3 py-2.5 rounded-xl text-sm font-semibold text-white btn-press disabled:opacity-60"
              style={{ background: "var(--g-primary)" }}
            >
              {saving ? "Enregistrement…" : "Enregistrer le planning"}
            </button>
          ) : (
            <p className="text-xs mt-2" style={{ color: "var(--g-muted)" }}>
              Lecture seule — seul le gérant principal peut modifier.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
