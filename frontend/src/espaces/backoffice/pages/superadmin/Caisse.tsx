import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import AlerteBandeau from "@/espaces/backoffice/components/superadmin/AlerteBandeau";
import NumeroCopier from "@/espaces/backoffice/components/superadmin/NumeroCopier";
import StatutDu from "@/espaces/backoffice/components/superadmin/StatutDu";
import ModeBadge from "@/espaces/backoffice/components/superadmin/ModeBadge";
import ConfirmationModal from "@/espaces/backoffice/components/superadmin/ConfirmationModal";
import DettesCommissionsTab from "@/espaces/backoffice/components/superadmin/DettesCommissionsTab";
import Select2 from "@/components/Select2";
import { fcfa, relativeDepuis } from "@/lib/saContrat";

type TabId = "fenetre" | "payable" | "retraits" | "dettes";

function asList(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["lignes", "items", "demandes", "rows"]) {
      if (Array.isArray(obj[key])) return obj[key] as any[];
    }
  }
  return [];
}

export default function Caisse() {
  useSaCrumbs([{ label: "Caisse & Reversements" }]);
  const [tab, setTab] = useState<TabId>("retraits");
  const [filtrePayable, setFiltrePayable] = useState<"tous" | "auto" | "retrait">("tous");
  const [fenetre, setFenetre] = useState<any[]>([]);
  const [payable, setPayable] = useState<any[]>([]);
  const [retraits, setRetraits] = useState<any[]>([]);
  const [historique, setHistorique] = useState<any[]>([]);
  const [refModal, setRefModal] = useState<any | null>(null);
  const [rejectModal, setRejectModal] = useState<any | null>(null);
  const [verserModal, setVerserModal] = useState<any | null>(null);
  const [refInput, setRefInput] = useState("");
  const [modeManuel, setModeManuel] = useState(false);
  const [motif, setMotif] = useState("Numéro incorrect");
  const [motifLibre, setMotifLibre] = useState("");
  const [histOpen, setHistOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [verserBusyId, setVerserBusyId] = useState<number | null>(null);
  const [terrains, setTerrains] = useState<any[]>([]);
  const [finances, setFinances] = useState<any>();

  const load = useCallback(async () => {
    try {
      const [f, p, r, h, t, fin] = await Promise.all([
        superAdminApi.caisseFenetre(),
        superAdminApi.caissePayable(),
        superAdminApi.caisseRetraits("tous"),
        superAdminApi.caisseHistorique().catch(() => []),
        superAdminApi.terrains().catch(() => []),
        superAdminApi.finances().catch(() => null),
      ]);
      setFenetre(asList(f));
      setPayable(asList(p));
      setRetraits(asList(r));
      setHistorique(asList(h));
      setTerrains(Array.isArray(t) ? t : []);
      setFinances(fin);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Caisse indisponible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const attente = retraits.filter((d) => d.statut === "en_attente" || d.statut === "en_cours");
  const retraitsTraites = retraits.filter((d) => d.statut !== "en_attente" && d.statut !== "en_cours").slice(0, 20);
  const payableFiltre = payable.filter((d) => filtrePayable === "tous" || d.payout_mode === filtrePayable);
  const urgentes = attente.filter((d) => Date.now() - new Date(d.created_at || d.demande_at).getTime() > 3600000).length;

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "fenetre", label: "En fenêtre de remboursement", count: fenetre.length },
    { id: "payable", label: "Payable", count: payable.length },
    { id: "retraits", label: "Demandes de retrait", count: attente.length },
    { id: "dettes", label: "Dettes commissions", count: Number(finances?.dettes?.terrains_concernes || 0) },
  ];

  async function marquerEnvoye() {
    if (!refModal || submitting) return;
    setSubmitting(true);
    try {
      const result = (await superAdminApi.marquerRetraitEnvoye(refModal.id, refInput || undefined, {
        mode_manuel: modeManuel,
      })) as {
        ok?: boolean;
        pending?: boolean;
        message_lisible?: string;
        error?: string;
      };
      if (result.ok === false) {
        toast.error(result.message_lisible || result.error || "Versement échoué");
      } else if (result.pending) {
        toast.success(result.message_lisible || "Versement initié — en attente prestataire");
      } else {
        toast.success(result.message_lisible || "Versement traité");
      }
      setRefModal(null);
      setRefInput("");
      setModeManuel(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible d'envoyer le versement");
    } finally {
      setSubmitting(false);
    }
  }

  async function rejeter() {
    if (!rejectModal || submitting) return;
    setSubmitting(true);
    try {
      await superAdminApi.rejeterRetrait(rejectModal.id, motif === "Autre" ? motifLibre : motif);
      toast.success("Demande rejetée — le dû reste disponible");
      setRejectModal(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rejet impossible");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmerVerserAuto() {
    if (!verserModal || verserBusyId != null) return;
    const id = Number(verserModal.id);
    setVerserBusyId(id);
    try {
      const result = (await superAdminApi.verserDu(id)) as {
        ok?: boolean;
        pending?: boolean;
        raison?: string;
        message_lisible?: string;
        error?: string;
      };
      if (result.ok) {
        toast.success(
          result.message_lisible
            || (result.pending ? "Versement en attente prestataire" : "Payout traité"),
        );
      } else {
        toast.error(result.message_lisible || result.error || result.raison || "Payout non envoyé");
      }
      setVerserModal(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Relance impossible");
    } finally {
      setVerserBusyId(null);
    }
  }

  if (loading) {
    return <div className="animate-pulse h-40 rounded-xl" style={{ background: "var(--sa-surface-2)" }} />;
  }

  return (
    <div className="space-y-5 max-w-[1200px]">
      <SaPageHeader titre="Caisse & Reversements" sousTitre="Payouts dynamiques : auto, retraits API, compensation dettes commission" />

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="h-10 px-3 rounded-lg text-[13px] font-semibold inline-flex items-center gap-2"
              style={{ background: active ? "var(--sa-primary)" : "var(--sa-surface)", color: active ? "var(--sa-surface)" : "var(--sa-text-2)", border: active ? "none" : "1px solid var(--sa-border)" }}
            >
              {t.label}
              <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] grid place-items-center" style={{ background: active ? "var(--sa-primary-light)" : "var(--sa-surface-2)", color: active ? "var(--sa-surface)" : "var(--sa-text-2)" }}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "fenetre" ? (
        <section className="rounded-xl overflow-hidden" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
          <div className="px-4 py-3">
            <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>Ces dûs ne peuvent pas encore être reversés. Le joueur peut encore annuler et se faire rembourser.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Terrain</th>
                  <th>Résa</th>
                  <th>Avance</th>
                  <th>Commission</th>
                  <th>Net gérant</th>
                  <th>Expire</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {fenetre.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.terrain_nom}</td>
                    <td>{r.code_reservation || r.reservation_id}</td>
                    <td>{fcfa(r.avance)}</td>
                    <td>{fcfa(r.commission)}</td>
                    <td>{fcfa(r.du_gerant)}</td>
                    <td style={{ color: "var(--sa-warning)" }}>{r.fenetre_expire_at ? new Date(r.fenetre_expire_at).toLocaleString("fr-FR") : "—"}</td>
                    <td><StatutDu statut="en_fenetre" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fenetre.length === 0 ? <p className="px-4 py-6 text-[13px]" style={{ color: "var(--sa-muted)" }}>Aucun dû en fenêtre.</p> : null}
        </section>
      ) : null}

      {tab === "payable" ? (
        <section className="space-y-3">
          <div className="flex gap-2">
            {(["tous", "auto", "retrait"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFiltrePayable(f)} className="h-9 px-3 rounded-full text-[12px] font-semibold" style={{ background: filtrePayable === f ? "var(--sa-primary-glow)" : "var(--sa-surface)", color: filtrePayable === f ? "var(--sa-primary)" : "var(--sa-text-2)", border: "1px solid var(--sa-border)" }}>
                {f === "tous" ? "Tous" : f === "auto" ? "Mode Auto" : "Mode Retrait"}
              </button>
            ))}
          </div>
          <div className="rounded-xl overflow-hidden" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
            <div className="overflow-x-auto">
              <table className="sa-table">
                <thead>
                  <tr>
                    <th>Terrain</th>
                    <th>Mode</th>
                    <th>Net gérant</th>
                    <th>Frais gérant</th>
                    <th>Statut</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payableFiltre.map((r) => (
                    <tr key={r.id}>
                      <td className="font-semibold">{r.terrain_nom}<p className="text-[11px]" style={{ color: "var(--sa-muted)" }}>{r.gerant_nom || "—"}</p></td>
                      <td><ModeBadge mode={r.payout_mode} /></td>
                      <td className="font-semibold" style={{ color: "var(--sa-success)" }}>{fcfa(r.du_gerant)}</td>
                      <td>{fcfa(r.frais_gerant)}</td>
                      <td><StatutDu statut={r.statut} /></td>
                      <td>
                        {r.payout_mode === "auto" && r.statut !== "demande_retrait" ? (
                          <button
                            type="button"
                            disabled={verserBusyId === r.id}
                            className="text-[12px] font-semibold disabled:opacity-50"
                            style={{ color: "var(--sa-primary)" }}
                            onClick={() => setVerserModal(r)}
                          >
                            {verserBusyId === r.id ? "Envoi…" : "Relancer / verser"}
                          </button>
                        ) : r.statut === "demande_retrait" ? (
                          <span className="text-[12px]" style={{ color: "var(--sa-muted)" }}>Onglet retraits</span>
                        ) : r.statut === "echec" && r.last_error ? (
                          <span className="text-[11px]" style={{ color: "var(--sa-danger)" }}>{r.last_error}</span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {payableFiltre.length === 0 ? <p className="px-4 py-6 text-[13px]" style={{ color: "var(--sa-muted)" }}>Aucun dû payable.</p> : null}
          </div>
        </section>
      ) : null}

      {tab === "retraits" ? (
        <section className="space-y-3">
          {urgentes > 0 ? (
            <AlerteBandeau type="danger" message={`${urgentes} demande(s) en attente depuis plus d'1 heure`} />
          ) : null}
          {attente.length === 0 ? (
            <div className="rounded-xl p-6 text-[13px]" style={{ background: "var(--sa-surface)", color: "var(--sa-muted)", boxShadow: "var(--sa-shadow)" }}>
              Aucune demande de retrait en attente. Le gérant déclenche le bouton Retirer depuis son espace (mode retrait).
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
              <table className="sa-table">
                <thead>
                  <tr>
                    <th>Terrain</th>
                    <th>Gérant</th>
                    <th>Montant</th>
                    <th>Wave</th>
                    <th>Orange Money</th>
                    <th>Demandé</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {attente.map((d) => {
                    const rel = relativeDepuis(d.created_at || d.demande_at);
                    const wa = String(d.gerant_whatsapp || d.whatsapp_number || "").replace(/\D/g, "");
                    const dette = Number(d.montant_dette_compensee || 0);
                    const brut = Number(d.montant_brut != null ? d.montant_brut : d.montant || 0);
                    return (
                      <tr key={d.id}>
                        <td className="font-semibold">{d.terrain_nom}</td>
                        <td>
                          <p>{d.gerant_nom}</p>
                          {wa ? (
                            <a href={`https://wa.me/${wa.startsWith("221") ? wa : "221" + wa}`} target="_blank" rel="noreferrer" className="text-[11px] font-semibold" style={{ color: "var(--sa-success)" }}>
                              WhatsApp
                            </a>
                          ) : null}
                        </td>
                        <td>
                          <p className="font-bold" style={{ color: "var(--sa-success)" }}>{fcfa(d.montant || d.montant_net)}</p>
                          {dette > 0 ? (
                            <p className="text-[10px]" style={{ color: "var(--sa-warning)" }}>
                              Brut {fcfa(brut)} − dette {fcfa(dette)}
                            </p>
                          ) : (
                            <p className="text-[10px]" style={{ color: "var(--sa-muted)" }}>Net après dette</p>
                          )}
                        </td>
                        <td><NumeroCopier numero={d.wave_numero} /></td>
                        <td><NumeroCopier numero={d.om_numero} /></td>
                        <td style={{ color: rel.urgence === "danger" ? "var(--sa-danger)" : rel.urgence === "warn" ? "var(--sa-warning)" : "var(--sa-muted)" }}>
                          {rel.label}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => { setModeManuel(false); setRefInput(""); setRefModal(d); }}
                              className="h-8 px-2 rounded-md text-[11px] font-semibold text-white"
                              style={{ background: "var(--sa-success)" }}
                            >
                              Verser (API)
                            </button>
                            <button
                              type="button"
                              onClick={() => { setModeManuel(true); setRefInput(""); setRefModal(d); }}
                              className="h-8 px-2 rounded-md text-[11px] font-semibold"
                              style={{ color: "var(--sa-text-2)", border: "1px solid var(--sa-border)" }}
                            >
                              Manuel
                            </button>
                            <button type="button" onClick={() => setRejectModal(d)} className="h-8 px-2 rounded-md text-[11px] font-semibold" style={{ color: "var(--sa-danger)", border: "1px solid var(--sa-danger)" }}>Rejeter</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded-xl" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
            <button type="button" onClick={() => setHistOpen(!histOpen)} className="w-full flex items-center justify-between px-4 py-3 text-left">
              <span className="text-[14px] font-semibold">Historique payouts</span>
              <span className="text-[12px]" style={{ color: "var(--sa-muted)" }}>{histOpen ? "Masquer" : "Afficher"}</span>
            </button>
            {histOpen ? (
              <div className="overflow-x-auto">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Terrain</th>
                      <th>Type</th>
                      <th>Montant net</th>
                      <th>Dette</th>
                      <th>Statut</th>
                      <th>Réf. / motif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(historique.length ? historique : retraitsTraites).map((d) => (
                      <tr key={d.id}>
                        <td>{d.envoye_at || d.traite_at || d.created_at ? new Date(d.envoye_at || d.traite_at || d.created_at).toLocaleString("fr-FR") : "—"}</td>
                        <td>{d.terrain_nom}</td>
                        <td className="text-[12px]">{d.type || "retrait"}</td>
                        <td>{fcfa(d.montant_net || d.montant || d.du_gerant)}</td>
                        <td>{Number(d.montant_dette_compensee) > 0 ? fcfa(d.montant_dette_compensee) : "—"}</td>
                        <td>
                          <StatutDu statut={d.statut || "envoye"} motif={d.statut === "echec" || d.statut === "annule" ? (d.motif_rejet || d.motif_lisible) : null} />
                        </td>
                        <td className="text-[12px]">{d.ref_paytech || d.ref_manuelle || d.motif_rejet || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </section>
      ) : tab === "dettes" ? (
        <DettesCommissionsTab terrains={terrains} />
      ) : null}

      <ConfirmationModal
        ouvert={Boolean(refModal)}
        titre={modeManuel ? "Marquer envoyé (manuel)" : "Confirmer le versement API"}
        texte={
          modeManuel
            ? "Confirmez après le virement manuel hors plateforme. Le solde gérant passera à 0 et la dette commission sera compensée."
            : `Versement dynamique via le prestataire.\nMontant net : ${fcfa(refModal?.montant)}\n${Number(refModal?.montant_dette_compensee) > 0 ? `Dette déduite : ${fcfa(refModal.montant_dette_compensee)}\n` : ""}Cette action est irréversible.`
        }
        labelConfirmer={modeManuel ? "Confirmer manuel" : "Verser maintenant"}
        variante="success"
        confirming={submitting}
        onConfirmer={marquerEnvoye}
        onAnnuler={() => { if (!submitting) { setRefModal(null); setModeManuel(false); } }}
      >
        {modeManuel ? (
          <input value={refInput} onChange={(e) => setRefInput(e.target.value)} placeholder="Référence virement (optionnel)" className="w-full h-11 rounded-lg px-3 text-sm" style={{ border: "1px solid var(--sa-border)" }} />
        ) : (
          <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>
            Anti double-clic actif. En cas d’échec, le motif prestataire s’affichera dans l’historique.
          </p>
        )}
      </ConfirmationModal>
      <ConfirmationModal
        ouvert={Boolean(rejectModal)}
        titre="Motif du rejet"
        texte="Le dû reste disponible. Les payouts en cours liés seront annulés."
        labelConfirmer="Rejeter"
        variante="danger"
        confirming={submitting}
        onConfirmer={rejeter}
        onAnnuler={() => !submitting && setRejectModal(null)}
      >
        <Select2
          value={motif}
          onChange={setMotif}
          options={[
            { value: "Numéro incorrect", label: "Numéro incorrect / IBAN invalide" },
            { value: "Solde insuffisant", label: "Solde insuffisant" },
            { value: "Autre", label: "Autre" },
          ]}
        />
        {motif === "Autre" ? <input value={motifLibre} onChange={(e) => setMotifLibre(e.target.value)} placeholder="Motif" className="mt-2 w-full h-11 rounded-lg px-3 text-sm" style={{ border: "1px solid var(--sa-border)" }} /> : null}
      </ConfirmationModal>
      <ConfirmationModal
        ouvert={Boolean(verserModal)}
        titre="Confirmer le payout auto"
        texte={`Verser ${fcfa(verserModal?.du_gerant)} au gérant via l’API prestataire ?\nLa dette commission ouverte sera déduite automatiquement.`}
        labelConfirmer="Verser"
        variante="primary"
        confirming={verserBusyId != null}
        onConfirmer={confirmerVerserAuto}
        onAnnuler={() => verserBusyId == null && setVerserModal(null)}
      />
    </div>
  );
}
