import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Download, LayoutGrid, List, MapPin } from "lucide-react";
import { superAdminApi } from "@/services/superAdminApi";
import { useAuth } from "@/hooks/use-auth";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import ContratBadge from "@/espaces/backoffice/components/superadmin/ContratBadge";
import ModeBadge from "@/espaces/backoffice/components/superadmin/ModeBadge";
import ModeRevenuBadge from "@/espaces/backoffice/components/superadmin/ui/ModeRevenuBadge";
import { resolveModeRevenu } from "@/lib/modeRevenu";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";
import SaButton from "@/espaces/backoffice/components/superadmin/ui/SaButton";
import SaDropdown from "@/espaces/backoffice/components/superadmin/ui/SaDropdown";
import SaEmptyState from "@/espaces/backoffice/components/superadmin/ui/SaEmptyState";
import SaFilterBar from "@/espaces/backoffice/components/superadmin/ui/SaFilterBar";
import TerrainCreateForm from "@/espaces/backoffice/components/superadmin/TerrainCreateForm";
import Select2 from "@/components/Select2";
import {
  fcfa,
  fraisLabel,
  getContratOverlay,
  terrainStatutListe,
} from "@/lib/saContrat";

function essaiModePill(t: any) {
  const today = new Date().toISOString().slice(0, 10);
  const mode = Number(t.mode_essai) === 1;
  const fin = t.essai_fin_at ? String(t.essai_fin_at).slice(0, 10) : null;
  const susp = Number(t.essai_suspendu_auto) === 1;
  if (susp) return { label: "Suspendu (essai)", color: "var(--sa-danger)", bg: "var(--sa-danger-bg)" };
  if (mode && fin && today > fin) return { label: "Essai expiré", color: "var(--sa-warning)", bg: "var(--sa-warning-bg)" };
  if (mode) {
    const rest = fin ? Math.max(0, Math.round((new Date(`${fin}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000)) : Number(t.essai_duree_jours || 30);
    return { label: `Essai · J-${rest}`, color: "var(--sa-info)", bg: "var(--sa-info-bg)" };
  }
  if (!t.is_active) return { label: "Suspendu (admin)", color: "var(--sa-danger)", bg: "var(--sa-danger-bg)" };
  return { label: "Production", color: "var(--sa-success)", bg: "var(--sa-success-bg)" };
}

function statutBadge(statut: "actif" | "suspendu" | "en_attente") {
  if (statut === "actif") return { label: "Actif", color: "var(--sa-success)", bg: "var(--sa-success-bg)" };
  if (statut === "suspendu") return { label: "Suspendu", color: "var(--sa-danger)", bg: "var(--sa-danger-bg)" };
  return { label: "En attente", color: "var(--sa-warning)", bg: "var(--sa-warning-bg)" };
}

function toCoord(value: unknown): number | null {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function LocalisationCell({
  terrain,
  onConfigurer,
}: {
  terrain: any;
  onConfigurer: () => void;
}) {
  const lat = toCoord(terrain.latitude);
  const lng = toCoord(terrain.longitude);
  const hasCoords = lat != null && lng != null;
  const hasAdresse = Boolean(terrain.adresse_theorique);

  if (hasCoords) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[12px] font-medium"
        title={`${lat!.toFixed(4)}, ${lng!.toFixed(4)}`}
        style={{ color: "var(--sa-success)" }}
      >
        <MapPin size={14} />
        Configurée ✓
      </span>
    );
  }
  if (hasAdresse) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: "var(--sa-warning)" }}>
        <MapPin size={14} />
        Adresse sans coords
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: "var(--sa-danger)" }}>
      <MapPin size={14} />
      Non configurée
      <button type="button" className="underline font-semibold" style={{ color: "var(--sa-primary)" }} onClick={onConfigurer}>
        Configurer
      </button>
    </span>
  );
}

export default function GestionTerrains() {
  useSaCrumbs([{ label: "Terrains", to: "/backoffice/superadmin/terrains" }]);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const commoditeFilter = searchParams.get("commodite") || "";
  const { user } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [gerants, setGerants] = useState<any[]>([]);
  const [finances, setFinances] = useState<any>();
  const [show, setShow] = useState(false);
  const [q, setQ] = useState("");
  const [filtreStatut, setFiltreStatut] = useState("tous");
  const [filtreMode, setFiltreMode] = useState("tous");
  const [filtreRevenu, setFiltreRevenu] = useState("tous");
  const [filtreCanal, setFiltreCanal] = useState("tous");
  const [vue, setVue] = useState<"table" | "cards">("table");

  const load = () =>
    Promise.all([superAdminApi.terrains(), superAdminApi.users(), superAdminApi.finances().catch(() => null)]).then(
      ([t, u, f]) => {
        const terrains = Array.isArray(t) ? t : [];
        const users = Array.isArray(u) ? u : [];
        setItems(terrains);
        setOwners(users.filter((x: any) => x.role === "proprietaire"));
        setGerants(users.filter((x: any) => x.role === "gerant"));
        setFinances(f);
      },
    );

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const filtresActifs = q || filtreStatut !== "tous" || filtreMode !== "tous" || filtreCanal !== "tous" || filtreRevenu !== "tous" || Boolean(commoditeFilter);

  const rows = useMemo(() => {
    return items
      .map((t) => {
        const c = getContratOverlay(t.id);
        const fin = (finances?.terrains || []).find((f: any) => Number(f.id) === Number(t.id)) || {};
        const du = Math.max(0, Number(fin.avances || 0) - Number(fin.commissions || 0) - Number(fin.reverse || 0));
        const statut = terrainStatutListe(t, c);
        const remb = c.remboursement_autorise || Number(t.delai_remboursement_heures || 0) > 0;
        return { t, c, du, statut, remb };
      })
      .filter((r) => {
        const hay = `${r.t.nom} ${r.t.adresse || ""} ${r.t.quartier || ""} ${r.t.ville || ""}`.toLowerCase();
        if (q && !hay.includes(q.toLowerCase())) return false;
        if (filtreStatut === "sans_contrat" && !(r.c.wave_statut === "absent" && r.c.om_statut === "absent")) return false;
        if (filtreStatut !== "tous" && filtreStatut !== "sans_contrat" && r.statut !== filtreStatut) return false;
        if (filtreRevenu !== "tous" && resolveModeRevenu(r.t) !== filtreRevenu) return false;
        if (filtreMode !== "tous" && r.c.payout_mode !== filtreMode) return false;
        if (filtreCanal === "verifie" && r.c.wave_statut !== "verifie" && r.c.om_statut !== "verifie") return false;
        if (filtreCanal === "non" && (r.c.wave_statut !== "absent" || r.c.om_statut !== "absent")) return false;
        if (commoditeFilter) {
          let keys: string[] = [];
          const raw = r.t.commodites;
          if (Array.isArray(raw)) {
            keys = raw.map((item: unknown) => (typeof item === "string" ? item : String((item as { cle?: string })?.cle || "")));
          } else if (typeof raw === "string" && raw.trim()) {
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) {
                keys = parsed.map((item) => (typeof item === "string" ? item : String(item?.cle || "")));
              }
            } catch {
              keys = [];
            }
          }
          if (!keys.includes(commoditeFilter)) return false;
        }
        return true;
      });
  }, [items, finances, q, filtreStatut, filtreMode, filtreCanal, filtreRevenu, commoditeFilter]);

  return (
    <div className="space-y-5 max-w-[1200px]">
      <SaPageHeader
        titre="Terrains"
        sousTitre={`${rows.length} / ${items.length} terrains`}
        actions={
          <div className="flex items-center gap-2">
            <SaButton variant="secondary" icon={<Download size={14} />} onClick={() => {
              const lines = ["Terrain;Ville;Mode;Statut;Du"].concat(rows.map(({ t, du }) => [t.nom, t.ville || "", resolveModeRevenu(t), t.is_active ? "actif" : "suspendu", du].join(";")));
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
              a.download = "terrains.csv";
              a.click();
            }}>Exporter</SaButton>
            <SaButton onClick={() => setShow(!show)}>{show ? "Fermer" : "+ Nouveau terrain"}</SaButton>
          </div>
        }
      />

      {commoditeFilter ? (
        <div className="rounded-lg px-3 py-2 text-[13px] flex items-center justify-between gap-2" style={{ background: "var(--sa-primary-glow)", color: "var(--sa-primary)" }}>
          <span>Filtré par commodité : {commoditeFilter}</span>
          <button type="button" className="text-[12px] font-semibold underline" onClick={() => navigate("/backoffice/superadmin/terrains")}>
            Réinitialiser
          </button>
        </div>
      ) : null}

      {show ? (
        <TerrainCreateForm
          owners={owners}
          gerants={gerants}
          auteur={user?.nom || "Super Admin"}
          onCancel={() => setShow(false)}
          onCreated={async () => {
            setShow(false);
            await load();
          }}
        />
      ) : null}

      <SaFilterBar>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Recherche (nom, quartier)"
          className="sa-input max-w-xs"
        />
        {(["tous", "actif", "suspendu", "sans_contrat"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFiltreStatut(f)} className="sa-btn sa-btn-sm" style={filtreStatut === f ? { background: "var(--sa-primary-subtle)", color: "var(--sa-primary-text)", borderColor: "var(--sa-primary-border)" } : undefined}>
            {f === "tous" ? "Tous" : f === "sans_contrat" ? "Sans contrat" : f === "actif" ? "Actif" : "Suspendu"}
          </button>
        ))}
        <Select2
          size="sm"
          className="!w-[180px] min-w-[160px]"
          value={filtreRevenu}
          onChange={setFiltreRevenu}
          options={[
            { value: "tous", label: "Tous les modes" },
            { value: "essai", label: "Essai" },
            { value: "commission", label: "Commission" },
            { value: "abonnement", label: "Abonnement" },
            { value: "achat", label: "Achat" },
          ]}
        />
        <Select2
          size="sm"
          className="!w-[160px] min-w-[140px]"
          value={filtreMode}
          onChange={setFiltreMode}
          options={[
            { value: "tous", label: "Reversement" },
            { value: "auto", label: "Auto" },
            { value: "retrait", label: "Retrait" },
          ]}
        />
        <Select2
          size="sm"
          className="!w-[180px] min-w-[160px]"
          value={filtreCanal}
          onChange={setFiltreCanal}
          options={[
            { value: "tous", label: "Numéro Wave/OM" },
            { value: "verifie", label: "Vérifié" },
            { value: "non", label: "Non configuré" },
          ]}
        />
        <button type="button" className="sa-btn sa-btn-ghost sa-btn-sm" onClick={() => setVue(vue === "table" ? "cards" : "table")} aria-label="Changer de vue">
          {vue === "table" ? <LayoutGrid size={14} /> : <List size={14} />}
        </button>
        {filtresActifs ? (
          <button type="button" onClick={() => { setQ(""); setFiltreStatut("tous"); setFiltreMode("tous"); setFiltreCanal("tous"); setFiltreRevenu("tous"); }} className="sa-btn sa-btn-ghost sa-btn-sm">
            Réinitialiser
          </button>
        ) : null}
      </SaFilterBar>

      {rows.length === 0 ? (
        <SaEmptyState icon={MapPin} titre="Aucun terrain" description="Aucun résultat pour ces filtres." />
      ) : vue === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map(({ t, c, du, statut, remb }) => {
            const st = statutBadge(statut);
            return (
              <article key={t.id} className="sa-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold">{t.nom}</p>
                    <p className="text-[11px]" style={{ color: "var(--sa-text-muted)" }}>{t.ville || "—"}</p>
                  </div>
                  <ModeRevenuBadge mode={resolveModeRevenu(t)} />
                </div>
                <p className="mt-3 text-[12px]" style={{ color: "var(--sa-text-3)" }}>Dû {fcfa(du)} · Avance {Number(t.pourcentage_avance || 0)}%</p>
                <p className="mt-1 text-[11px]" style={{ color: st.color }}>{st.label}{remb ? " · fenêtre remb." : ""}</p>
                <SaButton className="mt-3 w-full" variant="secondary" onClick={() => navigate(`/backoffice/superadmin/terrains/${t.id}`)}>Gérer</SaButton>
              </article>
            );
          })}
        </div>
      ) : (
      <div className="hidden md:block rounded-xl overflow-hidden" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <table className="sa-table">
          <thead>
            <tr>
              <th>Terrain</th>
              <th>Localisation</th>
              <th>Contrat commercial</th>
              <th>Remboursement</th>
              <th>Mode reversement</th>
              <th>Mode revenu</th>
              <th>Wave / OM</th>
              <th>Dû gérant</th>
              <th>Statut</th>
              <th>Mode essai</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ t, c, du, statut, remb }) => {
              const st = statutBadge(statut);
              const duPill = du <= 0 ? { label: "0", color: "var(--sa-muted)", bg: "var(--sa-surface-2)" } : remb ? { label: "En fenêtre", color: "var(--sa-warning)", bg: "var(--sa-warning-bg)" } : { label: "Payable", color: "var(--sa-success)", bg: "var(--sa-success-bg)" };
              return (
                <tr key={t.id}>
                  <td>
                    <div className="sa-cell-stack">
                    <p className="sa-cell-title">{t.nom}</p>
                    <p className="sa-cell-sub">{t.adresse_theorique || t.adresse || t.quartier || "—"}{t.ville ? ` · ${t.ville}` : ""}</p>
                    </div>
                  </td>
                  <td>
                    <LocalisationCell terrain={t} onConfigurer={() => navigate(`/backoffice/superadmin/terrains/${t.id}?tab=localisation`)} />
                  </td>
                  <td>
                    <span className="inline-flex gap-1">
                      <span className="rounded-full px-2 py-0.5 text-[12px]" style={{ background: "var(--sa-surface-2)" }}>Avance {Number(t.pourcentage_avance || 0)}%</span>
                      <span className="rounded-full px-2 py-0.5 text-[12px]" style={{ background: "var(--sa-surface-2)" }}>Com. {Number(t.commission_pourcentage || 0)}%</span>
                    </span>
                  </td>
                  <td>
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: remb ? "var(--sa-warning-bg)" : "var(--sa-absent-bg)", color: remb ? "var(--sa-warning)" : "var(--sa-danger)" }}>
                      {remb ? `${Number(t.delai_remboursement_heures || 0)} h` : "Non"}
                    </span>
                  </td>
                  <td>
                    <ModeBadge mode={c.payout_mode} />
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--sa-muted)" }}>{c.payout_mode === "auto" ? fraisLabel(c) : "0 frais"}</p>
                  </td>
                  <td>
                    <ModeRevenuBadge mode={resolveModeRevenu(t)} />
                  </td>
                  <td>
                    <div className="sa-canal-row">
                      <ContratBadge statut={c.wave_statut} operateur="wave" />
                      <ContratBadge statut={c.om_statut} operateur="om" />
                    </div>
                  </td>
                  <td>
                    <p className="text-[13px]">{fcfa(du)}</p>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: duPill.bg, color: duPill.color }}>{duPill.label}</span>
                  </td>
                  <td>
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                  </td>
                  <td>
                    {(() => {
                      const essai = essaiModePill(t);
                      return <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: essai.bg, color: essai.color }}>{essai.label}</span>;
                    })()}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => navigate(`/backoffice/superadmin/terrains/${t.id}`)} className="sa-btn sa-btn-sm sa-btn-secondary">Voir</button>
                      <SaDropdown items={[
                        { label: "Modifier", onClick: () => navigate(`/backoffice/superadmin/terrains/${t.id}?tab=infos`) },
                        { label: "Changer le mode", onClick: () => navigate(`/backoffice/superadmin/abonnements`) },
                        { label: t.is_active ? "Suspendre" : "Activer", danger: Boolean(t.is_active), onClick: async () => {
                          try {
                            await superAdminApi.terrainStatus(t.id, t.is_active ? "suspendu" : "actif");
                            await load();
                          } catch {
                            /* ignore */
                          }
                        } },
                      ]} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {vue === "table" ? (
      <div className="md:hidden space-y-3">
        {rows.map(({ t, c, du, statut, remb }) => {
          const st = statutBadge(statut);
          return (
            <article key={t.id} className="rounded-xl p-4" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[13px] font-semibold">{t.nom}</p>
                  <p className="text-[11px]" style={{ color: "var(--sa-muted)" }}>{t.ville}</p>
                </div>
                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
              </div>
              {(() => {
                const essai = essaiModePill(t);
                return <span className="mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: essai.bg, color: essai.color }}>{essai.label}</span>;
              })()}
              <p className="mt-2 text-[12px]" style={{ color: "var(--sa-text-2)" }}>Avance {Number(t.pourcentage_avance || 0)}% · Com. {Number(t.commission_pourcentage || 0)}%</p>
              <div className="mt-2">
                <LocalisationCell terrain={t} onConfigurer={() => navigate(`/backoffice/superadmin/terrains/${t.id}?tab=localisation`)} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <ModeBadge mode={c.payout_mode} />
                <ModeRevenuBadge mode={resolveModeRevenu(t)} />
                <ContratBadge statut={c.wave_statut} operateur="wave" />
                <ContratBadge statut={c.om_statut} operateur="om" />
                <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: remb ? "var(--sa-warning-bg)" : "var(--sa-absent-bg)", color: remb ? "var(--sa-warning)" : "var(--sa-danger)" }}>{remb ? `${t.delai_remboursement_heures} h` : "Remb. non"}</span>
              </div>
              <p className="mt-2 text-[13px] font-semibold">{fcfa(du)}</p>
              <button type="button" onClick={() => navigate(`/backoffice/superadmin/terrains/${t.id}?tab=contrat`)} className="mt-3 w-full h-10 rounded-lg text-[12px] font-semibold" style={{ background: "var(--sa-primary-glow)", color: "var(--sa-primary)" }}>
                Contrat
              </button>
            </article>
          );
        })}
      </div>
      ) : null}
    </div>
  );
}
