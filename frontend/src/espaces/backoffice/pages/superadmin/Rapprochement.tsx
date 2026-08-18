import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import { fcfa, getContratOverlay } from "@/lib/saContrat";
import Select2 from "@/components/Select2";

type Periode = "mois" | "trimestre" | "annee" | "perso";

export default function Rapprochement() {
  useSaCrumbs([{ label: "Rapprochement" }]);
  const navigate = useNavigate();
  const [periode, setPeriode] = useState<Periode>("mois");
  const [terrainId, setTerrainId] = useState("tous");
  const [finances, setFinances] = useState<any>();
  const [terrains, setTerrains] = useState<any[]>([]);
  const [sortKey, setSortKey] = useState<string>("du");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    superAdminApi.finances().then(setFinances).catch(console.error);
    superAdminApi.terrains().then(setTerrains).catch(console.error);
  }, [periode]);

  const rows = useMemo(() => {
    const list = (finances?.terrains || []).filter((t: any) => terrainId === "tous" || String(t.id) === terrainId);
    return list.map((t: any) => {
      const c = getContratOverlay(t.id);
      const recu = Number(t.avances || t.acomptes || 0);
      const rembourse = 0;
      const commission = Number(t.commissions || 0);
      const fraisDev = 0;
      const envoye = Number(t.reverse || 0);
      const du = Math.max(0, recu - rembourse - commission - fraisDev - envoye);
      return { ...t, recu, rembourse, commission, fraisDev, envoye, du, c };
    });
  }, [finances, terrainId]);

  const sorted = [...rows].sort((a, b) => {
    const va = Number(a[sortKey] || 0);
    const vb = Number(b[sortKey] || 0);
    return sortDir === "asc" ? va - vb : vb - va;
  });

  const tot = rows.reduce(
    (acc, r) => ({
      recu: acc.recu + r.recu,
      rembourse: acc.rembourse + r.rembourse,
      commission: acc.commission + r.commission,
      fraisDev: acc.fraisDev + r.fraisDev,
      envoye: acc.envoye + r.envoye,
      du: acc.du + r.du,
    }),
    { recu: 0, rembourse: 0, commission: 0, fraisDev: 0, envoye: 0, du: 0 },
  );

  const gauche = tot.recu - tot.rembourse;
  const droite = tot.commission + tot.fraisDev + tot.envoye + tot.du;
  const ecart = gauche - droite;
  const equilibre = Math.abs(ecart) < 1;

  const ventilation = useMemo(() => {
    let fenetre = 0, auto = 0, retrait = 0, bloque = 0, echec = 0;
    for (const r of rows) {
      const sansNum = r.c.wave_statut === "absent" && r.c.om_statut === "absent";
      if (sansNum) bloque += r.du;
      else if (r.c.remboursement_autorise) fenetre += r.du;
      else if (r.c.payout_mode === "auto") auto += r.du;
      else retrait += r.du;
    }
    return [
      { label: "En fenêtre de remboursement", value: fenetre, tone: "warning" as const },
      { label: "Payable mode auto", value: auto, tone: "info" as const },
      { label: "Payable mode retrait", value: retrait, tone: "info" as const },
      { label: "Bloqué sans numéro", value: bloque, tone: "danger" as const },
      { label: "En échec auto", value: echec, tone: "danger" as const },
    ];
  }, [rows]);

  function exportCsv() {
    const header = "Terrain;Reçu;Remboursé;Commission;Frais dév;Envoyé;Dû";
    const lines = sorted.map((r) => [r.nom, r.recu, r.rembourse, r.commission, r.fraisDev, r.envoye, r.du].join(";"));
    const blob = new Blob([header + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rapprochement-terrainsn.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function sortBy(key: string) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const Terme = ({ value, label }: { value: number; label: string }) => (
    <div className="text-center min-w-[110px]">
      <p className="text-[20px] font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--sa-text)" }}>{fcfa(value)}</p>
      <p className="text-[12px] mt-1" style={{ color: "var(--sa-muted)" }}>{label}</p>
    </div>
  );

  return (
    <div className="space-y-5 max-w-[1200px]">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <h2 className="text-[22px] font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--sa-text)" }}>Rapprochement comptable</h2>
        <div className="flex flex-wrap gap-2">
          {([
            ["mois", "Ce mois"],
            ["trimestre", "Ce trimestre"],
            ["annee", "Cette année"],
            ["perso", "Personnalisé"],
          ] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setPeriode(v)} className="h-9 px-3 rounded-full text-[12px] font-semibold" style={{ background: periode === v ? "var(--sa-primary)" : "var(--sa-surface)", color: periode === v ? "var(--sa-surface)" : "var(--sa-text-2)", border: "1px solid var(--sa-border)" }}>
              {l}
            </button>
          ))}
          <Select2
            size="sm"
            className="!w-[200px] min-w-[180px]"
            value={terrainId}
            onChange={setTerrainId}
            options={[
              { value: "tous", label: "Tous les terrains" },
              ...terrains.map((t) => ({ value: String(t.id), label: t.nom })),
            ]}
          />
          <button type="button" onClick={exportCsv} className="h-9 px-3 rounded-lg text-[12px] font-semibold text-white" style={{ background: "var(--sa-primary)" }}>
            Exporter CSV
          </button>
        </div>
      </div>

      <section className="rounded-2xl p-6" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-[15px] font-semibold">Équation de la caisse</h3>
          {equilibre ? (
            <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: "var(--sa-success-bg)", color: "var(--sa-success)" }}>Équilibrée ✓</span>
          ) : (
            <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: "var(--sa-danger-bg)", color: "var(--sa-danger)" }}>Écart détecté : {fcfa(Math.abs(ecart))}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Terme value={tot.recu} label="Reçu PayTech" />
          <span className="text-2xl font-light" style={{ color: "var(--sa-muted)" }}>−</span>
          <Terme value={tot.rembourse} label="Remboursé joueurs" />
          <span className="text-2xl font-light" style={{ color: "var(--sa-muted)" }}>=</span>
          <Terme value={tot.commission} label="Commission" />
          <span className="text-2xl font-light" style={{ color: "var(--sa-muted)" }}>+</span>
          <Terme value={tot.fraisDev} label="Frais payout plateforme" />
          <span className="text-2xl font-light" style={{ color: "var(--sa-muted)" }}>+</span>
          <Terme value={tot.envoye} label="Envoyé gérants" />
          <span className="text-2xl font-light" style={{ color: "var(--sa-muted)" }}>+</span>
          <Terme value={tot.du} label="Encore dû" />
        </div>
      </section>

      <section className="rounded-xl p-5 space-y-2" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <h3 className="text-[14px] font-semibold mb-2">Ventilation du « encore dû »</h3>
        {ventilation.map((v) => {
          const color = v.tone === "warning" ? "var(--sa-warning)" : v.tone === "danger" ? "var(--sa-danger)" : "var(--sa-info)";
          const bg = v.tone === "warning" ? "var(--sa-warning-bg)" : v.tone === "danger" ? "var(--sa-danger-bg)" : "var(--sa-info-bg)";
          return (
            <div key={v.label} className="flex items-center justify-between text-[13px]">
              <span style={{ color: "var(--sa-text-2)" }}>{v.label}</span>
              <span className="inline-flex items-center gap-2">
                <span className="font-semibold">{fcfa(v.value)}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: bg, color }}>{v.tone === "danger" ? "Alerte" : v.tone === "warning" ? "Attente" : "Payable"}</span>
              </span>
            </div>
          );
        })}
      </section>

      <section className="rounded-xl overflow-hidden" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <div className="hidden md:block overflow-x-auto">
          <table className="sa-table">
            <thead>
              <tr>
                {[["nom", "Terrain"], ["recu", "Reçu"], ["rembourse", "Remboursé"], ["commission", "Commission"], ["fraisDev", "Frais dév"], ["envoye", "Envoyé"], ["du", "Dû"]].map(([k, l]) => (
                  <th key={k}>
                    <button type="button" onClick={() => sortBy(k)}>{l}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="cursor-pointer" onClick={() => navigate(`/backoffice/superadmin/terrains/${r.id}?tab=contrat`)}>
                  <td className="font-semibold">{r.nom}</td>
                  <td>{fcfa(r.recu)}</td>
                  <td>{fcfa(r.rembourse)}</td>
                  <td>{fcfa(r.commission)}</td>
                  <td>{fcfa(r.fraisDev)}</td>
                  <td>{fcfa(r.envoye)}</td>
                  <td className="font-semibold">{fcfa(r.du)}</td>
                </tr>
              ))}
              <tr>
                <td className="font-bold">Total</td>
                <td className="font-bold">{fcfa(tot.recu)}</td>
                <td className="font-bold">{fcfa(tot.rembourse)}</td>
                <td className="font-bold">{fcfa(tot.commission)}</td>
                <td className="font-bold">{fcfa(tot.fraisDev)}</td>
                <td className="font-bold">{fcfa(tot.envoye)}</td>
                <td className="font-bold">{fcfa(tot.du)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="md:hidden p-3 space-y-2">
          {sorted.map((r) => (
            <article key={r.id} className="rounded-lg p-3" style={{ border: "1px solid var(--sa-border)" }} onClick={() => navigate(`/backoffice/superadmin/terrains/${r.id}?tab=contrat`)}>
              <p className="font-semibold text-[13px]">{r.nom}</p>
              <p className="text-[12px] mt-1" style={{ color: "var(--sa-muted)" }}>Reçu {fcfa(r.recu)} · Dû {fcfa(r.du)}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
