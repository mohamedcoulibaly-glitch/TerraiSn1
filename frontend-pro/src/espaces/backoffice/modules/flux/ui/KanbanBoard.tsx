import { DndContext, PointerSensor, closestCorners, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { toast } from "sonner";
import { assertStageTransition, type OperationalStage } from "@/lib/kanbanRules";
import { FLUX_COLUMNS, columnOf, groupFluxCards, hotColumn, type FluxReservation } from "../types";
import KanbanColumn from "./KanbanColumn";

type Props = {
  cards: FluxReservation[];
  onMove: (id: number, stage: OperationalStage, extra?: { waiverEncaissement?: boolean; encaisserRestant?: boolean }) => Promise<unknown>;
  onScan: (card: FluxReservation) => void;
  onLink: (card: FluxReservation) => void;
};

export default function KanbanBoard({ cards, onMove, onScan, onLink }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const hot = hotColumn(cards);
  const grouped = groupFluxCards(cards);

  const onDragEnd = async (event: DragEndEvent) => {
    const overId = event.over?.id ? String(event.over.id) : "";
    const card = event.active.data.current?.card as FluxReservation | undefined;
    if (!card || !overId) return;

    const columnIds = ["reserved", "checkin", "match", "checkout", "closed"];
    let to = overId as OperationalStage;
    if (!columnIds.includes(to)) {
      const overCard = cards.find((c) => String(c.id) === overId);
      if (!overCard) return;
      to = columnOf(overCard);
    }
    const fromCol = columnOf(card);
    if (card.operational_stage === "closed" && to === "checkout") return;
    if (fromCol === to && !(card.operational_stage === "checkout" && to === "checkout")) return;

    const target: OperationalStage =
      card.operational_stage === "checkout" && to === "checkout" ? "closed" : to;

    try {
      assertStageTransition(
        {
          stage: card.operational_stage,
          statut: card.statut,
          date: card.date,
          heure_debut: card.heure_debut,
          heure_fin: card.heure_fin,
          fenetre_retard: card.fenetre_retard,
          checked_in_at: card.checked_in_at || null,
          montant_restant: Number(card.montant_restant || 0),
          waiverEncaissement: target === "closed" && Number(card.montant_restant || 0) > 0,
          crm: card.crm || { bloqueReservation: false },
        },
        target,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Transition refusée");
      return;
    }

    try {
      await onMove(card.id, target, {
        encaisserRestant: target === "closed" && Number(card.montant_restant || 0) > 0,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Déplacement impossible");
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
      <div className="grid grid-cols-4 gap-3">
        {FLUX_COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            id={col.id}
            title={col.title}
            hint={col.hint}
            hot={hot === col.id}
            cards={col.id === "checkout" ? [...grouped.checkout, ...grouped.closed] : grouped[col.id]}
            onScan={onScan}
            onLink={onLink}
          />
        ))}
      </div>
    </DndContext>
  );
}
