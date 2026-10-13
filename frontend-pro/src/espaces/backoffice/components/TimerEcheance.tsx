import { useEffect, useState } from "react";
import { AlertOctagon, AlertTriangle, Calendar, Clock } from "lucide-react";

interface TimerEcheanceProps {
  dateEcheance: string;
  delaiTotal: number;
  dette: number;
}

function formaterDate(iso: string) {
  try {
    return new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function TimerEcheance({ dateEcheance, delaiTotal, dette }: TimerEcheanceProps) {
  const [joursRestants, setJoursRestants] = useState(0);

  useEffect(() => {
    const calculer = () => {
      const echeance = new Date(`${String(dateEcheance).slice(0, 10)}T23:59:59`);
      const maintenant = new Date();
      const diff = Math.ceil((echeance.getTime() - maintenant.getTime()) / (1000 * 60 * 60 * 24));
      setJoursRestants(diff);
    };
    calculer();
    const interval = setInterval(calculer, 3_600_000);
    return () => clearInterval(interval);
  }, [dateEcheance]);

  if (dette === 0 || !dateEcheance) return null;

  const total = Math.max(1, Number(delaiTotal) || 30);
  const progression = Math.min(((total - joursRestants) / total) * 100, 100);

  const getVariante = () => {
    if (joursRestants < 0) return "retard";
    if (joursRestants === 0) return "aujourd_hui";
    if (joursRestants <= 3) return "critique";
    if (joursRestants <= 7) return "attention";
    return "normal";
  };

  const variante = getVariante();

  const styles = {
    normal: {
      bg: "transparent",
      couleur: "var(--g-muted)",
      icone: Calendar,
      texte: `Échéance le ${formaterDate(dateEcheance)} — dans ${joursRestants} jours`,
    },
    attention: {
      bg: "var(--g-warning-bg)",
      couleur: "var(--g-warning)",
      icone: Clock,
      texte: `Plus que ${joursRestants} jours pour régler`,
    },
    critique: {
      bg: "var(--g-danger-bg)",
      couleur: "var(--g-danger)",
      icone: AlertTriangle,
      texte: `Urgent — ${joursRestants} jour(s) restant(s)`,
    },
    aujourd_hui: {
      bg: "var(--g-danger-bg)",
      couleur: "var(--g-danger)",
      icone: AlertOctagon,
      texte: "Échéance aujourd'hui !",
    },
    retard: {
      bg: "var(--g-danger-bg)",
      couleur: "var(--g-danger)",
      icone: AlertOctagon,
      texte: `En retard de ${Math.abs(joursRestants)} jours`,
    },
  }[variante];

  const Icone = styles.icone;
  const showBar = variante === "attention" || variante === "critique" || variante === "aujourd_hui";

  return (
    <div
      className={`flex flex-col gap-1.5 mt-2 rounded-lg px-3 py-2 ${variante === "aujourd_hui" ? "animate-[shake_0.4s_ease-in-out_1]" : ""}`}
      style={{ background: styles.bg }}
    >
      <div className="flex items-center gap-1.5">
        <Icone
          className={`w-3.5 h-3.5 shrink-0 ${variante === "critique" || variante === "aujourd_hui" ? "animate-pulse" : ""}`}
          style={{ color: styles.couleur }}
        />
        <span className="text-xs font-medium" style={{ color: styles.couleur }}>
          {styles.texte}
        </span>
      </div>
      {showBar ? (
        <div className="w-full rounded-full" style={{ height: "3px", background: "var(--g-border)" }}>
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${Math.max(0, progression)}%`, background: styles.couleur }}
          />
        </div>
      ) : null}
    </div>
  );
}
