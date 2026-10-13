import { Link2, Phone, QrCode, UserRound, ChevronRight, Ban } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { nextKanbanStage, type OperationalStage } from "@/lib/kanbanRules";
import { delayTone, formatFcfa, initials, type FluxReservation } from "../types";

const NEXT_LABEL: Partial<Record<OperationalStage, string>> = {
  checkin: "Valider l'arrivée",
  match: "Lancer le match",
  checkout: "Terminer le match",
  closed: "Clôturer",
};

type Props = {
  card: FluxReservation;
  advancing?: boolean;
  onClose: () => void;
  onScan: () => void;
  onLink: () => void;
  onAdvance: (stage: OperationalStage, extra?: { waiverEncaissement?: boolean; encaisserRestant?: boolean }) => void;
};

export default function FluxCardSheet({ card, advancing, onClose, onScan, onLink, onAdvance }: Props) {
  const navigate = useNavigate();
  const next = nextKanbanStage(card.operational_stage);
  const blocked = Boolean(card.crm?.bloqueReservation);
  const restant = Number(card.montant_restant || 0);
  const tone = delayTone(card);

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button type="button" className="absolute inset-0 bg-black/45" aria-label="Fermer" onClick={onClose} />
      <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-[20px] border-t border-[var(--color-border)] pb-[calc(16px+env(safe-area-inset-bottom))] max-h-[88vh] overflow-auto">
        <div className="flex justify-center pt-2.5 pb-1">
          <span className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
        </div>

        <div className="px-5 pt-2 pb-4 flex items-start gap-3">
          <span className="w-12 h-12 rounded-full bg-[var(--color-surface-2)] text-sm font-semibold flex items-center justify-center shrink-0">
            {initials(card.joueur_nom)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[22px] font-semibold leading-none" style={{ fontFamily: "var(--font-display)" }}>
              {String(card.heure_debut).slice(0, 5)} – {String(card.heure_fin).slice(0, 5)}
            </p>
            <p className="text-base font-medium mt-1.5 truncate">{card.joueur_nom || "Walk-in"}</p>
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
              {card.code_reservation || `#${card.id}`}
              {restant > 0 ? ` · reste ${formatFcfa(restant)}` : " · soldé"}
            </p>
          </div>
        </div>

        {(blocked || tone || !card.joueur_id) && (
          <div className="px-5 pb-3 flex flex-wrap gap-1.5">
            {blocked && (
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,var(--color-danger)_12%,white)] text-[var(--color-danger)]">
                <Ban className="w-3 h-3" /> {card.crm?.reason || "Bloqué"}
              </span>
            )}
            {tone === "late" && (
              <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,var(--color-warning)_14%,white)] text-[var(--color-warning)]">
                En retard
              </span>
            )}
            {!card.joueur_id && (
              <span className="text-[12px] font-medium px-2.5 py-1 rounded-full bg-[var(--color-surface-2)]">Walk-in</span>
            )}
          </div>
        )}

        <div className="px-5 space-y-2">
          {columnOfCheckin(card) && (
            <button
              type="button"
              onClick={onScan}
              className="w-full min-h-[52px] rounded-[14px] bg-[var(--color-primary)] text-white text-[15px] font-semibold inline-flex items-center justify-center gap-2"
            >
              <QrCode className="w-5 h-5" /> Scanner le QR
            </button>
          )}

          {next && !blocked && next !== "closed" && (
            <button
              type="button"
              disabled={advancing}
              onClick={() => onAdvance(next)}
              className="w-full min-h-[52px] rounded-[14px] bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-[15px] font-semibold disabled:opacity-50"
            >
              {NEXT_LABEL[next] || "Avancer"}
            </button>
          )}

          {next === "closed" && !blocked && restant > 0 && (
            <>
              <button
                type="button"
                disabled={advancing}
                onClick={() => onAdvance("closed", { encaisserRestant: true })}
                className="w-full min-h-[52px] rounded-[14px] bg-[var(--color-primary)] text-white text-[15px] font-semibold disabled:opacity-50"
              >
                Encaisser {formatFcfa(restant)} et clôturer
              </button>
              <button
                type="button"
                disabled={advancing}
                onClick={() => onAdvance("closed", { waiverEncaissement: true })}
                className="w-full min-h-[52px] rounded-[14px] border border-[var(--color-border)] text-[var(--color-text-primary)] text-[15px] font-semibold disabled:opacity-50"
              >
                Clôturer en impayé
              </button>
            </>
          )}

          {next === "closed" && !blocked && restant <= 0 && (
            <button
              type="button"
              disabled={advancing}
              onClick={() => onAdvance("closed")}
              className="w-full min-h-[52px] rounded-[14px] bg-[var(--color-primary)] text-white text-[15px] font-semibold disabled:opacity-50"
            >
              Clôturer
            </button>
          )}
        </div>

        <div className="mt-4 mx-5 border-t border-[var(--color-border)] divide-y divide-[var(--color-border)]">
          {card.joueur_telephone && (
            <a href={`tel:${card.joueur_telephone}`} className="flex items-center gap-3 min-h-[52px] text-[15px]">
              <Phone className="w-5 h-5 text-[var(--color-text-muted)]" /> Appeler
            </a>
          )}
          {card.joueur_id ? (
            <button type="button" className="flex w-full items-center gap-3 min-h-[52px] text-[15px]" onClick={() => navigate(`/backoffice/gerant/joueurs/${card.joueur_id}`)}>
              <UserRound className="w-5 h-5 text-[var(--color-text-muted)]" /> Fiche joueur
              <ChevronRight className="w-4 h-4 ml-auto text-[var(--color-text-muted)]" />
            </button>
          ) : (
            <button type="button" className="flex w-full items-center gap-3 min-h-[52px] text-[15px]" onClick={onLink}>
              <Link2 className="w-5 h-5 text-[var(--color-text-muted)]" /> Lier au CRM
            </button>
          )}
          <button
            type="button"
            className="flex w-full items-center gap-3 min-h-[52px] text-[15px]"
            onClick={() => navigate(`/backoffice/gerant/reservations/${card.id}`)}
          >
            <ChevronRight className="w-5 h-5 text-[var(--color-text-muted)]" /> Détail réservation
            <ChevronRight className="w-4 h-4 ml-auto text-[var(--color-text-muted)]" />
          </button>
        </div>
      </div>
    </div>
  );
}

function columnOfCheckin(card: FluxReservation) {
  return card.operational_stage === "checkin" || card.operational_stage === "reserved";
}
