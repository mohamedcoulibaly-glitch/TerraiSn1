import { useEffect, useMemo, useState } from "react";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import AlerteBandeau from "@/espaces/backoffice/components/superadmin/AlerteBandeau";
import ContratBadge from "@/espaces/backoffice/components/superadmin/ContratBadge";
import ModeBadge from "@/espaces/backoffice/components/superadmin/ModeBadge";
import NumeroCopier from "@/espaces/backoffice/components/superadmin/NumeroCopier";
import StatutDu from "@/espaces/backoffice/components/superadmin/StatutDu";
import ConfirmationModal from "@/espaces/backoffice/components/superadmin/ConfirmationModal";
import Select2 from "@/components/Select2";
import {
  fcfa,
  gerantDuTerrain,
  getContratOverlay,
  getDemandesRetrait,
  relativeDepuis,
  upsertDemandeRetrait,
  upsertIncidentAuto,
  type DemandeRetrait,
} from "@/lib/saContrat";

type TabId = "fenetre" | "payable" | "retraits";

export default function Caisse() {
  useSaCrumbs([{ label: "Caisse & Reversements" }]);
  const [tab, setTab] = useState<TabId>("retraits");
  const [filtrePayable, setFiltrePayable] = useState<"tous" | "auto" | "retrait">("tous");
  const [terrains, setTerrains] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [finances, setFinances] = useState<any>();
  const [demandes, setDemandes] = useState<DemandeRetrait[]>([]);
  const [refModal, setRefModal] = useState<DemandeRetrait | null>(null);
  const [rejectModal, setRejectModal] = useState<DemandeRetrait | null>(null);
  const [refInput, setRefInput] = useState("");
  const [motif, setMotif] = useState("Numéro incorrect");
  const [motifLibre, setMotifLibre] = useState("");
  const [histOpen, setHistOpen] = useState(false);

  const reload = () => setDemandes(getDemandesRetrait());

  useEffect(() => {
    Promise.all([superAdminApi.terrains(), superAdminApi.users(), superAdminApi.finances()]).then(([t, u, f]) => {
      setTerrains(t);
      setUsers(u);
      setFinances(f);
    }).catch(console.error);
    reload();
  }, []);

  const ledger = useMemo(() => {
    return terrains.map((t) => {
      const c = getContratOverlay(t.id);
      const gerant = gerantDuTerrain(users, t.id);
      const fin = (finances?.terrains || []).find((x: any) => Number(x.id) === Number(t.id)) || {};
      const avances = Number(fin.avances || 0);
      const commissions = Number(fin.commissions || 0);
      const reverse = Number(fin.reverse || 0);
      const base = Math.max(0, avances - commissions);
      const du = Math.max(0, base - reverse);
      const enFenetre = du > 0 && (c.remboursement_autorise || Number(t.delai_remboursement_heures || 0) > 0);
      return { t, c, gerant, avances, commissions, base, reverse, du, enFenetre };
    });
  }, [terrains, users, finances]);

  const fenetre = ledger.filter((r) => r.enFenetre);
  const payable = ledger.filter((r) => r.du > 0 && !r.enFenetre).filter((r) => filtrePayable === "tous" || r.c.payout_mode === filtrePayable);
  const attente = demandes.filter((d) => d.statut === "en_attente");
  const historique = demandes.filter((d) => d.statut !== "en_attente").slice(0, 20);
  const urgentes = attente.filter((d) => Date.now() - new Date(d.demande_at).getTime() > 3600000).length;

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "fenetre", label: "En fenêtre de remboursement", count: fenetre.length },
    { id: "payable", label: "Payable", count: payable.length },
    { id: "retraits", label: "Demandes de retrait", count: attente.length },
  ];

  function marquerEnvoye() {
    if (!refModal) return;
    upsertDemandeRetrait({ ...refModal, statut: "envoye", ref_manuelle: refInput, traite_par: "Super Admin", traite_at: new Date().toISOString() });
    setRefModal(null);
    setRefInput("");
    reload();
  }

  function rejeter() {
    if (!rejectModal) return;
    upsertDemandeRetrait({ ...rejectModal, statut: "rejete", motif_rejet: motif === "Autre" ? motifLibre : motif, traite_par: "Super Admin", traite_at: new Date().toISOString() });
    setRejectModal(null);
    reload();
  }

  return (
    <div className="space-y-5 max-w-[1200px]">
      <div>
        <h2 className="text-[22px] font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--sa-text)" }}>Caisse & Reversements</h2>
        <p className="text-[13px] mt-1" style={{ color: "var(--sa-muted)" }}>Suivi des avances, commissions et reversements gérants</p>
      </div>

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
          <div className="hidden md:block overflow-x-auto">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Terrain</th>
                  <th>Gérant</th>
                  <th>Avance</th>
                  <th>Commission</th>
                  <th>Base gérant</th>
                  <th>Expire dans</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {fenetre.map((r) => (
                  <tr key={r.t.id}>
                    <td className="font-semibold">{r.t.nom}</td>
                    <td>{r.gerant?.nom || "—"}</td>
                    <td>{fcfa(r.avances)}</td>
                    <td>{fcfa(r.commissions)}</td>
                    <td>{fcfa(r.base)}</td>
                    <td style={{ color: "var(--sa-warning)" }}>{Number(r.t.delai_remboursement_heures || 0)} h</td>
                    <td><StatutDu statut="en_fenetre" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden p-3 space-y-2">
            {fenetre.map((r) => (
              <article key={r.t.id} className="rounded-lg p-3" style={{ border: "1px solid var(--sa-border)" }}>
                <p className="font-semibold text-[13px]">{r.t.nom}</p>
                <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>{r.gerant?.nom} · {fcfa(r.base)}</p>
              </article>
            ))}
          </div>
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
            <div className="hidden md:block overflow-x-auto">
              <table className="sa-table">
                <thead>
                  <tr>
                    <th>Terrain</th>
                    <th>Gérant</th>
                    <th>Base gérant</th>
                    <th>Frais gérant</th>
                    <th>Net gérant</th>
                    <th>Canal</th>
                    <th>Statut</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payable.map((r) => {
                    const demande = attente.find((d) => d.terrain_id === r.t.id);
                    return (
                      <tr key={r.t.id}>
                        <td className="font-semibold">{r.t.nom}</td>
                        <td>{r.gerant?.nom || "—"}</td>
                        <td>{fcfa(r.base)}</td>
                        <td>{r.c.payout_mode === "auto" ? "selon contrat" : "0"}</td>
                        <td className="font-semibold" style={{ color: "var(--sa-success)" }}>{fcfa(r.du)}</td>
                        <td className="uppercase text-[11px]">{r.c.canal_reversement}</td>
                        <td>
                          {r.c.payout_mode === "auto" ? (
                            r.reverse > 0 ? <StatutDu statut="verse" /> : <span className="text-[12px]">En attente envoi auto</span>
                          ) : demande ? (
                            <span className="text-[12px]">Demande reçue</span>
                          ) : (
                            <span className="text-[12px]" style={{ color: "var(--sa-muted)" }}>Pas de demande</span>
                          )}
                        </td>
                        <td>
                          {r.c.payout_mode === "auto" && r.reverse <= 0 ? (
                            <button
                              type="button"
                              className="text-[12px] font-semibold"
                              style={{ color: "var(--sa-primary)" }}
                              onClick={() => {
                                upsertIncidentAuto({ terrain_id: r.t.id, terrain_nom: r.t.nom, statut: "en_attente", dernier_at: new Date().toISOString(), message: "Déclenchement demandé" });
                              }}
                            >
                              Déclencher
                            </button>
                          ) : r.c.payout_mode === "retrait" && demande ? (
                            <span className="text-[12px]" style={{ color: "var(--sa-muted)" }}>Onglet retraits</span>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="md:hidden p-3 space-y-2">
              {payable.map((r) => (
                <article key={r.t.id} className="rounded-lg p-3" style={{ border: "1px solid var(--sa-border)" }}>
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-[13px]">{r.t.nom}</p>
                    <ModeBadge mode={r.c.payout_mode} />
                  </div>
                  <p className="mt-1 font-bold" style={{ color: "var(--sa-success)" }}>{fcfa(r.du)}</p>
                </article>
              ))}
            </div>
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
            <>
              <div className="hidden md:block rounded-xl overflow-hidden" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>Terrain</th>
                      <th>Gérant</th>
                      <th>Montant net</th>
                      <th>Wave</th>
                      <th>Orange Money</th>
                      <th>Demandé</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attente.map((d) => {
                      const rel = relativeDepuis(d.demande_at);
                      const wa = String(d.gerant_whatsapp || "").replace(/\D/g, "");
                      return (
                        <tr key={d.id}>
                          <td>
                            <p className="font-semibold text-[13px]">{d.terrain_nom}</p>
                            <p className="text-[11px]" style={{ color: "var(--sa-muted)" }}>{d.terrain_ville}</p>
                          </td>
                          <td>
                            <p>{d.gerant_nom}</p>
                            {wa ? (
                              <a href={`https://wa.me/${wa.startsWith("221") ? wa : "221" + wa}`} target="_blank" rel="noreferrer" className="text-[11px] font-semibold" style={{ color: "var(--sa-success)" }}>
                                WhatsApp
                              </a>
                            ) : null}
                          </td>
                          <td>
                            <p className="font-bold" style={{ color: "var(--sa-success)" }}>{fcfa(d.montant_net)}</p>
                            <p className="text-[10px]" style={{ color: "var(--sa-muted)" }}>0 frais déduits</p>
                          </td>
                          <td>
                            <NumeroCopier numero={d.wave_numero} />
                            <div className="mt-1"><ContratBadge statut={d.wave_statut} operateur="wave" /></div>
                          </td>
                          <td>
                            <NumeroCopier numero={d.om_numero} />
                            <div className="mt-1"><ContratBadge statut={d.om_statut} operateur="om" /></div>
                          </td>
                          <td style={{ color: rel.urgence === "danger" ? "var(--sa-danger)" : rel.urgence === "warn" ? "var(--sa-warning)" : "var(--sa-muted)" }}>
                            {rel.label}
                          </td>
                          <td>
                            <div className="flex gap-2">
                              <button type="button" onClick={() => setRefModal(d)} className="h-8 px-2 rounded-md text-[11px] font-semibold text-white" style={{ background: "var(--sa-success)" }}>Marquer envoyé</button>
                              <button type="button" onClick={() => setRejectModal(d)} className="h-8 px-2 rounded-md text-[11px] font-semibold" style={{ color: "var(--sa-danger)", border: "1px solid var(--sa-danger)" }}>Rejeter</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden space-y-3">
                {attente.map((d) => {
                  const rel = relativeDepuis(d.demande_at);
                  return (
                    <article key={d.id} className="rounded-xl p-4" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
                      <p className="font-semibold">{d.terrain_nom}</p>
                      <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>{d.gerant_nom}</p>
                      <p className="mt-2 text-[20px] font-bold text-center" style={{ color: "var(--sa-success)", fontFamily: "var(--font-display)" }}>{fcfa(d.montant_net)}</p>
                      <div className="mt-2 flex justify-between"><NumeroCopier numero={d.wave_numero} /><NumeroCopier numero={d.om_numero} /></div>
                      <p className="mt-1 text-[11px]" style={{ color: rel.urgence === "danger" ? "var(--sa-danger)" : "var(--sa-warning)" }}>{rel.label}</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setRefModal(d)} className="h-11 rounded-lg text-[12px] font-semibold text-white" style={{ background: "var(--sa-success)" }}>Marquer envoyé</button>
                        <button type="button" onClick={() => setRejectModal(d)} className="h-11 rounded-lg text-[12px] font-semibold" style={{ color: "var(--sa-danger)", border: "1px solid var(--sa-danger)" }}>Rejeter</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}

          <div className="rounded-xl" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
            <button type="button" onClick={() => setHistOpen(!histOpen)} className="w-full flex items-center justify-between px-4 py-3 text-left">
              <span className="text-[14px] font-semibold">Historique — 20 derniers retraits traités</span>
              <span className="text-[12px]" style={{ color: "var(--sa-muted)" }}>{histOpen ? "Masquer" : "Afficher"}</span>
            </button>
            {histOpen ? (
              <div className="overflow-x-auto">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Terrain</th>
                      <th>Gérant</th>
                      <th>Montant</th>
                      <th>Référence</th>
                      <th>Traité par</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historique.map((d) => (
                      <tr key={d.id}>
                        <td>{d.traite_at ? new Date(d.traite_at).toLocaleString("fr-FR") : "—"}</td>
                        <td>{d.terrain_nom}</td>
                        <td>{d.gerant_nom}</td>
                        <td>{fcfa(d.montant_net)}</td>
                        <td>{d.ref_manuelle || d.motif_rejet || "—"}</td>
                        <td>{d.traite_par || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <ConfirmationModal ouvert={Boolean(refModal)} titre="Saisir la référence du virement" texte="Confirmez après le virement manuel. Le solde gérant passera à 0." labelConfirmer="Confirmer" variante="success" onConfirmer={marquerEnvoye} onAnnuler={() => setRefModal(null)}>
        <input value={refInput} onChange={(e) => setRefInput(e.target.value)} placeholder="Référence (optionnel)" className="w-full h-11 rounded-lg px-3 text-sm" style={{ border: "1px solid var(--sa-border)" }} />
      </ConfirmationModal>
      <ConfirmationModal ouvert={Boolean(rejectModal)} titre="Motif du rejet" texte="Le dû reste. Notification WhatsApp gérant prévue côté moteur." labelConfirmer="Rejeter" variante="danger" onConfirmer={rejeter} onAnnuler={() => setRejectModal(null)}>
        <Select2
          value={motif}
          onChange={setMotif}
          options={[
            { value: "Numéro incorrect", label: "Numéro incorrect" },
            { value: "Montant insuffisant", label: "Montant insuffisant" },
            { value: "Autre", label: "Autre" },
          ]}
        />
        {motif === "Autre" ? <input value={motifLibre} onChange={(e) => setMotifLibre(e.target.value)} placeholder="Motif" className="mt-2 w-full h-11 rounded-lg px-3 text-sm" style={{ border: "1px solid var(--sa-border)" }} /> : null}
      </ConfirmationModal>
    </div>
  );
}
