import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { superAdminApi } from "@/services/superAdminApi";
import ConfirmationModal from "@/espaces/backoffice/components/superadmin/ConfirmationModal";
import Select2 from "@/components/Select2";
import { fcfa } from "@/lib/saContrat";

const MOIS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

function moisLabel(periode: string) {
  const [y, m] = String(periode || "").split("-");
  const idx = Number(m) - 1;
  if (!Number.isFinite(idx) || idx < 0) return periode;
  return `${MOIS[idx]} ${y}`;
}

function csvEscape(v: unknown) {
  const s = String(v ?? "");
  if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function DettesCommissionsTab({ terrains }: { terrains: any[] }) {
  const [periode, setPeriode] = useState<"mois" | "prev" | "custom">("mois");
  const [custom, setCustom] = useState("");
  const [terrainId, setTerrainId] = useState("");
  const [statut, setStatut] = useState("");
  const [payload, setPayload] = useState<any>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [zeroRow, setZeroRow] = useState<any>(null);
  const [montant, setMontant] = useState("");
  const [note, setNote] = useState("");
  const [instructions, setInstructions] = useState("");

  const periodeKey = periode === "prev" ? "prev" : periode === "custom" && /^\d{4}-\d{2}$/.test(custom) ? custom : "";

  const load = () => {
    superAdminApi.dettes({
      periode: periodeKey || undefined,
      terrain_id: terrainId ? Number(terrainId) : undefined,
      statut: statut || undefined,
    }).then((data) => {
      setPayload(data);
      setInstructions(data?.instructions || "");
    }).catch(console.error);
  };

  useEffect(() => { load(); }, [periodeKey, terrainId, statut]);

  const rows = payload?.par_terrain || [];
  const lignes = payload?.lignes || [];
  const audit = payload?.audit || [];

  const lignesByTerrain = useMemo(() => {
    const map = new Map<number, any[]>();
    for (const l of lignes) {
      const id = Number(l.terrain_id);
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(l);
    }
    return map;
  }, [lignes]);

  async function confirmerZero() {
    if (!zeroRow) return;
    try {
      await superAdminApi.remiseAZeroDette(zeroRow.terrain_id, {
        montant_recu: Number(montant || zeroRow.commission_due || 0),
        note,
        periode: zeroRow.periode,
      });
      toast.success("Compteur remis à zéro ✓");
      setZeroRow(null);
      setNote("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible de remettre à zéro");
    }
  }

  function exportCsv() {
    const header = ["Date", "Terrain", "Action", "Montant", "Fait par"];
    const body = audit.map((a: any) => [
      a.created_at, a.terrain_nom, a.action, a.montant_concerne, a.fait_par_nom || a.role_fait_par,
    ].map(csvEscape).join(";"));
    const blob = new Blob([[header.join(";"), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "audit-dettes.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select2
          value={periode}
          onChange={(v) => setPeriode(v as "mois" | "prev" | "custom")}
          options={[
            { value: "mois", label: "Ce mois" },
            { value: "prev", label: "Mois précédent" },
            { value: "custom", label: "Personnalisé" },
          ]}
        />
        {periode === "custom" ? (
          <input type="month" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-10 rounded-lg px-3 text-sm" style={{ border: "1px solid var(--sa-border)" }} />
        ) : null}
        <Select2
          value={terrainId}
          onChange={setTerrainId}
          placeholder="Tous les terrains"
          options={[{ value: "", label: "Tous les terrains" }, ...terrains.map((t) => ({ value: String(t.id), label: t.nom }))]}
        />
        <Select2
          value={statut}
          onChange={setStatut}
          options={[
            { value: "", label: "Toutes" },
            { value: "en_attente", label: "En attente" },
            { value: "payee", label: "Payées" },
          ]}
        />
      </div>

      <section className="rounded-xl overflow-hidden" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <div className="overflow-x-auto">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Terrain</th>
                <th>Gérant</th>
                <th>Mois</th>
                <th>Réservations manuelles</th>
                <th>Commission due</th>
                <th>Statut</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => {
                const attente = row.statut === "en_attente";
                return (
                  <Fragment key={`${row.terrain_id}-${row.periode}`}>
                    <tr key={`${row.terrain_id}-${row.periode}`} className="cursor-pointer" onClick={() => setOpenId(openId === row.terrain_id ? null : row.terrain_id)}>
                      <td>
                        <p className="font-medium">{row.terrain_nom}</p>
                        <p className="text-[11px]" style={{ color: "var(--sa-muted)" }}>{row.ville}</p>
                      </td>
                      <td>
                        {row.gerant_prenom || row.gerant_nom || "—"}
                        {row.gerant_telephone ? (
                          <a href={`https://wa.me/221${String(row.gerant_telephone).replace(/\D/g, "").slice(-9)}`} className="block text-[11px]" style={{ color: "var(--sa-primary)" }} onClick={(e) => e.stopPropagation()}>
                            WhatsApp
                          </a>
                        ) : null}
                      </td>
                      <td>{moisLabel(row.periode)}</td>
                      <td>{row.nb_reservations} réservation(s)</td>
                      <td className="font-semibold" style={{ color: attente ? "var(--sa-warning)" : "var(--sa-success)" }}>{fcfa(row.commission_due)}</td>
                      <td>
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: attente ? "var(--sa-warning-bg)" : "var(--sa-success-bg)", color: attente ? "var(--sa-warning)" : "var(--sa-success)" }}>
                          {attente ? "En attente" : "Payée ✓"}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {attente ? (
                          <button type="button" className="h-9 px-3 rounded-lg text-[12px] font-semibold text-white" style={{ background: "var(--sa-success)" }} onClick={() => { setZeroRow(row); setMontant(String(row.commission_due || 0)); }}>
                            Marquer payée
                          </button>
                        ) : (
                          <span className="text-[12px]" style={{ color: "var(--sa-muted)" }}>
                            Payé le {row.payee_at ? String(row.payee_at).slice(0, 10) : "—"} {row.remise_par_nom ? `par ${row.remise_par_nom}` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                    {openId === row.terrain_id ? (
                      <tr>
                        <td colSpan={7} className="bg-[var(--sa-surface-2)]">
                          <div className="p-3 space-y-2">
                            {(lignesByTerrain.get(Number(row.terrain_id)) || []).map((l) => (
                              <div key={l.id} className="flex flex-wrap gap-3 text-[12px]">
                                <span>{l.match_date} {String(l.heure_debut || "").slice(0, 5)}</span>
                                <span>{l.joueur_nom}</span>
                                <span>Avance {fcfa(l.montant_avance_manuelle)}</span>
                                <span>Commission {fcfa(l.montant_commission)}</span>
                                <span style={{ color: "var(--sa-muted)" }}>{l.note_gerant || "—"}</span>
                                <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--sa-warning-bg)", color: "var(--sa-warning)" }}>Manuel</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="text-[13px]" style={{ color: "var(--sa-muted)" }}>Aucune dette sur cette période</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl p-4" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-[14px] font-semibold">Historique audit</h3>
          <button type="button" onClick={exportCsv} className="h-9 px-3 rounded-lg text-[12px] font-semibold" style={{ border: "1px solid var(--sa-border)" }}>
            Exporter CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Terrain</th>
                <th>Action</th>
                <th>Montant</th>
                <th>Fait par</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a: any) => (
                <tr key={a.id}>
                  <td>{String(a.created_at || "").replace("T", " ").slice(0, 16)}</td>
                  <td>{a.terrain_nom || "—"}</td>
                  <td>{a.action}</td>
                  <td>{fcfa(a.montant_concerne)}</td>
                  <td>{a.fait_par_nom || a.role_fait_par || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <p className="text-[12px] font-medium mb-1">Instructions de paiement (gérant)</p>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} className="w-full min-h-[72px] rounded-lg p-2 text-sm" style={{ border: "1px solid var(--sa-border)" }} />
          <button
            type="button"
            className="mt-2 h-9 px-3 rounded-lg text-[12px] font-semibold text-white"
            style={{ background: "var(--sa-primary)" }}
            onClick={async () => {
              await superAdminApi.saveDetteInstructions(instructions);
              toast.success("Instructions enregistrées");
            }}
          >
            Enregistrer
          </button>
        </div>
      </section>

      <ConfirmationModal
        ouvert={Boolean(zeroRow)}
        titre="Confirmer la réception du paiement"
        texte={zeroRow ? `Tu vas marquer la commission de ${zeroRow.terrain_nom} comme reçue pour ${moisLabel(zeroRow.periode)}. Le compteur du gérant sera remis à zéro.` : ""}
        labelConfirmer="Confirmer la réception"
        variante="success"
        onAnnuler={() => setZeroRow(null)}
        onConfirmer={() => void confirmerZero()}
      >
        {zeroRow ? (
          <div className="space-y-3 text-[13px]">
            <p>
              Tu vas marquer la commission de {zeroRow.terrain_nom} comme reçue pour {moisLabel(zeroRow.periode)}. Le compteur du gérant sera remis à zéro.
            </p>
            <label className="block">
              <span className="text-[12px]" style={{ color: "var(--sa-muted)" }}>Montant reçu</span>
              <input className="mt-1 w-full h-10 rounded-lg px-3" style={{ border: "1px solid var(--sa-border)" }} value={montant} onChange={(e) => setMontant(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-[12px]" style={{ color: "var(--sa-muted)" }}>Référence / Note</span>
              <input className="mt-1 w-full h-10 rounded-lg px-3" style={{ border: "1px solid var(--sa-border)" }} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
        ) : null}
      </ConfirmationModal>
    </div>
  );
}
