import { BarChart2, FlaskConical, RefreshCw, ShoppingCart } from "lucide-react";
import type { ModeRevenu } from "./SaBadge";

const OPTIONS: { id: ModeRevenu; titre: string; desc: string; hint: string; Icon: typeof FlaskConical }[] = [
  { id: "essai", titre: "Essai gratuit", desc: "Onboarding sans commission", hint: "Sans frais", Icon: FlaskConical },
  { id: "commission", titre: "Commission", desc: "Prélèvement sur chaque réservation", hint: "Avec frais", Icon: BarChart2 },
  { id: "abonnement", titre: "Abonnement mensuel", desc: "Forfait récurrent", hint: "Forfait", Icon: RefreshCw },
  { id: "achat", titre: "Accès définitif", desc: "Paiement unique, plus de commission", hint: "One-shot", Icon: ShoppingCart },
];

export type ModeSelectorProps = {
  value: ModeRevenu;
  current?: ModeRevenu;
  onChange: (mode: ModeRevenu) => void;
  className?: string;
};

export function ModeSelector({ value, current, onChange, className }: ModeSelectorProps) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${className || ""}`}>
      {OPTIONS.map((o) => {
        const selected = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className="text-left rounded-[var(--sa-radius-md)] p-3"
            style={{
              border: `1.5px solid ${selected ? "var(--sa-primary)" : "var(--sa-border)"}`,
              background: selected ? "var(--sa-primary-subtle)" : "var(--sa-surface)",
            }}
          >
            <span className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: "var(--sa-text)" }}>
              <o.Icon size={16} />
              {o.titre}
              {current === o.id ? <span className="sa-badge text-[10px]" style={{ borderColor: "var(--sa-border)", color: "var(--sa-text-3)" }}>Mode actuel</span> : null}
            </span>
            <span className="block text-[12px] mt-1" style={{ color: "var(--sa-text-3)" }}>{o.desc}</span>
            <span className="block text-[11px] mt-1" style={{ color: "var(--sa-text-muted)" }}>{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

export default ModeSelector;
