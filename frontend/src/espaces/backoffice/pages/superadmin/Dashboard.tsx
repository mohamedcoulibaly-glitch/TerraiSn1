import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BarChart2,
  Clock,
  DollarSign,
  FlaskConical,
  Inbox,
  MapPin,
  MessageCircle,
  Percent,
  RefreshCw,
  ShoppingCart,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";
import SaKpi from "@/espaces/backoffice/components/superadmin/ui/SaKpi";
import SaCard, { SaCardBody, SaCardFooter, SaCardHeader } from "@/espaces/backoffice/components/superadmin/ui/SaCard";
import ModeRevenuBadge from "@/espaces/backoffice/components/superadmin/ui/ModeRevenuBadge";
import { resolveModeRevenu } from "@/lib/modeRevenu";
import { useWhatsappInfra } from "@/hooks/useWhatsappInfra";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs, useSaHeader } from "@/espaces/backoffice/layout/SuperadminLayout";
import ContratBadge from "@/espaces/backoffice/components/superadmin/ContratBadge";
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
  type DemandeRetrait,
} from "@/lib/saContrat";

export default function Dashboard() {
  const { setAlertCount } = useSaHeader();
  const { user } = useAuth();
  const { down: waDown } = useWhatsappInfra(true);
  useSaCrumbs([{ label: "Tableau de bord" }]);
  const [showAllAlerts, setShowAllAlerts] = useState(false);

  const [finances, setFinances] = useState<any>();
  const [terrains, setTerrains] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [demandes, setDemandes] = useState<DemandeRetrait[]>([]);
  const [incidents, setIncidents] = useState(getIncidentsAuto());
  const [essaiKpis, setEssaiKpis] = useState<{ actifs?: number; proches?: number; expires?: number } | null>(null);
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
      setTerrains(Array.isArray(t) ? t : []);
      setUsers(Array.isArray(u) ? u : []);
    }).catch(console.error);
    superAdminApi.essaiKpis().then(setEssaiKpis).catch(() => {});
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
    Number(essaiKpis?.expires) ? { msg: `${essaiKpis?.expires} essai(s) expiré(s)`, to: "/backoffice/superadmin/terrains", label: "Traiter" } : null,
    Number(essaiKpis?.proches) ? { msg: `${essaiKpis?.proches} terrain(s) dont l'essai expire bientôt`, to: "/backoffice/superadmin/terrains", label: "Voir" } : null,
  ].filter(Boolean) as { msg: string; to: string; label: string }[];

  useEffect(() => {
    setAlertCount(alertes.length);
  }, [alertes.length, setAlertCount]);

  const encaisse = Number(finances?.total_avances || 0);
  const commission = Number(finances?.total_commissions || 0);
  const reverse = Number(finances?.total_reverse || 0);
  const duTotal = Math.max(0, encaisse - commission - reverse);
  const modeCounts = {
    essai: rows.filter((r) => resolveModeRevenu(r.t) === "essai").length,
    commission: rows.filter((r) => resolveModeRevenu(r.t) === "commission").length,
    abonnement: rows.filter((r) => resolveModeRevenu(r.t) === "abonnement").length,
    achat: rows.filter((r) => resolveModeRevenu(r.t) === "achat").length,
  };
  const visibleAlertes = showAllAlerts ? alertes : alertes.slice(0, 3);

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
    <div className="space-y-6">
      <SaPageHeader
        titre="Vue d'ensemble"
        sousTitre={`${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} · Bonjour ${user?.prenom || "Admin"}`}
        actions={<Link to="/backoffice/superadmin/terrains" className="sa-btn sa-btn-primary">+ Ajouter un terrain</Link>}
      />
      {alertes.length > 0 ? (
        <section className="rounded-[var(--sa-radius-md)] px-3.5 py-2.5 space-y-1.5" style={{ background: "var(--sa-warning-subtle)", borderLeft: "3px solid var(--sa-warning)" }}>
          {visibleAlertes.map((a) => (
            <div key={a.msg} className="flex items-start sm:items-center gap-2 text-[13px]">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: "var(--sa-warning)" }} />
              <span className="flex-1" style={{ color: "var(--sa-text)" }}>{a.msg}</span>
              <Link to={a.to} className="text-[12px] font-semibold shrink-0" style={{ color: "var(--sa-warning-text)" }}>
                Traiter →
              </Link>
            </div>
          ))}
          {alertes.length > 3 ? (
            <button type="button" className="text-[12px] font-semibold" style={{ color: "var(--sa-warning-text)" }} onClick={() => setShowAllAlerts((v) => !v)}>
              {showAllAlerts ? "Réduire" : "Tout voir"}
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <SaKpi icon={DollarSign} iconColor="var(--sa-success-text)" iconBg="var(--sa-success-subtle)" value={fcfa(encaisse)} label="Encaissé ce mois" />
        <SaKpi icon={Percent} iconColor="var(--sa-primary-text)" iconBg="var(--sa-primary-subtle)" value={fcfa(commission)} label="Commission acquise" />
        <SaKpi icon={MapPin} iconColor="var(--sa-info-text)" iconBg="var(--sa-info-subtle)" value={String(terrains.filter((t) => t.is_active).length)} label="Terrains actifs" />
        <SaKpi icon={Clock} iconColor="var(--sa-warning-text)" iconBg="var(--sa-warning-subtle)" value={fcfa(duTotal)} label="Dû payable" />
        <SaKpi icon={Inbox} iconColor="var(--sa-danger-text)" iconBg="var(--sa-danger-subtle)" value={String(demandes.length)} label="Retraits en attente" />
        <SaKpi icon={FlaskConical} iconColor="var(--sa-mode-essai-text)" iconBg="var(--sa-mode-essai-bg)" value={String(essaiKpis?.actifs || 0)} label="Terrains en essai" />
      </section>

      <div className="grid grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] gap-5 items-start">
        <div className="min-w-0 space-y-4">
          <SaCard>
            <SaCardHeader>
              <p className="text-[14px] font-semibold" style={{ color: "var(--sa-text)" }}>Terrains</p>
              <Link to="/backoffice/superadmin/terrains" className="sa-btn sa-btn-ghost sa-btn-sm">Gérer →</Link>
            </SaCardHeader>
            <div className="overflow-x-auto">
              <table className="sa-table">
                <thead>
                  <tr>
                    <th>Terrain</th>
                    <th>Mode</th>
                    <th>Wave/OM</th>
                    <th>Dû</th>
                    <th>Statut</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 8).map(({ t, c, du }) => (
                    <tr key={t.id}>
                      <td>
                        <div className="sa-cell-stack">
                          <Link to={`/backoffice/superadmin/terrains/${t.id}`} className="sa-cell-title">{t.nom}</Link>
                          <p className="sa-cell-sub">{t.ville || t.quartier || "—"}</p>
                        </div>
                      </td>
                      <td><ModeRevenuBadge mode={resolveModeRevenu(t)} /></td>
                      <td>
                        <div className="sa-canal-row">
                          <ContratBadge statut={c.wave_statut} operateur="wave" />
                          <ContratBadge statut={c.om_statut} operateur="om" />
                        </div>
                      </td>
                      <td>{fcfa(du)}</td>
                      <td>{t.is_active ? "Actif" : "Suspendu"}</td>
                      <td><Link to={`/backoffice/superadmin/terrains/${t.id}`} className="text-[12px]" style={{ color: "var(--sa-primary)" }}>→</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SaCardFooter>
              <Link to="/backoffice/superadmin/terrains" className="text-[12px] font-semibold" style={{ color: "var(--sa-primary)" }}>Voir tous les terrains →</Link>
            </SaCardFooter>
          </SaCard>

          {demandes.length > 0 ? (
            <SaCard>
              <SaCardHeader>
                <p className="text-[14px] font-semibold inline-flex items-center gap-2" style={{ color: "var(--sa-text)" }}>
                  Retraits à traiter
                  <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold text-white grid place-items-center" style={{ background: "var(--sa-danger)" }}>{demandes.length}</span>
                </p>
                <Link to="/backoffice/superadmin/caisse" className="sa-btn sa-btn-ghost sa-btn-sm">Voir la caisse →</Link>
              </SaCardHeader>
              <div className="overflow-x-auto">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>Gérant</th>
                      <th>Montant</th>
                      <th>Depuis</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {demandes.map((d) => {
                      const rel = relativeDepuis(d.demande_at);
                      return (
                        <tr key={d.id}>
                          <td>
                            <p className="font-semibold">{d.gerant_nom}</p>
                            <p className="text-[11px]" style={{ color: "var(--sa-text-muted)" }}>{d.terrain_nom}</p>
                          </td>
                          <td className="font-bold" style={{ color: "var(--sa-success)" }}>{fcfa(d.montant_net)}</td>
                          <td style={{ color: rel.urgence === "danger" ? "var(--sa-danger)" : "var(--sa-warning)" }}>{rel.label}</td>
                          <td>
                            <div className="inline-flex flex-wrap items-center gap-2">
                            <button type="button" onClick={() => setRefModal(d)} className="sa-btn sa-btn-sm sa-btn-primary">Marquer envoyé</button>
                            <button type="button" onClick={() => setRejectModal(d)} className="sa-btn sa-btn-sm sa-btn-danger">Rejeter</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SaCard>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          <SaCard>
            <SaCardHeader>
              <p className="text-[14px] font-semibold" style={{ color: "var(--sa-text)" }}>Modes actifs</p>
              <Link to="/backoffice/superadmin/abonnements" className="sa-btn sa-btn-ghost sa-btn-sm">Gérer →</Link>
            </SaCardHeader>
            <SaCardBody className="space-y-3">
              {[
                { Icon: FlaskConical, label: "Essai gratuit", n: modeCounts.essai, color: "var(--sa-mode-essai)" },
                { Icon: BarChart2, label: "Commission", n: modeCounts.commission, color: "var(--sa-mode-commission)" },
                { Icon: RefreshCw, label: "Abonnement mensuel", n: modeCounts.abonnement, color: "var(--sa-mode-abonnement)" },
                { Icon: ShoppingCart, label: "Achat définitif", n: modeCounts.achat, color: "var(--sa-mode-achat)" },
              ].map((m) => (
                <div key={m.label} className="flex items-center gap-3 min-w-0">
                  <m.Icon size={16} className="shrink-0" style={{ color: m.color }} />
                  <span className="flex-1 min-w-0 text-[13px]" style={{ color: "var(--sa-text-2)" }}>{m.label}</span>
                  <span className="text-[13px] font-semibold shrink-0">{m.n}</span>
                </div>
              ))}
            </SaCardBody>
            <SaCardFooter>
              <Link to="/backoffice/superadmin/abonnements" className="text-[12px] font-semibold" style={{ color: "var(--sa-primary)" }}>Aller aux abonnements →</Link>
            </SaCardFooter>
          </SaCard>

          <SaCard>
            <SaCardHeader>
              <p className="text-[14px] font-semibold" style={{ color: "var(--sa-text)" }}>Santé WhatsApp</p>
            </SaCardHeader>
            <SaCardBody>
              <p className="inline-flex items-center gap-2 text-[13px]">
                <span className="w-2 h-2 rounded-full" style={{ background: waDown ? "var(--sa-danger)" : "var(--sa-success)" }} />
                {waDown ? "Déconnecté" : "Connecté"}
              </p>
              <div className="mt-3">
                <Link to="/backoffice/superadmin/whatsapp" className="sa-btn sa-btn-secondary sa-btn-sm">
                  <MessageCircle size={14} />
                  {waDown ? "Reconnecter" : "Tester"}
                </Link>
              </div>
            </SaCardBody>
          </SaCard>

          <SaCard>
            <SaCardHeader>
              <p className="text-[14px] font-semibold" style={{ color: "var(--sa-text)" }}>Activité récente</p>
            </SaCardHeader>
            <SaCardBody className="space-y-3">
              {[
                ...demandes.slice(0, 4).map((d) => ({ id: `d-${d.id}`, text: `Retrait ${d.gerant_nom} · ${fcfa(d.montant_net)}`, time: relativeDepuis(d.demande_at).label })),
                ...autoEchecs.slice(0, 2).map((i) => ({ id: `i-${i.terrain_id}`, text: `Payout auto en échec · ${i.terrain_nom}`, time: "à traiter" })),
                ...sansNumero.slice(0, 2).map((r) => ({ id: `s-${r.t.id}`, text: `${r.t.nom} sans Wave/OM`, time: "contrat" })),
              ].slice(0, 8).map((a) => (
                <div key={a.id} className="flex items-start gap-2">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--sa-primary)" }} />
                  <div>
                    <p className="text-[13px]" style={{ color: "var(--sa-text-2)" }}>{a.text}</p>
                    <p className="text-[11px]" style={{ color: "var(--sa-text-muted)" }}>{a.time}</p>
                  </div>
                </div>
              ))}
              {demandes.length + autoEchecs.length + sansNumero.length === 0 ? (
                <p className="text-[13px]" style={{ color: "var(--sa-text-muted)" }}>Aucune activité récente.</p>
              ) : null}
            </SaCardBody>
          </SaCard>
        </div>
      </div>


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
