import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import { fcfa } from "@/lib/saContrat";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";
import Select2 from "@/components/Select2";

type Periode = "mois" | "trimestre" | "annee" | "perso";

export default function Rapprochement() {
  useSaCrumbs([{ label: "Rapprochement" }]);
  const navigate = useNavigate();
  const [periode, setPeriode] = useState<Periode>("mois");
  const [terrainId, setTerrainId] = useState("tous");
  const [ledger, setLedger] = useState<any>();
  const [terrains, setTerrains] = useState<any[]>([]);
  const [sortKey, setSortKey] = useState<string>("du");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    superAdminApi.rapprochement().then(setLedger).catch(console.error);
    superAdminApi.terrains().then((t) => setTerrains(Array.isArray(t) ? t : [])).catch(console.error);
  }, [periode]);

  const tot = {
    recu: Number(ledger?.recu || 0),
    rembourse: Number(ledger?.rembourse || 0),
    commission: Number(ledger?.commission || 0) + Number(ledger?.commission_en_fenetre || 0),
    fraisDev: Number(ledger?.frais_payout_plateforme_absorbes || 0),
    envoye: Number(ledger?.envoye || 0),
    du: Number(ledger?.encore_du || 0),
  };
  const gauche = Number(ledger?.gauche ?? tot.recu - tot.rembourse);
  const droite = Number(ledger?.droite ?? tot.commission + tot.fraisDev + tot.envoye + tot.du);
  const ecart = gauche - droite;
  const equilibre = Boolean(ledger?.equilibre ?? Math.abs(ecart) < 1);

  const rows = useMemo(() => {
    return (terrains || [])
      .filter((t: any) => terrainId === "tous" || String(t.id) === terrainId)
      .map((t: any) => {
        const c = t.contrat_resume || {};
        return {
          ...t,
          recu: 0,
          rembourse: 0,
          commission: 0,
          fraisDev: 0,
          envoye: 0,
          du: Number(c.encore_du || 0),
          c,
        };
      });
  }, [terrains, terrainId]);

  const sorted = [...rows].sort((a, b) => {
    const va = Number(a[sortKey] || 0);
    const vb = Number(b[sortKey] || 0);
    return sortDir === "asc" ? va - vb : vb - va;
  });

  const vent = ledger?.encore_du_ventile || {};
  const ventilation = [
    { label: "En fenêtre de remboursement", value: Number(vent.en_fenetre || 0), tone: "warning" as const },
    { label: "Payable mode auto", value: Number(vent.payable_auto || 0), tone: "info" as const },
    { label: "Payable mode retrait", value: Number(vent.payable_retrait || 0), tone: "info" as const },
    { label: "Bloqué sans numéro", value: Number(vent.bloque_sans_numero || 0), tone: "danger" as const },
    { label: "En échec auto", value: Number(vent.echec || 0), tone: "danger" as const },
  ];

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
        <SaPageHeader titre="Rapprochement comptable" />
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
          <Terme value={tot.recu} label="Reçu en ligne" />
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
