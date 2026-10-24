import {
  Activity,
  CalendarPlus,
  CheckCircle,
  Circle,
  QrCode,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { proprietaireApi } from "@/lib/api";
import ProprioEmptyState from "@/espaces/backoffice/components/ProprioEmptyState";

type Terrain = { id: number; nom: string };
type Garde = {
  terrain_id: number;
  terrain_nom?: string | null;
  gerant_id: number;
  prenom?: string | null;
  nom?: string | null;
  en_ligne?: boolean;
  derniere_activite?: string | null;
};
type Activite = {
  id: number;
  action: string;
  detail: string;
  created_at: string;
  gerant_prenom?: string | null;
  gerant_nom?: string | null;
  terrain_nom?: string | null;
};

type TypeFiltre = "tout" | "scan_qr" | "reservation" | "encaissement" | "session" | "creneau";
type Periode = "aujourd_hui" | "semaine" | "mois";

const TYPE_PILLS: Array<{ id: TypeFiltre; label: string }> = [
  { id: "tout", label: "Tout" },
  { id: "scan_qr", label: "Scans QR" },
  { id: "reservation", label: "Réservations" },
  { id: "creneau", label: "Créneaux" },
  { id: "encaissement", label: "Encaissements" },
  { id: "session", label: "Sessions" },
];

const PERIODE_PILLS: Array<{ id: Periode; label: string }> = [
  { id: "aujourd_hui", label: "Aujourd'hui" },
  { id: "semaine", label: "Cette semaine" },
  { id: "mois", label: "Ce mois" },
];

function actionConfig(action: string) {
  const map: Record<string, { Icone: typeof QrCode; couleur: string; label: string }> = {
    qr_scanne: { Icone: QrCode, couleur: "var(--p-primary)", label: "QR scanné" },
    checkin_code: { Icone: QrCode, couleur: "var(--p-primary)", label: "Check-in code" },
    validation_manuelle: { Icone: CheckCircle, couleur: "var(--p-success)", label: "Validation manuelle" },
    reservation_creee: { Icone: CalendarPlus, couleur: "var(--p-info)", label: "Réservation créée" },
    reservation_annulee: { Icone: X, couleur: "var(--p-danger)", label: "Réservation annulée" },
    creneau_cree: { Icone: CalendarPlus, couleur: "var(--p-info)", label: "Créneau créé" },
    creneau_supprime: { Icone: X, couleur: "var(--p-muted)", label: "Créneau supprimé" },
    kanban_stage: { Icone: Activity, couleur: "var(--p-accent, var(--p-gold))", label: "File d'attente" },
  };
  return map[action] || { Icone: Circle, couleur: "var(--p-muted)", label: action };
}

function heureRelative(iso?: string) {
  if (!iso) return "—";
  const raw = String(iso).trim();
  const t = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + (raw.includes("Z") ? "" : "Z"));
  const ms = t.getTime();
  if (Number.isNaN(ms)) return raw.slice(11, 16) || raw;
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return t.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function ScrollPills<T extends string>({
  items,
  actif,
  onChange,
}: {
  items: Array<{ id: T; label: string }>;
  actif: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
      {items.map((item) => {
        const on = actif === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className="shrink-0 min-h-[36px] px-3.5 rounded-full text-[11px] font-semibold"
            style={{
              background: on ? "var(--p-primary)" : "var(--p-surface-2)",
              color: on ? "#fff" : "var(--p-muted)",
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export default function AuditProprietaire() {
  const [terrains, setTerrains] = useState<Terrain[]>([]);
  const [filtreTerrain, setFiltreTerrain] = useState<"tous" | number>("tous");
  const [filtreType, setFiltreType] = useState<TypeFiltre>("tout");
  const [periode, setPeriode] = useState<Periode>("aujourd_hui");
  const [gardes, setGardes] = useState<Garde[]>([]);
  const [activites, setActivites] = useState<Activite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await proprietaireApi.audit({
        terrain_id: filtreTerrain === "tous" ? undefined : filtreTerrain,
        type: filtreType,
        periode,
      });
      setTerrains(Array.isArray(payload.terrains) ? payload.terrains : []);
      setGardes(Array.isArray(payload.gardes) ? payload.gardes : []);
      setActivites(Array.isArray(payload.activites) ? payload.activites : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger l'activité");
      setActivites([]);
      setGardes([]);
    } finally {
      setLoading(false);
    }
  }, [filtreTerrain, filtreType, periode]);

  useEffect(() => {
    void load();
  }, [load]);

  const terrainPills = useMemo(
    () => [
      { id: "tous" as const, label: "Tous" },
      ...terrains.map((t) => ({ id: t.id as number | "tous", label: t.nom })),
    ],
    [terrains],
  );

  const multi = terrains.length > 1;
  const typeSansData = filtreType === "encaissement" || filtreType === "session";

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="px-0.5">
        <h1 className="text-lg font-bold" style={{ color: "var(--p-text)", fontFamily: "var(--font-display)" }}>
          Activité du terrain
        </h1>
        <p className="text-xs mt-0.5" style={{ color: "var(--p-muted)" }}>
          Actions de tes gérants — scans, réservations, créneaux
        </p>
      </div>

      <section className="flex flex-col gap-2">
        {multi ? (
          <ScrollPills
            items={terrainPills as Array<{ id: "tous" | number; label: string }>}
            actif={filtreTerrain}
            onChange={setFiltreTerrain}
          />
        ) : null}
        <ScrollPills items={TYPE_PILLS} actif={filtreType} onChange={setFiltreType} />
        <ScrollPills items={PERIODE_PILLS} actif={periode} onChange={setPeriode} />
      </section>

      {gardes.length > 0 ? (
        <section className="space-y-2">
          {gardes.map((g) => (
            <div
              key={`${g.terrain_id}-${g.gerant_id}`}
              className="p-3 rounded-xl flex items-center gap-3"
              style={{
                background: "var(--p-success-subtle, color-mix(in srgb, var(--p-success) 12%, transparent))",
                border: "1px solid var(--p-success-border, var(--p-success))",
              }}
            >
              <div
                className={`w-2 h-2 rounded-full shrink-0 ${g.en_ligne ? "animate-pulse" : ""}`}
                style={{ background: g.en_ligne ? "var(--p-success)" : "var(--p-muted)" }}
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold" style={{ color: "var(--p-success-text, var(--p-success))" }}>
                  {g.en_ligne ? "De garde · en ligne" : "De garde (planning)"}
                </p>
                <p className="text-sm font-bold truncate" style={{ color: "var(--p-text)" }}>
                  {g.prenom || ""} {g.nom || ""}
                </p>
                <p className="text-xs" style={{ color: "var(--p-muted)" }}>
                  {g.terrain_nom || "Terrain"}
                  {g.en_ligne && g.derniere_activite
                    ? ` · actif ${heureRelative(g.derniere_activite)}`
                    : ""}
                </p>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section>
        {loading ? (
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 rounded-xl" style={{ background: "var(--p-surface-2)" }} />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm py-8 text-center" style={{ color: "var(--p-danger)" }}>
            {error}
          </p>
        ) : activites.length === 0 ? (
          <ProprioEmptyState
            title={typeSansData ? "Pas encore suivi ici" : "Aucune activité"}
            subtitle={
              typeSansData
                ? "Les encaissements et sessions de service seront branchés au fil de l'eau sur ce fil."
                : "Rien sur cette période pour ce filtre."
            }
          />
        ) : (
          <div className="rounded-2xl px-3" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
            {activites.map((a) => {
              const cfg = actionConfig(a.action);
              const Icone = cfg.Icone;
              return (
                <div
                  key={a.id}
                  className="flex items-start gap-3 py-3 border-b last:border-b-0"
                  style={{ borderColor: "var(--p-border)" }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: `color-mix(in srgb, ${cfg.couleur} 18%, transparent)` }}
                  >
                    <Icone className="w-4 h-4" style={{ color: cfg.couleur }} />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold" style={{ color: "var(--p-text)" }}>
                          {cfg.label}
                        </p>
                        <p className="text-xs" style={{ color: "var(--p-text-2)" }}>
                          {a.detail}
                        </p>
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          <User className="w-3 h-3" style={{ color: "var(--p-muted)" }} />
                          <span className="text-xs" style={{ color: "var(--p-muted)" }}>
                            {a.gerant_prenom || ""} {a.gerant_nom || "Gérant"}
                          </span>
                          {multi && a.terrain_nom ? (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-full ml-1"
                              style={{ background: "var(--p-surface-2)", color: "var(--p-muted)" }}
                            >
                              {a.terrain_nom}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <span className="text-xs shrink-0" style={{ color: "var(--p-muted)" }}>
                        {heureRelative(a.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
