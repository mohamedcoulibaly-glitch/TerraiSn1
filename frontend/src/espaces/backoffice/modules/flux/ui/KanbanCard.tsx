import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Link2, Phone, QrCode, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { delayTone, formatFcfa, initials, type FluxReservation } from "../types";

type Props = {
  card: FluxReservation;
  hot: boolean;
  onScan: (card: FluxReservation) => void;
  onLink: (card: FluxReservation) => void;
};

export default function KanbanCard({ card, hot, onScan, onLink }: Props) {
  const navigate = useNavigate();
  const blocked = Boolean(card.crm?.bloqueReservation);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(card.id),
    disabled: blocked,
    data: { card },
  });
  const tone = delayTone(card);
  const walkIn = !card.joueur_id;

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...listeners}
      {...attributes}
      onClick={() => navigate(`/backoffice/gerant/reservations/${card.id}`)}
      className={`group relative rounded-[10px] bg-white border p-3 select-none ${
        isDragging ? "opacity-60 z-20" : ""
      } ${blocked ? "cursor-not-allowed opacity-80" : "cursor-grab active:cursor-grabbing"} ${
        tone === "late"
          ? "border-l-[3px] border-l-[var(--color-warning)] border-[var(--color-border)]"
          : tone === "expired"
            ? "border-l-[3px] border-l-[var(--color-danger)] border-[var(--color-border)]"
            : hot
              ? "border-[var(--color-primary)]"
              : "border-[var(--color-border)]"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="w-8 h-8 rounded-full bg-[var(--color-surface-2)] text-[11px] font-semibold flex items-center justify-center shrink-0 text-[var(--color-text-secondary)]">
          {initials(card.joueur_nom)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-[13px] font-semibold truncate text-[var(--color-text-primary)]" style={{ fontFamily: "var(--font-display)" }}>
              {String(card.heure_debut).slice(0, 5)}–{String(card.heure_fin).slice(0, 5)}
            </p>
            {card.operational_stage === "closed" && Number(card.montant_restant || 0) <= 0 && (
              <span className="text-[10px] text-[var(--color-text-muted)]">Soldé</span>
            )}
          </div>
          <p className="text-[13px] truncate mt-0.5">{card.joueur_nom || "Walk-in"}</p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 truncate">
            {card.code_reservation || `#${card.id}`}
            {Number(card.montant_restant) > 0 ? ` · ${formatFcfa(card.montant_restant)}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {blocked && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--color-danger)_12%,white)] text-[var(--color-danger)]">
            {card.crm?.reason || "Bloqué"}
          </span>
        )}
        {walkIn && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
            Walk-in
          </span>
        )}
        {!blocked && Number(card.montant_restant) > 0 && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--color-warning)_14%,white)] text-[var(--color-warning)]">
            Impayé
          </span>
        )}
      </div>

      <div className="hidden md:flex absolute inset-x-0 bottom-0 opacity-0 group-hover:opacity-100 transition-opacity bg-white/95 border-t border-[var(--color-border)] rounded-b-[10px] px-1.5 py-1 gap-0.5">
        <button type="button" className="flex-1 h-8 inline-flex items-center justify-center rounded-md hover:bg-[var(--color-surface-2)]" title="Scanner" onPointerDown={(e) => e.stopPropagation()} onClick={() => onScan(card)}>
          <QrCode className="w-3.5 h-3.5" />
        </button>
        {card.joueur_telephone && (
          <a className="flex-1 h-8 inline-flex items-center justify-center rounded-md hover:bg-[var(--color-surface-2)]" href={`tel:${card.joueur_telephone}`} title="Appeler" onPointerDown={(e) => e.stopPropagation()}>
            <Phone className="w-3.5 h-3.5" />
          </a>
        )}
        {card.joueur_id ? (
          <button type="button" className="flex-1 h-8 inline-flex items-center justify-center rounded-md hover:bg-[var(--color-surface-2)]" title="CRM" onPointerDown={(e) => e.stopPropagation()} onClick={() => navigate(`/backoffice/gerant/joueurs/${card.joueur_id}`)}>
            <UserRound className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button type="button" className="flex-1 h-8 inline-flex items-center justify-center rounded-md hover:bg-[var(--color-surface-2)]" title="Lier au CRM" onPointerDown={(e) => e.stopPropagation()} onClick={() => onLink(card)}>
            <Link2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </article>
  );
}
