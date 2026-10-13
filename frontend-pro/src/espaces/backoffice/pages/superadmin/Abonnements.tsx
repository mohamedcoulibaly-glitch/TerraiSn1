import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart2, Download, FlaskConical, RefreshCw, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import { fcfa, gerantDuTerrain } from "@/lib/saContrat";
import { resolveModeRevenu, joursEssaiRestants, type ModeRevenu } from "@/lib/modeRevenu";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";
import SaButton from "@/espaces/backoffice/components/superadmin/ui/SaButton";
import SaCard, { SaCardBody, SaCardHeader } from "@/espaces/backoffice/components/superadmin/ui/SaCard";
import SaEmptyState from "@/espaces/backoffice/components/superadmin/ui/SaEmptyState";
import SaModal from "@/espaces/backoffice/components/superadmin/ui/SaModal";
import ModeRevenuBadge from "@/espaces/backoffice/components/superadmin/ui/ModeRevenuBadge";
import ModeSelector from "@/espaces/backoffice/components/superadmin/ui/ModeSelector";
import SaDropdown from "@/espaces/backoffice/components/superadmin/ui/SaDropdown";
import PreviewContrat from "@/espaces/backoffice/components/superadmin/PreviewContrat";

const TABS = [
  { id: "essai", label: "Essai" },
  { id: "commission", label: "Commission" },
  { id: "abonnement", label: "Abonnement" },
  { id: "achat", label: "Achat définitif" },
] as const;

