import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { superAdminApi } from "@/services/superAdminApi";
import { useAuth } from "@/hooks/use-auth";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import ContratBadge from "@/espaces/backoffice/components/superadmin/ContratBadge";
import ModeBadge from "@/espaces/backoffice/components/superadmin/ModeBadge";
import TerrainCreateForm from "@/espaces/backoffice/components/superadmin/TerrainCreateForm";
import Select2 from "@/components/Select2";
import {
  fcfa,
  fraisLabel,
  getContratOverlay,
  terrainStatutListe,
} from "@/lib/saContrat";

function statutBadge(statut: "actif" | "suspendu" | "en_attente") {
  if (statut === "actif") return { label: "Actif", color: "var(--sa-success)", bg: "var(--sa-success-bg)" };
  if (statut === "suspendu") return { label: "Suspendu", color: "var(--sa-danger)", bg: "var(--sa-danger-bg)" };
  return { label: "En attente", color: "var(--sa-warning)", bg: "var(--sa-warning-bg)" };
}

export default function GestionTerrains() {
  useSaCrumbs([{ label: "Terrains", to: "/backoffice/superadmin/terrains" }]);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [gerants, setGerants] = useState<any[]>([]);
  const [finances, setFinances] = useState<any>();
  const [show, setShow] = useState(false);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [filtreStatut, setFiltreStatut] = useState("tous");
  const [filtreMode, setFiltreMode] = useState("tous");
  const [filtreCanal, setFiltreCanal] = useState("tous");

  const load = () =>
    Promise.all([superAdminApi.terrains(), superAdminApi.users(), superAdminApi.finances().catch(() => null)]).then(
      ([t, u, f]) => {
        setItems(t);
        setOwners(u.filter((x: any) => x.role === "proprietaire"));
        setGerants(u.filter((x: any) => x.role === "gerant"));
        setFinances(f);
      },
    );

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const filtresActifs = q || filtreStatut !== "tous" || filtreMode !== "tous" || filtreCanal !== "tous";

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
        if (filtreStatut !== "tous" && r.statut !== filtreStatut) return false;
        if (filtreMode !== "tous" && r.c.payout_mode !== filtreMode) return false;
        if (filtreCanal === "verifie" && r.c.wave_statut !== "verifie" && r.c.om_statut !== "verifie") return false;
        if (filtreCanal === "non" && (r.c.wave_statut !== "absent" || r.c.om_statut !== "absent")) return false;
        return true;
      });
  }, [items, finances, q, filtreStatut, filtreMode, filtreCanal]);

  return (
    <div className="space-y-5 max-w-[1200px]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[22px] font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--sa-text)" }}>
            Terrains
          </h2>
          <span className="min-h-[22px] px-2 rounded-full text-[11px] font-semibold" style={{ background: "var(--sa-surface-2)", color: "var(--sa-text-2)" }}>
            {items.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white"
          style={{ background: "var(--sa-primary)" }}
        >
          {show ? "Fermer" : "+ Ajouter un terrain"}
        </button>
      </div>

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

      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Recherche (nom, quartier)"
          className="h-10 px-3 rounded-lg text-[13px] min-w-[200px] flex-1"
          style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface)" }}
        />
        <Select2
          size="sm"
          className="!w-[180px] min-w-[160px]"
          value={filtreStatut}
          onChange={setFiltreStatut}
          options={[
            { value: "tous", label: "Tous les statuts" },
            { value: "actif", label: "Actif" },
            { value: "suspendu", label: "Suspendu" },
            { value: "en_attente", label: "En attente" },
          ]}
        />
        <Select2
          size="sm"
          className="!w-[160px] min-w-[140px]"
          value={filtreMode}
          onChange={setFiltreMode}
          options={[
            { value: "tous", label: "Tous les modes" },
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
        {filtresActifs ? (
          <button type="button" onClick={() => { setQ(""); setFiltreStatut("tous"); setFiltreMode("tous"); setFiltreCanal("tous"); }} className="h-10 px-3 rounded-lg text-[12px] font-semibold" style={{ color: "var(--sa-primary)" }}>
            Réinitialiser
          </button>
        ) : null}
      </div>

      <div className="hidden md:block rounded-xl overflow-hidden" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <table className="sa-table">
          <thead>
            <tr>
              <th>Terrain</th>
              <th>Contrat commercial</th>
              <th>Remboursement</th>
              <th>Mode reversement</th>
              <th>Wave / OM</th>
              <th>Dû gérant</th>
              <th>Statut</th>
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
                    <p className="text-[13px] font-semibold" style={{ color: "var(--sa-text)" }}>{t.nom}</p>
                    <p className="text-[11px]" style={{ color: "var(--sa-muted)" }}>{t.adresse || t.quartier || "—"}{t.ville ? ` · ${t.ville}` : ""}</p>
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
                    <div className="flex gap-1">
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
                  <td className="relative">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => navigate(`/backoffice/superadmin/terrains/${t.id}?tab=contrat`)} className="h-8 px-2 rounded-md text-[11px] font-semibold" style={{ background: "var(--sa-primary-glow)", color: "var(--sa-primary)" }}>
                        Contrat
                      </button>
                      <button type="button" onClick={() => setMenuId(menuId === t.id ? null : t.id)} className="w-8 h-8 rounded-md grid place-items-center" style={{ border: "1px solid var(--sa-border)" }}>
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                    {menuId === t.id ? (
                      <div className="absolute right-0 mt-1 z-10 w-40 rounded-lg py-1" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow-md)", border: "1px solid var(--sa-border)" }}>
                        <button type="button" className="w-full text-left px-3 py-2 text-[12px]" onClick={() => { setMenuId(null); navigate(`/backoffice/superadmin/terrains/${t.id}?tab=infos`); }}>Éditer</button>
                        <button
                          type="button"
                          disabled={toggling === t.id}
                          className="w-full text-left px-3 py-2 text-[12px]"
                          onClick={async () => {
                            setToggling(t.id);
                            try {
                              await superAdminApi.terrainStatus(t.id, t.is_active ? "suspendu" : "actif");
                              await load();
                            } finally {
                              setToggling(null);
                              setMenuId(null);
                            }
                          }}
                        >
                          {t.is_active ? "Suspendre" : "Activer"}
                        </button>
                        <button type="button" className="w-full text-left px-3 py-2 text-[12px]" onClick={() => { setMenuId(null); navigate("/backoffice/superadmin/utilisateurs"); }}>
                          Voir proprio
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
              <p className="mt-2 text-[12px]" style={{ color: "var(--sa-text-2)" }}>Avance {Number(t.pourcentage_avance || 0)}% · Com. {Number(t.commission_pourcentage || 0)}%</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <ModeBadge mode={c.payout_mode} />
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
    </div>
  );
}
