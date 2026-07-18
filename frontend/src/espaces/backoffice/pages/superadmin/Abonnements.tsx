import { useEffect, useState } from "react";
import { superAdminApi } from "@/services/superAdminApi";

function statusLabel(item: any) {
  if (item.etat_operationnel === "suspension_due") return "Suspension due";
  if (item.etat_operationnel === "grace") return "Grace 3 jours";
  if (item.statut === "paye") return "Paye";
  if (item.statut === "en_retard") return "En retard";
  return "En attente";
}

function statusClass(item: any) {
  if (item.etat_operationnel === "suspension_due") return "badge-status badge-status-suspendu";
  if (item.etat_operationnel === "grace") return "badge-status bg-[color-mix(in_srgb,var(--color-warning)_16%,white)] text-[var(--color-warning)]";
  if (item.statut === "paye") return "badge-status badge-status-actif";
  return "badge-status bg-[color-mix(in_srgb,var(--color-info)_12%,white)] text-[var(--color-info)]";
}

export default function Abonnements() {
  const [data, setData] = useState<any>();
  const [payingId, setPayingId] = useState<number | null>(null);

  const load = () => superAdminApi.abonnements().then(setData).catch(console.error);

  useEffect(() => {
    load();
  }, []);

  const markPaid = async (id: number) => {
    setPayingId(id);
    try {
      await superAdminApi.payerAbonnement(id);
      await load();
    } finally {
      setPayingId(null);
    }
  };

  const items = data?.abonnements || [];

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2
          className="text-xl font-semibold text-[var(--color-text-primary)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Abonnements
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Periode de grace : {Number(data?.grace_days || 3)} jours avant suspension automatique.
        </p>
      </div>

      <div className="flex flex-col gap-2 md:hidden">
        {items.map((item: any) => (
          <article
            key={item.id}
            className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-sm" style={{ fontFamily: "var(--font-display)" }}>
                  {item.terrain_nom}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Echeance {item.date_echeance} - Suspension {item.suspension_apres}
                </p>
              </div>
              <span className={statusClass(item)}>{statusLabel(item)}</span>
            </div>
            <p className="text-sm font-semibold text-[var(--color-primary)] mt-3">
              {Number(item.montant || 0).toLocaleString()} CFA
            </p>
            {item.statut !== "paye" && (
              <button
                type="button"
                disabled={payingId === item.id}
                onClick={() => markPaid(item.id)}
                className="mt-3 min-h-[40px] px-4 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-white text-xs font-medium disabled:opacity-50"
              >
                {payingId === item.id ? "Validation..." : "Marquer paye"}
              </button>
            )}
          </article>
        ))}
      </div>

      <div className="hidden md:block bg-white rounded-[var(--radius-lg)] shadow-sm border border-[var(--color-border)] overflow-x-auto">
        <table className="bo-table">
          <thead>
            <tr>
              <th>Terrain</th>
              <th>Montant</th>
              <th>Echeance</th>
              <th>Suspension apres</th>
              <th>Statut</th>
              <th>Terrain</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any) => (
              <tr key={item.id}>
                <td className="font-medium">{item.terrain_nom}</td>
                <td>{Number(item.montant || 0).toLocaleString()} CFA</td>
                <td>{item.date_echeance}</td>
                <td>{item.suspension_apres}</td>
                <td>
                  <span className={statusClass(item)}>{statusLabel(item)}</span>
                </td>
                <td>{item.is_active ? "Actif" : "Suspendu"}</td>
                <td>
                  {item.statut !== "paye" ? (
                    <button
                      type="button"
                      disabled={payingId === item.id}
                      onClick={() => markPaid(item.id)}
                      className="text-sm text-[var(--color-primary)] font-medium hover:underline disabled:opacity-50"
                    >
                      {payingId === item.id ? "Validation..." : "Marquer paye"}
                    </button>
                  ) : (
                    <span className="text-xs text-[var(--color-text-muted)]">-</span>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-[var(--color-text-muted)] py-8">
                  Aucun abonnement pour le moment
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
