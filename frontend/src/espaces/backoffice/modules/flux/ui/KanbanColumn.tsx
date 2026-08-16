import { useDroppable } from "@dnd-kit/core";
import type { OperationalStage } from "@/lib/kanbanRules";
import type { FluxReservation } from "../types";
import KanbanCard from "./KanbanCard";

type Props = {
  id: OperationalStage;
  title: string;
  hint: string;
  hot: boolean;
  cards: FluxReservation[];
  onScan: (card: FluxReservation) => void;
  onLink: (card: FluxReservation) => void;
};

export default function KanbanColumn({ id, title, hint, hot, cards, onScan, onLink }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <section
      ref={setNodeRef}
      className={`flex flex-col rounded-[var(--radius-md)] border ${
        hot ? "border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_5%,white)]" : "border-[var(--color-border)] bg-[var(--color-surface-2)]/60"
      } ${isOver ? "ring-2 ring-[var(--color-primary)]" : ""}`}
    >
      <header className="px-3 py-2.5 flex items-center justify-between gap-2">
        <div>
          <p className={`text-[13px] font-semibold ${hot ? "text-[var(--color-primary)]" : "text-[var(--color-text-primary)]"}`}>
            {title}
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)]">{hint}</p>
        </div>
        <span className={`text-[11px] font-semibold min-w-[1.5rem] h-6 px-1.5 rounded-full inline-flex items-center justify-center ${
          hot ? "bg-[var(--color-primary)] text-white" : "bg-white text-[var(--color-text-secondary)] border border-[var(--color-border)]"
        }`}>
          {cards.length}
        </span>
      </header>
      <div className="flex-1 px-2 pb-2 space-y-2 min-h-[120px]">
        {cards.map((card) => (
          <KanbanCard key={card.id} card={card} hot={hot} onScan={onScan} onLink={onLink} />
        ))}
      </div>
    </section>
  );
}
