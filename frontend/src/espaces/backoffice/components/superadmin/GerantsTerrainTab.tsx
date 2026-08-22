import { useCallback, useEffect, useMemo, useState } from "react";
import { Ellipsis, Loader2, UserCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi, type TerrainGerant } from "@/services/superAdminApi";
import { ConfirmationModal } from "@/espaces/backoffice/components/superadmin/ConfirmationModal";
const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;

function initials(g: { prenom?: string | null; nom?: string | null }) {
  const p = String(g.prenom || "").trim().charAt(0);
  const n = String(g.nom || "").trim().charAt(0);
  return `${p}${n}`.toUpperCase() || "G";
}

function formatDateFr(value?: string | null) {
  if (!value) return "—";
  const d = new Date(String(value).includes("T") ? value : `${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR");
}

type Props = {
  terrainId: number;
  terrainNom: string;
  onChanged?: () => void;
};

export default function GerantsTerrainTab({ terrainId, terrainNom, onChanged }: Props) {
  const [gerants, setGerants] = useState<TerrainGerant[]>([]);
  const [garde, setGarde] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [planningFor, setPlanningFor] = useState<TerrainGerant | null>(null);
  const [confirmPrincipal, setConfirmPrincipal] = useState<TerrainGerant | null>(null);
  const [confirmRetirer, setConfirmRetirer] = useState<TerrainGerant | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await superAdminApi.terrainGerants(terrainId);
      setGerants(Array.isArray(data?.gerants) ? data.gerants : []);
      setGarde(data?.garde_actuelle || null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible de charger les gérants");
    } finally {
      setLoading(false);
    }
  }, [terrainId]);

  const reloadAndNotify = useCallback(async () => {
    await load();
    onChanged?.();
  }, [load, onChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  const actifs = useMemo(() => gerants.filter((g) => Number(g.actif) === 1), [gerants]);
  const principal = actifs.find((g) => Number(g.est_principal) === 1);

  async function setPrincipal(g: TerrainGerant) {
    try {
      await superAdminApi.setGerantPrincipal(terrainId, g.gerant_id);
      toast.success(`${g.prenom || g.nom} est maintenant principal`);
      setConfirmPrincipal(null);
      await reloadAndNotify();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible de définir le principal");
    }
  }

  async function toggleActif(g: TerrainGerant) {
    try {
      await superAdminApi.patchTerrainGerant(terrainId, g.gerant_id, {
        actif: Number(g.actif) === 1 ? 0 : 1,
      });
      await reloadAndNotify();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Modification impossible");
    }
  }

  async function retirer(g: TerrainGerant) {
    try {
      await superAdminApi.removeTerrainGerant(terrainId, g.gerant_id);
      toast.success("Gérant retiré du terrain");
      setConfirmRetirer(null);
      await reloadAndNotify();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retrait impossible");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--sa-muted)" }}>
        <Loader2 size={16} className="animate-spin" /> Chargement des gérants…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {actifs.length > 1 && garde ? (
        <div
          className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          style={{
            background: "var(--sa-success-bg, var(--sa-success-subtle, #ecfdf5))",
            border: "1px solid var(--sa-success)",
          }}
        >
          <div className="flex items-start gap-3">
            <UserCheck size={20} style={{ color: "var(--sa-success)" }} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-[14px] font-semibold" style={{ color: "var(--sa-text)" }}>
                De garde en ce moment : {[garde.prenom, garde.nom].filter(Boolean).join(" ")}
                {garde.telephone ? ` · ${garde.telephone}` : ""}
              </p>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--sa-muted)" }}>
                Calculé automatiquement selon le planning
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold" style={{ color: "var(--sa-text)" }}>
            Gérants du terrain
          </h2>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--sa-muted)" }}>
            Un seul gérant principal — les autres ont accès en parallèle
          </p>
        </div>
        <button
          type="button"
          className="sa-btn-primary inline-flex items-center gap-2 min-h-[40px] px-4 rounded-lg text-[13px] font-semibold"
          onClick={() => setAddOpen(true)}
        >
          <UserPlus size={16} /> Ajouter un gérant
        </button>
      </div>

      <div className="space-y-3">
        {gerants.length === 0 ? (
          <p className="text-[13px] rounded-xl p-4" style={{ background: "var(--sa-surface)", color: "var(--sa-muted)" }}>
            Aucun gérant rattaché. Ajoutez-en un pour ce terrain.
          </p>
        ) : (
          gerants.map((g) => {
            const isPrincipal = Number(g.est_principal) === 1;
            const isActif = Number(g.actif) === 1;
            return (
              <div
                key={g.id || g.gerant_id}
                className="rounded-xl p-4 flex flex-col lg:flex-row lg:items-center gap-4"
                style={{
                  background: "var(--sa-surface)",
                  boxShadow: "var(--sa-shadow)",
                  borderLeft: isPrincipal ? "3px solid var(--sa-success)" : "3px solid transparent",
                  opacity: isActif ? 1 : 0.6,
                }}
              >
                <div className="flex items-center gap-3 min-w-[220px]">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0"
                    style={{ background: "var(--sa-surface-2)", color: "var(--sa-primary)" }}
                  >
                    {initials(g)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold truncate" style={{ color: "var(--sa-text)" }}>
                      {[g.prenom, g.nom].filter(Boolean).join(" ")}
                    </p>
                    <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>
                      {g.telephone || g.whatsapp_number || "—"}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {isPrincipal ? (
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: "var(--sa-success-bg)", color: "var(--sa-success)" }}
                        >
                          Principal
                        </span>
                      ) : null}
                      {g.note ? (
                        <span className="text-[11px] italic" style={{ color: "var(--sa-muted)" }}>
                          {g.note}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex-1 text-[12px] space-y-0.5" style={{ color: "var(--sa-muted)" }}>
                  <p>Depuis : {formatDateFr(g.date_debut)}</p>
                  <p>Jusqu&apos;au : {g.date_fin ? formatDateFr(g.date_fin) : "Sans limite"}</p>
                  <p>
                    Planning :{" "}
                    {Number(g.nb_gardes) > 0
                      ? `${g.nb_gardes} garde${Number(g.nb_gardes) > 1 ? "s" : ""} configurée${Number(g.nb_gardes) > 1 ? "s" : ""}`
                      : "Pas de planning"}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => void toggleActif(g)}
                    className="text-[12px] font-medium px-3 py-1.5 rounded-lg min-h-[36px]"
                    style={{
                      background: isActif ? "var(--sa-success-bg)" : "var(--sa-surface-2)",
                      color: isActif ? "var(--sa-success)" : "var(--sa-muted)",
                    }}
                  >
                    {isActif ? "Actif" : "Inactif"}
                  </button>
                  {!isPrincipal && isActif ? (
                    <button
                      type="button"
                      className="text-[12px] font-medium px-3 py-1.5 rounded-lg min-h-[36px]"
                      style={{ border: "1px solid var(--sa-border)", color: "var(--sa-text)" }}
                      onClick={() => setConfirmPrincipal(g)}
                    >
                      Définir comme principal
                    </button>
                  ) : null}
                  <div className="relative">
                    <button
                      type="button"
                      className="w-9 h-9 rounded-lg inline-flex items-center justify-center"
                      style={{ border: "1px solid var(--sa-border)" }}
                      onClick={() => setMenuId(menuId === g.gerant_id ? null : g.gerant_id)}
                      aria-label="Actions"
                    >
                      <Ellipsis size={16} />
                    </button>
                    {menuId === g.gerant_id ? (
                      <div
                        className="absolute right-0 top-10 z-20 min-w-[200px] rounded-lg py-1"
                        style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)", border: "1px solid var(--sa-border)" }}
                      >
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-[13px] hover:opacity-80"
                          onClick={() => {
                            setMenuId(null);
                            setPlanningFor(g);
                          }}
                        >
                          Voir le planning de garde
                        </button>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-[13px]"
                          style={{ color: "var(--sa-danger)" }}
                          onClick={() => {
                            setMenuId(null);
                            setConfirmRetirer(g);
                          }}
                        >
                          Retirer du terrain
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {addOpen ? (
        <AjouterGerantModal
          terrainId={terrainId}
          terrainNom={terrainNom}
          principalPrenom={principal?.prenom || principal?.nom || null}
          onClose={() => setAddOpen(false)}
          onDone={async () => {
            setAddOpen(false);
            await reloadAndNotify();
          }}
        />
      ) : null}

      {planningFor ? (
        <PlanningGardeModal
          terrainId={terrainId}
          gerant={planningFor}
          onClose={() => setPlanningFor(null)}
          onSaved={async () => {
            setPlanningFor(null);
            await reloadAndNotify();
          }}
        />
      ) : null}

      <ConfirmationModal
        ouvert={Boolean(confirmPrincipal)}
        titre={confirmPrincipal ? `Définir ${confirmPrincipal.prenom || confirmPrincipal.nom} comme gérant principal ?` : ""}
        texte="Il recevra toutes les notifications du terrain (reversements, alertes)."
        labelConfirmer="Définir comme principal"
        variante="success"
        onConfirmer={() => confirmPrincipal && void setPrincipal(confirmPrincipal)}
        onAnnuler={() => setConfirmPrincipal(null)}
      />

      <ConfirmationModal
        ouvert={Boolean(confirmRetirer)}
        titre={confirmRetirer ? `Retirer ${confirmRetirer.prenom || confirmRetirer.nom} du terrain ?` : ""}
        texte="Le compte reste actif mais n'aura plus accès à ce terrain."
        labelConfirmer="Retirer"
        variante="danger"
        onConfirmer={() => confirmRetirer && void retirer(confirmRetirer)}
        onAnnuler={() => setConfirmRetirer(null)}
      />
    </div>
  );
}

function AjouterGerantModal({
  terrainId,
  terrainNom,
  principalPrenom,
  onClose,
  onDone,
}: {
  terrainId: number;
  terrainNom: string;
  principalPrenom: string | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [estPrincipal, setEstPrincipal] = useState(false);
  const [note, setNote] = useState("");
  const [dateDebut, setDateDebut] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateFin, setDateFin] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      superAdminApi
        .searchGerants(q)
        .then((rows) => setResults(Array.isArray(rows) ? rows : []))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function submit() {
    if (!selected?.id) {
      toast.error("Choisissez un gérant");
      return;
    }
    setSaving(true);
    try {
      await superAdminApi.addTerrainGerant(terrainId, {
        gerant_id: selected.id,
        est_principal: estPrincipal ? 1 : 0,
        note: note.trim() || null,
        date_debut: dateDebut || null,
        date_fin: dateFin || null,
      });
      toast.success("Gérant ajouté");
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ajout impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center px-0 md:px-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Fermer" onClick={onClose} />
      <div
        className="relative w-full max-w-lg rounded-t-2xl md:rounded-2xl p-5 max-h-[90vh] overflow-auto"
        style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}
      >
        <h3 className="text-[16px] font-semibold" style={{ color: "var(--sa-text)" }}>
          Ajouter un gérant à {terrainNom}
        </h3>

        <label className="block mt-4 text-[12px] font-medium" style={{ color: "var(--sa-muted)" }}>
          Choisir un gérant existant
        </label>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nom ou téléphone…"
          className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
          style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface-2)" }}
        />
        <div className="mt-2 max-h-40 overflow-auto rounded-lg" style={{ border: "1px solid var(--sa-border)" }}>
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              className="w-full text-left px-3 py-2 text-[13px]"
              style={{
                background: selected?.id === r.id ? "var(--sa-primary-bg, var(--sa-surface-2))" : "transparent",
                color: "var(--sa-text)",
              }}
              onClick={() => setSelected(r)}
            >
              {[r.prenom, r.nom].filter(Boolean).join(" ")} · {r.telephone || r.whatsapp_number || "—"}
              {Number(r.nb_terrains) > 0 ? (
                <span style={{ color: "var(--sa-muted)" }}> · {r.nb_terrains} terrain(s)</span>
              ) : null}
            </button>
          ))}
          {!results.length ? (
            <p className="px-3 py-2 text-[12px]" style={{ color: "var(--sa-muted)" }}>
              Aucun résultat
            </p>
          ) : null}
        </div>

        <p className="mt-4 text-[12px] font-medium" style={{ color: "var(--sa-muted)" }}>
          Rôle sur ce terrain
        </p>
        <div className="mt-1 flex gap-3 text-[13px]">
          <label className="inline-flex items-center gap-2">
            <input type="radio" checked={!estPrincipal} onChange={() => setEstPrincipal(false)} />
            Gérant supplémentaire
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" checked={estPrincipal} onChange={() => setEstPrincipal(true)} />
            Gérant principal
          </label>
        </div>
        {estPrincipal && principalPrenom ? (
          <p className="mt-1 text-[12px]" style={{ color: "var(--sa-warning)" }}>
            L&apos;actuel principal {principalPrenom} sera rétrogradé
          </p>
        ) : null}

        <label className="block mt-4 text-[12px] font-medium" style={{ color: "var(--sa-muted)" }}>
          Note (optionnel)
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder='Ex: "Gérant matin"'
          className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
          style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface-2)" }}
        />

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-medium" style={{ color: "var(--sa-muted)" }}>
              Date de début
            </label>
            <input
              type="date"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
              style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface-2)" }}
            />
          </div>
          <div>
            <label className="text-[12px] font-medium" style={{ color: "var(--sa-muted)" }}>
              Date de fin (optionnel)
            </label>
            <input
              type="date"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
              style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface-2)" }}
            />
          </div>
        </div>

        <div className="mt-5 flex gap-2 justify-end">
          <button type="button" className="px-4 py-2 rounded-lg text-[13px]" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            disabled={saving}
            className="sa-btn-primary px-4 py-2 rounded-lg text-[13px] font-semibold inline-flex items-center gap-2"
            onClick={() => void submit()}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Ajouter le gérant
          </button>
        </div>
      </div>
    </div>
  );
}

function PlanningGardeModal({
  terrainId,
  gerant,
  onClose,
  onSaved,
}: {
  terrainId: number;
  gerant: TerrainGerant;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [hebdo, setHebdo] = useState(
    () =>
      JOURS.map((_, i) => ({
        jour_semaine: i,
        actif: false,
        heure_debut: "08:00",
        heure_fin: "18:00",
      })),
  );
  const [datesSpec, setDatesSpec] = useState<
    Array<{ date_specifique: string; heure_debut: string; heure_fin: string }>
  >([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    superAdminApi
      .terrainGerants(terrainId)
      .then((data) => {
        const mine = (data?.planning || []).filter(
          (p: any) => Number(p.gerant_id) === Number(gerant.gerant_id),
        );
        const next = JOURS.map((_, i) => {
          const slot = mine.find((p: any) => p.jour_semaine != null && Number(p.jour_semaine) === i && !p.date_specifique);
          return {
            jour_semaine: i,
            actif: Boolean(slot),
            heure_debut: String(slot?.heure_debut || "08:00").slice(0, 5),
            heure_fin: String(slot?.heure_fin || "18:00").slice(0, 5),
          };
        });
        setHebdo(next);
        setDatesSpec(
          mine
            .filter((p: any) => p.date_specifique)
            .map((p: any) => ({
              date_specifique: String(p.date_specifique).slice(0, 10),
              heure_debut: String(p.heure_debut || "08:00").slice(0, 5),
              heure_fin: String(p.heure_fin || "18:00").slice(0, 5),
            })),
        );
      })
      .catch(() => undefined);
  }, [terrainId, gerant.gerant_id]);

  function copyToAll() {
    const first = hebdo.find((h) => h.actif);
    if (!first) return;
    setHebdo((prev) =>
      prev.map((h) =>
        h.actif ? { ...h, heure_debut: first.heure_debut, heure_fin: first.heure_fin } : h,
      ),
    );
  }

  async function save() {
    setSaving(true);
    try {
      await superAdminApi.saveGerantPlanning(terrainId, gerant.gerant_id, {
        planning_hebdo: hebdo.filter((h) => h.actif),
        dates_specifiques: datesSpec,
      });
      toast.success("Planning enregistré");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center px-0 md:px-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Fermer" onClick={onClose} />
      <div
        className="relative w-full max-w-2xl rounded-t-2xl md:rounded-2xl p-5 max-h-[90vh] overflow-auto"
        style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}
      >
        <h3 className="text-[16px] font-semibold" style={{ color: "var(--sa-text)" }}>
          Planning de garde — {gerant.prenom || gerant.nom}
        </h3>
        <p className="text-[12px] mt-1" style={{ color: "var(--sa-muted)" }}>
          Définissez les créneaux horaires où ce gérant est de garde
        </p>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {hebdo.map((h, i) => (
            <div
              key={h.jour_semaine}
              className="rounded-lg p-2"
              style={{ background: "var(--sa-surface-2)", border: "1px solid var(--sa-border)" }}
            >
              <label className="flex items-center gap-1.5 text-[12px] font-semibold">
                <input
                  type="checkbox"
                  checked={h.actif}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setHebdo((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, actif: checked } : x)),
                    );
                  }}
                />
                {JOURS[i]}
              </label>
              {h.actif ? (
                <div className="mt-2 space-y-1">
                  <input
                    type="time"
                    value={h.heure_debut}
                    onChange={(e) =>
                      setHebdo((prev) =>
                        prev.map((x, idx) => (idx === i ? { ...x, heure_debut: e.target.value } : x)),
                      )
                    }
                    className="w-full text-[11px] rounded px-1 py-1"
                  />
                  <input
                    type="time"
                    value={h.heure_fin}
                    onChange={(e) =>
                      setHebdo((prev) =>
                        prev.map((x, idx) => (idx === i ? { ...x, heure_fin: e.target.value } : x)),
                      )
                    }
                    className="w-full text-[11px] rounded px-1 py-1"
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <button
          type="button"
          className="mt-3 text-[12px] font-medium underline"
          style={{ color: "var(--sa-primary)" }}
          onClick={copyToAll}
        >
          Copier sur tous les jours actifs
        </button>

        <div className="mt-5">
          <p className="text-[13px] font-semibold" style={{ color: "var(--sa-text)" }}>
            Dates spécifiques
          </p>
          <button
            type="button"
            className="mt-2 text-[12px] font-medium"
            style={{ color: "var(--sa-primary)" }}
            onClick={() =>
              setDatesSpec((prev) => [
                ...prev,
                {
                  date_specifique: new Date().toISOString().slice(0, 10),
                  heure_debut: "08:00",
                  heure_fin: "18:00",
                },
              ])
            }
          >
            + Ajouter une garde exceptionnelle
          </button>
          <div className="mt-2 space-y-2">
            {datesSpec.map((d, idx) => (
              <div key={`${d.date_specifique}-${idx}`} className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={d.date_specifique}
                  onChange={(e) =>
                    setDatesSpec((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, date_specifique: e.target.value } : x)),
                    )
                  }
                  className="rounded-lg px-2 py-1 text-sm"
                  style={{ border: "1px solid var(--sa-border)" }}
                />
                <input
                  type="time"
                  value={d.heure_debut}
                  onChange={(e) =>
                    setDatesSpec((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, heure_debut: e.target.value } : x)),
                    )
                  }
                  className="rounded-lg px-2 py-1 text-sm"
                />
                <input
                  type="time"
                  value={d.heure_fin}
                  onChange={(e) =>
                    setDatesSpec((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, heure_fin: e.target.value } : x)),
                    )
                  }
                  className="rounded-lg px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  className="text-[12px]"
                  style={{ color: "var(--sa-danger)" }}
                  onClick={() => setDatesSpec((prev) => prev.filter((_, i) => i !== idx))}
                >
                  Supprimer
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex gap-2 justify-end">
          <button type="button" className="px-4 py-2 rounded-lg text-[13px]" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            disabled={saving}
            className="sa-btn-primary px-4 py-2 rounded-lg text-[13px] font-semibold inline-flex items-center gap-2"
            onClick={() => void save()}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Enregistrer le planning
          </button>
        </div>
      </div>
    </div>
  );
}
