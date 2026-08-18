import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Clock,
  Inbox,
  Percent,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs, useSaHeader } from "@/espaces/backoffice/layout/SuperadminLayout";
import ContratBadge from "@/espaces/backoffice/components/superadmin/ContratBadge";
import NumeroCopier from "@/espaces/backoffice/components/superadmin/NumeroCopier";
import ConfirmationModal from "@/espaces/backoffice/components/superadmin/ConfirmationModal";
import Select2 from "@/components/Select2";
import {
  fcfa,
  gerantDuTerrain,
  getContratOverlay,
  getDemandesRetrait,
  getIncidentsAuto,
  relativeDepuis,
  upsertDemandeRetrait,
  upsertIncidentAuto,
  type DemandeRetrait,
} from "@/lib/saContrat";

function KpiCard({
  icon: Icon,
  iconColor,
  iconBg,
  value,
  valueColor,
  label,
  sub,
  badge,
}: {
  icon: typeof TrendingUp;
  iconColor: string;
  iconBg: string;
  value: string;
  valueColor?: string;
  label: string;
  sub?: string;
  badge?: boolean;
}) {
  return (
    <article className="rounded-xl p-4" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
      <div className="flex items-start justify-between">
        <span className="w-9 h-9 rounded-lg grid place-items-center" style={{ background: iconBg, color: iconColor }}>
          <Icon size={16} />
        </span>
        {badge ? (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white grid place-items-center" style={{ background: "var(--sa-danger)" }}>
            !
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-[20px] font-semibold leading-none" style={{ color: valueColor || "var(--sa-text)", fontFamily: "var(--font-display)" }}>
        {value}
      </p>
      <p className="mt-1 text-[11px]" style={{ color: "var(--sa-muted)" }}>{label}</p>
      {sub ? <p className="mt-1 text-[10px]" style={{ color: "var(--sa-warning)" }}>{sub}</p> : null}
    </article>
  );
}

export default function Dashboard() {
  const { setAlertCount } = useSaHeader();
  useSaCrumbs([{ label: "Tableau de bord" }]);

  const [finances, setFinances] = useState<any>();
  const [terrains, setTerrains] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [demandes, setDemandes] = useState<DemandeRetrait[]>([]);
  const [incidents, setIncidents] = useState(getIncidentsAuto());
  const [refModal, setRefModal] = useState<DemandeRetrait | null>(null);
  const [rejectModal, setRejectModal] = useState<DemandeRetrait | null>(null);
  const [refInput, setRefInput] = useState("");
  const [motif, setMotif] = useState("Numéro incorrect");
  const [motifLibre, setMotifLibre] = useState("");

  const reloadOps = () => {
    setDemandes(getDemandesRetrait().filter((d) => d.statut === "en_attente"));
    setIncidents(getIncidentsAuto());
  };

  useEffect(() => {
    superAdminApi.finances().then(setFinances).catch(console.error);
    Promise.all([superAdminApi.terrains(), superAdminApi.users()]).then(([t, u]) => {
      setTerrains(t);
      setUsers(u);
    }).catch(console.error);
    reloadOps();
  }, []);

  const rows = useMemo(() => {
    return terrains.map((t) => {
      const c = getContratOverlay(t.id);
      const gerant = gerantDuTerrain(users, t.id);
      const fin = (finances?.terrains || []).find((f: any) => Number(f.id) === Number(t.id)) || {};
      const avances = Number(fin.avances || fin.acomptes || 0);
      const commissions = Number(fin.commissions || 0);
      const reverse = Number(fin.reverse || 0);
      const du = Math.max(0, avances - commissions - reverse);
      return { t, c, gerant, du, avances, commissions };
    });
  }, [terrains, users, finances]);

  const sansNumero = rows.filter((r) => r.c.wave_statut === "absent" && r.c.om_statut === "absent");
  const testsEnAttente = rows.filter((r) => r.c.wave_statut === "test_envoye" || r.c.om_statut === "test_envoye").length;
  const retraitsOld = demandes.filter((d) => Date.now() - new Date(d.demande_at).getTime() > 3600000).length;
  const autoEchecs = incidents.filter((i) => i.statut === "echec");
  const fenetreExpiree = rows.filter((r) => r.du > 0 && !r.c.remboursement_autorise).length;

  const alertes = [
    sansNumero.length ? { msg: `${sansNumero.length} terrain(s) sans numéro Wave/OM configuré`, to: "/backoffice/superadmin/terrains", label: "Configurer" } : null,
    testsEnAttente ? { msg: `${testsEnAttente} test 100 FCFA en attente de vérification`, to: "/backoffice/superadmin/terrains", label: "Vérifier" } : null,
    retraitsOld ? { msg: `${retraitsOld} demande(s) de retrait depuis plus d'1 heure`, to: "/backoffice/superadmin/caisse", label: "Traiter" } : null,
    autoEchecs.length ? { msg: `${autoEchecs.length} payout auto en échec`, to: "/backoffice/superadmin/caisse", label: "Relancer" } : null,
    fenetreExpiree ? { msg: `${fenetreExpiree} terrain(s) — fenêtre de remboursement expirée, dû payable`, to: "/backoffice/superadmin/caisse", label: "Voir" } : null,
  ].filter(Boolean) as { msg: string; to: string; label: string }[];

  useEffect(() => {
    setAlertCount(alertes.length);
  }, [alertes.length, setAlertCount]);

  const encaisse = Number(finances?.total_avances || 0);
  const commission = Number(finances?.total_commissions || 0);
  const reverse = Number(finances?.total_reverse || 0);
  const duTotal = Math.max(0, encaisse - commission - reverse);
  const duAuto = rows.filter((r) => r.c.payout_mode === "auto").reduce((s, r) => s + r.du, 0);
  const duRetrait = rows.filter((r) => r.c.payout_mode === "retrait").reduce((s, r) => s + r.du, 0);
  const bloque = sansNumero.reduce((s, r) => s + r.du, 0);
  const autoActifs = rows.filter((r) => r.c.payout_mode === "auto" && r.c.production_paiement);

  function marquerEnvoye() {
    if (!refModal) return;
    upsertDemandeRetrait({
      ...refModal,
      statut: "envoye",
      ref_manuelle: refInput,
      traite_par: "Super Admin",
      traite_at: new Date().toISOString(),
    });
    setRefModal(null);
    setRefInput("");
    reloadOps();
  }

  function rejeter() {
    if (!rejectModal) return;
    upsertDemandeRetrait({
      ...rejectModal,
      statut: "rejete",
      motif_rejet: motif === "Autre" ? motifLibre : motif,
      traite_par: "Super Admin",
      traite_at: new Date().toISOString(),
    });
    setRejectModal(null);
    reloadOps();
  }

  return (
    <div className="space-y-6 max-w-[1200px]">
      {alertes.length > 0 ? (
        <section className="rounded-xl px-4 py-3.5 space-y-2" style={{ background: "var(--sa-danger-bg)", border: "1px solid var(--sa-danger)" }}>
          {alertes.map((a) => (
            <div key={a.msg} className="flex items-start sm:items-center gap-2 text-[13px]">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: "var(--sa-danger)" }} />
              <span className="flex-1" style={{ color: "var(--sa-text)" }}>{a.msg}</span>
              <Link to={a.to} className="text-[12px] font-semibold shrink-0" style={{ color: "var(--sa-danger)" }}>
                {a.label}
              </Link>
            </div>
          ))}
        </section>
      ) : null}

      <section className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard icon={TrendingUp} iconColor="var(--sa-primary)" iconBg="var(--sa-primary-glow)" value={fcfa(encaisse)} label="Encaissé ce mois" />
        <KpiCard icon={Percent} iconColor="var(--sa-success)" iconBg="var(--sa-success-bg)" value={fcfa(commission)} valueColor="var(--sa-success)" label="Commission ce mois" sub={`En fenêtre de remboursement : ${fcfa(0)}`} />
        <KpiCard icon={Clock} iconColor="var(--sa-warning)" iconBg="var(--sa-warning-bg)" value={fcfa(duTotal)} valueColor="var(--sa-warning)" label="Dû payable (non encore reversé)" sub={`Auto : ${fcfa(duAuto)} · Retrait : ${fcfa(duRetrait)}`} />
        <KpiCard
          icon={AlertTriangle}
          iconColor={bloque > 0 ? "var(--sa-danger)" : "var(--sa-success)"}
          iconBg={bloque > 0 ? "var(--sa-danger-bg)" : "var(--sa-success-bg)"}
          value={fcfa(bloque)}
          valueColor={bloque > 0 ? "var(--sa-danger)" : "var(--sa-success)"}
          label="Bloqué sans numéro Wave/OM"
        />
        <KpiCard icon={Inbox} iconColor="var(--sa-info)" iconBg="var(--sa-info-bg)" value={String(demandes.length)} label="Demandes de retrait en attente" badge={demandes.length > 0} />
        <KpiCard icon={XCircle} iconColor="var(--sa-danger)" iconBg="var(--sa-danger-bg)" value={String(autoEchecs.length)} label="Payouts auto en échec" />
      </section>

      {demandes.length > 0 ? (
        <section className="rounded-xl overflow-hidden" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
          <div className="px-4 py-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-[15px] font-semibold flex items-center gap-2" style={{ color: "var(--sa-text)" }}>
                Demandes de retrait à traiter
                <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold text-white grid place-items-center" style={{ background: "var(--sa-danger)" }}>
                  {demandes.length}
                </span>
              </h3>
              <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>Ces gérants ont cliqué Retirer et attendent</p>
            </div>
            <Link to="/backoffice/superadmin/caisse" className="text-[12px] font-semibold" style={{ color: "var(--sa-primary)" }}>
              Voir toutes les demandes
            </Link>
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Terrain</th>
                  <th>Gérant</th>
                  <th>Montant net</th>
                  <th>Wave</th>
                  <th>OM</th>
                  <th>Depuis</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {demandes.map((d) => {
                  const rel = relativeDepuis(d.demande_at);
                  return (
                    <tr key={d.id}>
                      <td className="font-semibold text-[13px]">{d.terrain_nom}</td>
                      <td className="text-[13px]">{d.gerant_nom}</td>
                      <td className="font-bold" style={{ color: "var(--sa-success)" }}>{fcfa(d.montant_net)}</td>
                      <td><NumeroCopier numero={d.wave_numero} masque /></td>
                      <td><NumeroCopier numero={d.om_numero} masque /></td>
                      <td style={{ color: rel.urgence === "danger" ? "var(--sa-danger)" : rel.urgence === "warn" ? "var(--sa-warning)" : "var(--sa-muted)" }}>{rel.label}</td>
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
          <div className="md:hidden p-3 space-y-3">
            {demandes.map((d) => {
              const rel = relativeDepuis(d.demande_at);
              return (
                <article key={d.id} className="rounded-lg p-3" style={{ border: "1px solid var(--sa-border)" }}>
                  <p className="text-[13px] font-semibold">{d.terrain_nom}</p>
                  <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>{d.gerant_nom}</p>
                  <p className="mt-1 font-bold" style={{ color: "var(--sa-success)" }}>{fcfa(d.montant_net)}</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => setRefModal(d)} className="flex-1 h-10 rounded-md text-[12px] font-semibold text-white" style={{ background: "var(--sa-success)" }}>Marquer envoyé</button>
                    <button type="button" onClick={() => setRejectModal(d)} className="flex-1 h-10 rounded-md text-[12px] font-semibold" style={{ color: "var(--sa-danger)", border: "1px solid var(--sa-danger)" }}>Rejeter</button>
                  </div>
                  <p className="mt-1 text-[11px]" style={{ color: rel.urgence === "danger" ? "var(--sa-danger)" : "var(--sa-warning)" }}>{rel.label}</p>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {autoActifs.length > 0 || autoEchecs.length > 0 ? (
        <section className="rounded-xl overflow-hidden" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
          <div className="px-4 py-3">
            <h3 className="text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>Payouts automatiques</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Terrain</th>
                  <th>Dernier payout</th>
                  <th>Statut</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {(incidents.length ? incidents : autoActifs.map((r) => ({ terrain_id: r.t.id, terrain_nom: r.t.nom, statut: "en_attente" as const }))).map((i) => (
                  <tr key={i.terrain_id}>
                    <td>{i.terrain_nom}</td>
                    <td>{i.dernier_at ? new Date(i.dernier_at).toLocaleString("fr-FR") : "—"}</td>
                    <td>{i.statut === "echec" ? "Échec" : i.statut === "ok" ? "OK" : "En attente"}</td>
                    <td>
                      {i.statut === "echec" ? (
                        <button
                          type="button"
                          className="text-[12px] font-semibold"
                          style={{ color: "var(--sa-danger)" }}
                          onClick={() => {
                            upsertIncidentAuto({ ...i, statut: "en_attente", message: "Relance demandée" });
                            reloadOps();
                          }}
                        >
                          Relancer
                        </button>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {sansNumero.length > 0 ? (
        <section className="rounded-xl overflow-hidden" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
          <div className="px-4 py-3 flex items-center gap-2">
            <h3 className="text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>Terrains à configurer</h3>
            <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold text-white grid place-items-center" style={{ background: "var(--sa-danger)" }}>
              {sansNumero.length}
            </span>
          </div>
          <div className="overflow-x-auto hidden md:block">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Terrain</th>
                  <th>Proprio</th>
                  <th>Gérant</th>
                  <th>Manque</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sansNumero.map(({ t, gerant, c }) => (
                  <tr key={t.id}>
                    <td className="font-semibold">{t.nom}</td>
                    <td>{t.proprietaire_nom || "—"}</td>
                    <td>{gerant?.nom || "—"}</td>
                    <td className="flex gap-1">
                      <ContratBadge statut={c.wave_statut} operateur="wave" />
                      <ContratBadge statut={c.om_statut} operateur="om" />
                    </td>
                    <td>
                      <Link to={`/backoffice/superadmin/terrains/${t.id}?tab=contrat`} className="text-[12px] font-semibold" style={{ color: "var(--sa-primary)" }}>
                        Configurer
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden p-3 space-y-2">
            {sansNumero.map(({ t, gerant }) => (
              <article key={t.id} className="rounded-lg p-3 flex items-center justify-between" style={{ border: "1px solid var(--sa-border)" }}>
                <div>
                  <p className="text-[13px] font-semibold">{t.nom}</p>
                  <p className="text-[11px]" style={{ color: "var(--sa-muted)" }}>{t.proprietaire_nom} · {gerant?.nom || "Sans gérant"}</p>
                </div>
                <Link to={`/backoffice/superadmin/terrains/${t.id}?tab=contrat`} className="text-[12px] font-semibold" style={{ color: "var(--sa-primary)" }}>
                  Configurer
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <ConfirmationModal
        ouvert={Boolean(refModal)}
        titre="Saisir la référence du virement"
        texte="Le solde gérant passera à 0 une fois le virement marqué envoyé."
        labelConfirmer="Confirmer"
        variante="success"
        onConfirmer={marquerEnvoye}
        onAnnuler={() => setRefModal(null)}
      >
        <input
          value={refInput}
          onChange={(e) => setRefInput(e.target.value)}
          placeholder="Référence (optionnel)"
          className="w-full h-11 rounded-lg px-3 text-sm"
          style={{ border: "1px solid var(--sa-border)" }}
        />
      </ConfirmationModal>
      <ConfirmationModal
        ouvert={Boolean(rejectModal)}
        titre="Motif du rejet"
        texte="Le dû reste. Une notification WhatsApp gérant sera prévue côté moteur."
        labelConfirmer="Rejeter"
        variante="danger"
        onConfirmer={rejeter}
        onAnnuler={() => setRejectModal(null)}
      >
        <Select2
          value={motif}
          onChange={setMotif}
          options={[
            { value: "Numéro incorrect", label: "Numéro incorrect" },
            { value: "Montant insuffisant", label: "Montant insuffisant" },
            { value: "Autre", label: "Autre" },
          ]}
        />
        {motif === "Autre" ? (
          <input value={motifLibre} onChange={(e) => setMotifLibre(e.target.value)} placeholder="Motif" className="mt-2 w-full h-11 rounded-lg px-3 text-sm" style={{ border: "1px solid var(--sa-border)" }} />
        ) : null}
      </ConfirmationModal>
    </div>
  );
}