export default function Abonnements() {
  useSaCrumbs([{ label: "Abonnements", to: "/backoffice/superadmin/abonnements" }]);
  const navigate = useNavigate();
  const [terrains, setTerrains] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [defaults, setDefaults] = useState<Record<string, any>>({});
  const [history, setHistory] = useState<any[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("essai");
  const [filtre, setFiltre] = useState<"tous" | ModeRevenu>("tous");
  const [statutFiltre, setStatutFiltre] = useState<"tous" | "actif" | "expire" | "suspendu">("tous");
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<any | null>(null);
  const [nextMode, setNextMode] = useState<ModeRevenu>("commission");
  const [gotoContrat, setGotoContrat] = useState(true);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const load = () =>
    Promise.all([
      superAdminApi.terrains(),
      superAdminApi.users(),
      superAdminApi.modeRevenuDefaults(),
      superAdminApi.modeRevenuHistory(),
    ]).then(([t, u, d, h]) => {
      setTerrains(Array.isArray(t) ? t : []);
      setUsers(Array.isArray(u) ? u : []);
      setDefaults(d || {});
      setHistory(Array.isArray(h) ? h : []);
    });

  useEffect(() => {
    load().catch(() => toast.error("Impossible de charger les abonnements"));
  }, []);

  const rows = useMemo(() => {
    return terrains.map((t) => {
      const mode = resolveModeRevenu(t);
      const proprio = users.find((u: any) => u.role === "proprietaire" && Number(u.id) === Number(t.proprietaire_id));
      const gerant = gerantDuTerrain(users, t.id);
      return { t, mode, proprio, gerant };
    });
  }, [terrains, users]);

  const counts = useMemo(() => ({
    essai: rows.filter((r) => r.mode === "essai").length,
    commission: rows.filter((r) => r.mode === "commission").length,
    abonnement: rows.filter((r) => r.mode === "abonnement").length,
    achat: rows.filter((r) => r.mode === "achat").length,
  }), [rows]);

  const filtered = rows.filter((r) => {
    if (filtre !== "tous" && r.mode !== filtre) return false;
    if (statutFiltre === "actif" && !r.t.is_active) return false;
    if (statutFiltre === "suspendu" && r.t.is_active) return false;
    if (statutFiltre === "expire" && !(r.mode === "essai" && (joursEssaiRestants(r.t) ?? 1) < 0)) return false;
    const hay = `${r.t.nom} ${r.proprio?.nom || ""} ${r.gerant?.nom || ""}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  function openChange(row: (typeof rows)[number]) {
    setModal(row);
    setNextMode(row.mode);
    setForm({
      essai_duree_jours: defaults.essai_duree_jours || 30,
      delai_negociation_jours: defaults.delai_negociation_jours || 7,
      commission_pourcentage: Number(row.t.commission_pourcentage || defaults.commission_pourcentage || 10),
      abonnement_montant: Number(row.t.abonnement_montant || defaults.abonnement_montant || 0),
      achat_definitif_montant: Number(row.t.achat_definitif_montant || 0),
    });
  }

  async function confirmChange() {
    if (!modal) return;
    setSaving(true);
    try {
      await superAdminApi.patchTerrainModeRevenu(modal.t.id, { mode: nextMode, ...form });
      toast.success("Mode mis à jour ✓");
      setModal(null);
      await load();
      if (gotoContrat) navigate(`/backoffice/superadmin/terrains/${modal.t.id}?tab=contrat`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Changement impossible");
    } finally {
      setSaving(false);
    }
  }

  async function saveDefaults() {
    setSaving(true);
    try {
      const next = await superAdminApi.saveModeRevenuDefaults(defaults);
      setDefaults(next);
      toast.success("Paramètres enregistrés");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const lines = ["Date;Terrain;Ancien;Nouveau;Auteur"];
    history.forEach((h) => {
      lines.push([h.created_at, h.terrain_nom, h.ancien_mode, h.nouveau_mode, h.auteur || ""].join(";"));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "historique-modes.csv";
    a.click();
  }

  const expire7 = rows.filter((r) => r.mode === "essai" && (joursEssaiRestants(r.t) ?? 99) <= 7 && (joursEssaiRestants(r.t) ?? 0) >= 0).length;
  const moyCom = counts.commission
    ? Math.round(rows.filter((r) => r.mode === "commission").reduce((s, r) => s + Number(r.t.commission_pourcentage || 0), 0) / Math.max(1, counts.commission))
    : 0;

  return (
    <div className="space-y-6">
      <SaPageHeader titre="Abonnements & Contrats" sousTitre="Gérez les modes de revenus de chaque terrain" />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { id: "essai" as const, Icon: FlaskConical, titre: "Essai gratuit", n: counts.essai, color: "var(--sa-mode-essai)", bg: "var(--sa-mode-essai-bg)", sub: expire7 ? `${expire7} expirent dans 7 jours` : "" },
          { id: "commission" as const, Icon: BarChart2, titre: "Commission par réservation", n: counts.commission, color: "var(--sa-mode-commission)", bg: "var(--sa-mode-commission-bg)", sub: `Commission moy. ${moyCom}%` },
          { id: "abonnement" as const, Icon: RefreshCw, titre: "Abonnement mensuel", n: counts.abonnement, color: "var(--sa-mode-abonnement)", bg: "var(--sa-mode-abonnement-bg)", sub: "" },
          { id: "achat" as const, Icon: ShoppingCart, titre: "Accès définitif", n: counts.achat, color: "var(--sa-mode-achat)", bg: "var(--sa-mode-achat-bg)", sub: "Revenus one-shot" },
        ].map((c) => (
          <button key={c.id} type="button" onClick={() => setFiltre(c.id)} className="text-left rounded-[var(--sa-radius-lg)] p-4" style={{ background: c.bg, borderTop: `3px solid ${c.color}` }}>
            <c.Icon size={24} style={{ color: c.color }} />
            <p className="mt-2 text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>{c.titre}</p>
            <p className="text-[28px] font-bold leading-none mt-1" style={{ fontFamily: "var(--sa-font-display)", color: "var(--sa-text)" }}>{c.n}</p>
            {c.sub ? <p className="text-[12px] mt-1" style={{ color: "var(--sa-text-3)" }}>{c.sub}</p> : null}
            <span className="inline-block mt-2 text-[12px] font-semibold" style={{ color: c.color }}>Gérer</span>
          </button>
        ))}
      </div>

      <SaCard>
        <SaCardHeader>
          <p className="text-[14px] font-semibold" style={{ color: "var(--sa-text)" }}>Configuration des modes de revenus</p>
        </SaCardHeader>
        <SaCardBody>
          <div className="flex gap-2 overflow-x-auto mb-4">
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)} className="px-3 py-2 text-[13px] font-medium shrink-0" style={{ color: tab === t.id ? "var(--sa-primary)" : "var(--sa-text-3)", borderBottom: tab === t.id ? "2px solid var(--sa-primary)" : "2px solid transparent" }}>{t.label}</button>
            ))}
          </div>
          {tab === "essai" ? (
            <div className="space-y-3 max-w-xl">
              <div className="grid sm:grid-cols-2 gap-3">
                <label><span className="sa-input-label">Durée par défaut (jours)</span><input className="sa-input" type="number" value={defaults.essai_duree_jours || 30} onChange={(e) => setDefaults({ ...defaults, essai_duree_jours: Number(e.target.value) })} /></label>
                <label><span className="sa-input-label">Délai de négociation</span><input className="sa-input" type="number" value={defaults.delai_negociation_jours || 7} onChange={(e) => setDefaults({ ...defaults, delai_negociation_jours: Number(e.target.value) })} /></label>
              </div>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={Number(defaults.essai_suspension_auto) === 1} onChange={(e) => setDefaults({ ...defaults, essai_suspension_auto: e.target.checked ? 1 : 0 })} /> Suspension automatique</label>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={Number(defaults.essai_notifs) === 1} onChange={(e) => setDefaults({ ...defaults, essai_notifs: e.target.checked ? 1 : 0 })} /> Notifications automatiques</label>
              {Number(defaults.essai_notifs) === 1 ? (
                <div className="flex gap-3 text-[12px]" style={{ color: "var(--sa-text-3)" }}>
                  {(["essai_j7", "essai_j3", "essai_j1"] as const).map((k, i) => (
                    <label key={k} className="inline-flex items-center gap-1"><input type="checkbox" checked={Number(defaults[k]) === 1} onChange={(e) => setDefaults({ ...defaults, [k]: e.target.checked ? 1 : 0 })} /> {["J-7", "J-3", "J-1"][i]}</label>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {tab === "commission" ? (
            <div className="space-y-3 max-w-xl">
              <label><span className="sa-input-label">% commission par défaut</span><input className="sa-input" type="number" value={defaults.commission_pourcentage || 10} onChange={(e) => setDefaults({ ...defaults, commission_pourcentage: Number(e.target.value) })} /></label>
              <PreviewContrat prix={40000} pctAvance={50} pctCommission={Number(defaults.commission_pourcentage || 10)} mode="retrait" politiqueFrais="gerant" />
            </div>
          ) : null}
          {tab === "abonnement" ? (
            <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
              <label><span className="sa-input-label">Montant par défaut (FCFA)</span><input className="sa-input" type="number" value={defaults.abonnement_montant || 0} onChange={(e) => setDefaults({ ...defaults, abonnement_montant: Number(e.target.value) })} /></label>
              <label><span className="sa-input-label">Délai de grâce (jours)</span><input className="sa-input" type="number" value={defaults.abonnement_grace_jours || 3} onChange={(e) => setDefaults({ ...defaults, abonnement_grace_jours: Number(e.target.value) })} /></label>
            </div>
          ) : null}
          {tab === "achat" ? (
            <p className="text-[13px]" style={{ color: "var(--sa-text-3)" }}>Ce mode désactive les commissions futures (logique de calcul : Mohamed). Le montant négocié est enregistré ici comme référence.</p>
          ) : null}
          <p className="sa-input-hint mt-3">Ces valeurs sont appliquées à la création. Chaque terrain peut avoir ses propres valeurs.</p>
          <SaButton className="mt-3" loading={saving} onClick={() => void saveDefaults()}>Enregistrer les paramètres par défaut</SaButton>
        </SaCardBody>
      </SaCard>

      <div className="flex flex-wrap gap-2 items-center">
        <input className="sa-input max-w-xs" placeholder="Rechercher terrain, proprio, gérant" value={q} onChange={(e) => setQ(e.target.value)} />
        {(["tous", "essai", "commission", "abonnement", "achat"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFiltre(f)} className="sa-btn sa-btn-sm" style={filtre === f ? { background: "var(--sa-primary-subtle)", color: "var(--sa-primary-text)", borderColor: "var(--sa-primary-border)" } : undefined}>{f === "tous" ? "Tous" : f}</button>
        ))}
        {(["tous", "actif", "expire", "suspendu"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setStatutFiltre(f)} className="sa-btn sa-btn-sm" style={statutFiltre === f ? { background: "var(--sa-surface-2)", color: "var(--sa-text)" } : undefined}>{f === "tous" ? "Tous statuts" : f}</button>
        ))}
      </div>

      <SaCard>
        {filtered.length === 0 ? (
          <SaEmptyState icon={BarChart2} titre="Aucun terrain" description="Aucun résultat pour ces filtres." />
        ) : (
          <div className="hidden md:block overflow-x-auto">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Terrain</th>
                  <th>Propriétaire</th>
                  <th>Mode actuel</th>
                  <th>Détail</th>
                  <th>Statut</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.t.id}>
                    <td>
                      <p className="font-semibold" style={{ color: "var(--sa-text)" }}>{r.t.nom}</p>
                      <p className="text-[11px]" style={{ color: "var(--sa-text-muted)" }}>{r.t.ville || "—"}</p>
                    </td>
                    <td>
                      <p>{r.proprio?.nom || r.t.proprietaire_nom || "—"}</p>
                      <p className="text-[11px]" style={{ color: "var(--sa-text-muted)" }}>{r.proprio?.telephone || ""}</p>
                    </td>
                    <td><ModeRevenuBadge mode={r.mode} /></td>
                    <td className="text-[12px]">
                      {r.mode === "commission" ? `${Number(r.t.commission_pourcentage || 0)}%` : r.mode === "abonnement" ? `${fcfa(Number(r.t.abonnement_montant || 0))}/mois` : r.mode === "essai" ? (() => { const j = joursEssaiRestants(r.t); return j == null ? "Essai" : j < 0 ? "Expiré" : `J-${j} restants`; })() : fcfa(Number(r.t.achat_definitif_montant || 0))}
                    </td>
                    <td>
                      <span className="sa-badge" style={{ borderColor: r.t.is_active ? "var(--sa-success-border)" : "var(--sa-danger-border)", color: r.t.is_active ? "var(--sa-success-text)" : "var(--sa-danger-text)", background: r.t.is_active ? "var(--sa-success-subtle)" : "var(--sa-danger-subtle)" }}>{r.t.is_active ? "Actif" : "Suspendu"}</span>
                    </td>
                    <td>
                      <SaDropdown items={[
                        { label: "Changer de mode", onClick: () => openChange(r) },
                        { label: "Configurer le contrat", onClick: () => navigate(`/backoffice/superadmin/terrains/${r.t.id}?tab=contrat`) },
                      ]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="md:hidden space-y-3 p-3">
          {filtered.map((r) => (
            <article key={r.t.id} className="rounded-[var(--sa-radius-md)] p-3" style={{ border: "1px solid var(--sa-border)" }}>
              <p className="font-semibold">{r.t.nom}</p>
              <div className="mt-2"><ModeRevenuBadge mode={r.mode} /></div>
              <SaButton className="mt-3 w-full" variant="secondary" onClick={() => openChange(r)}>Changer de mode</SaButton>
            </article>
          ))}
        </div>
      </SaCard>

      <details className="sa-card">
        <summary className="sa-card-header cursor-pointer text-[14px] font-semibold">Historique des changements de mode</summary>
        <div className="overflow-x-auto">
          <table className="sa-table">
            <thead><tr><th>Date</th><th>Terrain</th><th>Ancien</th><th>Nouveau</th><th>Fait par</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}><td className="text-[12px]">{String(h.created_at || "").slice(0, 16)}</td><td>{h.terrain_nom}</td><td>{h.ancien_mode}</td><td>{h.nouveau_mode}</td><td>{h.auteur || "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sa-card-footer"><SaButton variant="secondary" size="sm" icon={<Download size={14} />} onClick={exportCsv}>Exporter CSV</SaButton></div>
      </details>

      <SaModal
        ouvert={Boolean(modal)}
        titre={`Changer le mode de ${modal?.t?.nom || ""}`}
        onFermer={() => setModal(null)}
        footer={
          <>
            <SaButton variant="secondary" onClick={() => setModal(null)}>Annuler</SaButton>
            <SaButton loading={saving} onClick={() => void confirmChange()}>Confirmer le changement</SaButton>
          </>
        }
      >
        {modal ? (
          <div className="space-y-4">
            <p className="text-[13px]" style={{ color: "var(--sa-text-3)" }}>Mode actuel : <ModeRevenuBadge mode={modal.mode} /></p>
            <ModeSelector value={nextMode} current={modal.mode} onChange={setNextMode} />
            {nextMode === "essai" ? (
              <div className="grid grid-cols-2 gap-2">
                <label><span className="sa-input-label">Durée</span><input className="sa-input" type="number" value={form.essai_duree_jours || 30} onChange={(e) => setForm({ ...form, essai_duree_jours: Number(e.target.value) })} /></label>
                <label><span className="sa-input-label">Négociation</span><input className="sa-input" type="number" value={form.delai_negociation_jours || 7} onChange={(e) => setForm({ ...form, delai_negociation_jours: Number(e.target.value) })} /></label>
              </div>
            ) : null}
            {nextMode === "commission" ? (
              <label><span className="sa-input-label">% commission</span><input className="sa-input" type="number" value={form.commission_pourcentage || 0} onChange={(e) => setForm({ ...form, commission_pourcentage: Number(e.target.value) })} /></label>
            ) : null}
            {nextMode === "abonnement" ? (
              <label><span className="sa-input-label">Montant mensuel</span><input className="sa-input" type="number" value={form.abonnement_montant || 0} onChange={(e) => setForm({ ...form, abonnement_montant: Number(e.target.value) })} /></label>
            ) : null}
            {nextMode === "achat" ? (
              <label><span className="sa-input-label">Montant négocié</span><input className="sa-input" type="number" value={form.achat_definitif_montant || 0} onChange={(e) => setForm({ ...form, achat_definitif_montant: Number(e.target.value) })} /></label>
            ) : null}
            <p className="text-[12px]" style={{ color: "var(--sa-text-muted)" }}>Ce changement s&apos;applique immédiatement. L&apos;ancien mode est archivé. Le calcul PayTech n&apos;est pas modifié ici.</p>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={gotoContrat} onChange={(e) => setGotoContrat(e.target.checked)} /> Aller au contrat pour ajuster la facturation</label>
          </div>
        ) : null}
      </SaModal>
    </div>
  );
}
